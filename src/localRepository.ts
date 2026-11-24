import { openDB } from 'idb';
import type { Game, Play, Player } from './domain';
import { readableError, type Repository, type SyncState } from './repository';

export async function createLocalRepository(name = 'basketball-record-local'): Promise<Repository> {
  const db = await openDB(name, 2, { upgrade(database) {
    if (!database.objectStoreNames.contains('players')) database.createObjectStore('players', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('games')) database.createObjectStore('games', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('plays')) database.createObjectStore('plays', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('deletedGames')) database.createObjectStore('deletedGames');
  } });
  const watchers = new Set<() => void>();
  const syncWatchers = new Set<(value: SyncState) => void>();
  let sync: SyncState = { pending: 0, error: null, fromCache: false };
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  const notify = () => { watchers.forEach(cb => cb()); syncWatchers.forEach(cb => cb(sync)); };
  if (channel) channel.onmessage = notify;
  const watch = <T,>(read: () => Promise<T>, cb: (value: T) => void) => {
    let active = true;
    const refresh = () => { void read().then(value => { if (active) cb(value); }).catch(error => {
      if (!active) return;
      sync = { ...sync, error: readableError(error) }; syncWatchers.forEach(cb => cb(sync));
    }); };
    watchers.add(refresh); refresh();
    return () => { active = false; watchers.delete(refresh); };
  };
  const purge = async () => {
    const tx = db.transaction(['games', 'plays', 'deletedGames'], 'readwrite');
    const expired = new Set((await tx.objectStore('games').getAll() as Game[]).filter(g => g.trashedAt && g.expiresAt! <= Date.now()).map(g => g.id));
    if (expired.size) {
      for (const play of await tx.objectStore('plays').getAll() as Play[]) if (expired.has(play.gameId)) await tx.objectStore('plays').delete(play.id);
      for (const id of expired) { await tx.objectStore('deletedGames').put(true, id); await tx.objectStore('games').delete(id); }
    }
    await tx.done;
    if (expired.size) { notify(); channel?.postMessage('change'); }
  };
  await purge();
  const timer = setInterval(() => { void purge().catch(() => {}); }, 60_000);
  const save = async (store: string, value: Player | Game | Play) => {
    sync = { ...sync, pending: sync.pending + 1 }; notify();
    try {
      const tx = db.transaction(store === 'plays' ? ['games', 'plays', 'deletedGames'] : store === 'games' ? ['games', 'deletedGames'] : [store], 'readwrite');
      if (store !== 'players') {
        const current = await tx.objectStore('games').get(store === 'plays' ? (value as Play).gameId : value.id) as Game | undefined;
        const deleted = await tx.objectStore('deletedGames').get(store === 'plays' ? (value as Play).gameId : value.id);
        if (deleted || current?.trashedAt || (store === 'games' && current && (current.generation ?? 0) !== ((value as Game).generation ?? 0))) { await tx.done; throw new Error('この試合はゴミ箱へ移動されたか、復元されています。一覧から開き直してください。'); }
        if (store === 'plays' && current?.generation) value = { ...value, generation: current.generation };
      }
      await tx.objectStore(store).put(value); await tx.done;
      sync = { ...sync, pending: sync.pending - 1, error: null };
    } catch (error) { sync = { ...sync, pending: sync.pending - 1 }; throw error; }
    finally { notify(); channel?.postMessage('change'); }
  };
  return {
    mode: 'local', scope: 'local',
    watchTeam: cb => { cb({ name: '試用チーム' }); return () => {}; },
    saveTeamName: async () => {},
    watchPlayers: cb => watch(() => db.getAll('players') as Promise<Player[]>, cb),
    watchGames: (limit, cb) => watch(async () => ((await db.getAll('games')) as Game[]).filter(g => !g.trashedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, limit), cb),
    watchTrash: (limit, cb) => watch(async () => ((await db.getAll('games')) as Game[]).filter(g => g.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!).slice(0, limit), cb),
    watchGame: (gameId, cb) => watch(() => db.get('games', gameId) as Promise<Game | undefined>, cb),
    watchPlays: (gameId, cb) => watch(async () => ((await db.getAll('plays')) as Play[]).filter(p => p.gameId === gameId), cb),
    watchSync: cb => { syncWatchers.add(cb); cb(sync); return () => { syncWatchers.delete(cb); }; },
    savePlayer: value => save('players', value), saveGame: value => save('games', value), savePlay: value => save('plays', value),
    deleteGame: async (gameId, restore = false) => {
      const tx = db.transaction('games', 'readwrite');
      const game = await tx.store.get(gameId) as Game | undefined;
      if (!game) { await tx.done; throw new Error('試合が見つかりません。'); }
      if (restore) {
        if (game.trashedAt && (!game.expiresAt || game.expiresAt <= Date.now())) { await tx.done; throw new Error('復元期限を過ぎています。'); }
        const { trashedAt: _trashedAt, expiresAt: _expiresAt, archived: _archived, ...value } = game;
        await tx.store.put({ ...value, updatedAt: Date.now() });
      } else if (!game.trashedAt) {
        const now = Date.now();
        await tx.store.put({ ...game, generation: (game.generation ?? 0) + 1, trashedAt: now, expiresAt: now + 30 * 86400000, updatedAt: now, quarters: game.quarters.map(q => q.endedAt == null && q.pausedAt == null ? { ...q, pausedAt: now } : q) });
      }
      await tx.done; notify(); channel?.postMessage('change');
    },
    savePlays: async values => {
      const tx = db.transaction(['games', 'plays', 'deletedGames'], 'readwrite');
      for (const value of values) {
        const game = await tx.objectStore('games').get(value.gameId) as Game | undefined;
        if (await tx.objectStore('deletedGames').get(value.gameId) || game?.trashedAt) { tx.abort(); throw new Error('この試合はゴミ箱にあります。'); }
        await tx.objectStore('plays').put({ ...value, ...(game?.generation ? { generation: game.generation } : {}) });
      }
      await tx.done; notify(); channel?.postMessage('change');
    },
    close: async () => { clearInterval(timer); watchers.clear(); syncWatchers.clear(); channel?.close(); db.close(); },
  };
}
