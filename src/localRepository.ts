import { openDB } from 'idb';
import type { Game, Play, Player } from './domain';
import { readableError, type Repository, type SyncState } from './repository';

export async function createLocalRepository(name = 'basketball-record-local'): Promise<Repository> {
  const db = await openDB(name, 1, { upgrade(database) {
    database.createObjectStore('players', { keyPath: 'id' });
    database.createObjectStore('games', { keyPath: 'id' });
    database.createObjectStore('plays', { keyPath: 'id' });
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
  const save = async (store: string, value: Player | Game | Play) => {
    sync = { ...sync, pending: sync.pending + 1 }; notify();
    try { await db.put(store, value); sync = { ...sync, pending: sync.pending - 1, error: null }; }
    catch (error) { sync = { ...sync, pending: sync.pending - 1, error: 'この端末に保存できません。空き容量やブラウザの設定を確認してください。' }; throw error; }
    finally { notify(); channel?.postMessage('change'); }
  };
  return {
    mode: 'local', scope: 'local',
    watchPlayers: cb => watch(() => db.getAll('players') as Promise<Player[]>, cb),
    watchGames: (limit, cb) => watch(async () => ((await db.getAll('games')) as Game[]).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, limit), cb),
    watchPlays: (gameId, cb) => watch(async () => ((await db.getAll('plays')) as Play[]).filter(p => p.gameId === gameId), cb),
    watchSync: cb => { syncWatchers.add(cb); cb(sync); return () => { syncWatchers.delete(cb); }; },
    savePlayer: value => save('players', value), saveGame: value => save('games', value), savePlay: value => save('plays', value),
    close: async () => { watchers.clear(); syncWatchers.clear(); channel?.close(); db.close(); },
  };
}
