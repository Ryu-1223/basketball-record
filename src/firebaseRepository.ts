import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, signOut, type Auth } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, onSnapshot, orderBy, query, limit, setDoc, terminate, clearIndexedDbPersistence,
  type Firestore, type DocumentData, type Query, where, updateDoc, getDocFromServer,
} from 'firebase/firestore';
import { openDB } from 'idb';
import type { Game, Play, Player } from './domain';
import { readableError, type Repository, type SyncState } from './repository';
import { normalizePassphrase, type TeamAction } from './team';

export const hasCloudConfig = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].every(key => Boolean(import.meta.env[key]));
type Services = { auth: Auth; db: Firestore };
let services: Services | undefined;
export function getServices(): Services {
  if (services) return services;
  if (!hasCloudConfig) throw new Error('Firebaseの接続設定が必要です。');
  const app = initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID });
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  services = { auth, db };
  return services;
}
export async function accessTeam(action: TeamAction, input: string, teamName?: string) {
  const passphrase = normalizePassphrase(input);
  const response = await fetch('/api/team', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, passphrase, teamName }), cache: 'no-store', signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => null) as { token?: string; error?: string } | null;
  if (!response.ok || !data?.token) throw new Error(data?.error ?? 'チームに接続できません。通信を確認してもう一度お試しください。');
  await signInWithCustomToken(getServices().auth, data.token);
}
export async function logout() {
  const { auth, db } = getServices();
  await signOut(auth);
  await terminate(db);
  await clearIndexedDbPersistence(db);
  // terminateしたFirestoreを再利用しない。
  location.reload();
}

type QueuedWrite = { path: string; value: Player | Game | Play; version: string };
export async function createCloudRepository(uid: string, teamId: string): Promise<Repository & { retry: () => Promise<void> }> {
  const { db, auth } = getServices();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(teamId)) throw new Error('チームに参加し直してください。');
  const teamPath = `teams/${teamId}`;
  // サーバー拒否時も入力を失わないよう、Firestoreとは別の送信待ちを保持する。
  const outbox = await openDB(`basketball-outbox-${import.meta.env.VITE_FIREBASE_PROJECT_ID}-${teamId}-${uid}`, 1, {
    upgrade(database) { database.createObjectStore('writes', { keyPath: 'path' }); },
  });
  const syncListeners = new Set<(state: SyncState) => void>();
  const snapshotPending = new Map<string, Set<string>>();
  const cacheStates = new Map<string, boolean>();
  const errors = new Map<string, string>();
  const pending = new Set<string>((await outbox.getAllKeys('writes')) as string[]);
  const processing = new Set<string>();
  const generations = new Map<string, number>();
  const stops = new Set<() => void>();
  const renewals = new Set<() => void>();
  let closed = false;
  const state = (): SyncState => ({
    pending: new Set([...pending, ...[...snapshotPending.values()].flatMap(paths => [...paths])]).size,
    error: [...errors.values()][0] ?? null,
    fromCache: [...cacheStates.values()].some(Boolean),
  });
  const notify = () => { if (!closed) syncListeners.forEach(cb => cb(state())); };
  const process = async (path: string) => {
    if (closed || processing.has(path)) return;
    processing.add(path);
    try {
      let entry: QueuedWrite | undefined = await outbox.get('writes', path);
      while (entry && !closed) {
        await setDoc(doc(db, path), entry.value);
        if (closed) return;
        const tx = outbox.transaction('writes', 'readwrite');
        const latest = await tx.store.get(path) as QueuedWrite | undefined;
        if (latest?.version === entry.version) await tx.store.delete(path);
        await tx.done;
        errors.delete(path);
        entry = await outbox.get('writes', path);
      }
      if (!entry) pending.delete(path);
    } catch (error) {
      // A confirmed deletion makes queued edits obsolete, even after an offline restart.
      const gameId = path.startsWith(`${teamPath}/games/`) ? path.split('/')[3] : null;
      let deleted = false;
      if (gameId && String((error as { code?: unknown }).code).includes('permission-denied')) {
        try {
          deleted = (await getDocFromServer(doc(db, `${teamPath}/deletedGames/${gameId}`))).exists();
          if (!deleted) {
            const current = await getDocFromServer(doc(db, `${teamPath}/games/${gameId}`));
            const queued = await outbox.get('writes', path) as QueuedWrite | undefined;
            deleted = current.exists() && (!!current.data().trashedAt || (current.data().generation ?? 0) !== ((queued?.value as Game | Play)?.generation ?? 0));
          }
        }
        catch { /* Keep the write if deletion cannot be verified. */ }
      }
      if (closed) return;
      if (deleted) {
        await outbox.delete('writes', path);
        pending.delete(path); errors.delete(path);
      } else errors.set(path, readableError(error));
    }
    finally {
      processing.delete(path); notify();
      // 同じ記録の更新が送信完了と重なった場合も、新しい版を取り残さない。
      if (!closed && pending.has(path) && !errors.has(path)) void process(path);
    }
  };
  const retry = async () => {
    await auth.currentUser?.getIdToken(true);
    if (closed) return;
    errors.delete('auth');
    renewals.forEach(renew => renew());
    [...pending].forEach(path => { void process(path); });
  };
  const save = async (path: string, value: Player | Game | Play) => {
    await outbox.put('writes', { path, value, version: crypto.randomUUID() } satisfies QueuedWrite);
    pending.add(path); notify(); void process(path);
  };
  const watch = <T,>(key: string, q: Query<DocumentData>, cb: (values: T[]) => void) => {
    let stopSnapshot = () => {};
    const renew = () => { stopSnapshot(); stopSnapshot = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      snapshotPending.set(key, new Set(snapshot.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.ref.path)));
      cacheStates.set(key, snapshot.metadata.fromCache);
      errors.delete(`watch:${key}`);
      const values = snapshot.docs.map(d => d.data() as T);
      if (key === 'games' || key === 'trash') for (const value of values as Game[]) generations.set(value.id, value.generation ?? 0);
      cb(values); notify();
    }, error => { errors.set(`watch:${key}`, readableError(error)); notify(); }); };
    renewals.add(renew); renew();
    const stop = () => { renewals.delete(renew); stopSnapshot(); snapshotPending.delete(key); cacheStates.delete(key); stops.delete(stop); notify(); };
    stops.add(stop); return stop;
  };
  const online = () => { void retry().catch(error => { errors.set('auth', readableError(error)); notify(); }); };
  window.addEventListener('online', online);
  online();
  return {
    mode: 'cloud', scope: teamId, retry,
    watchTeam: cb => {
      const key = 'team';
      let stopSnapshot = () => {};
      const renew = () => { stopSnapshot(); stopSnapshot = onSnapshot(doc(db, teamPath), snap => { errors.delete('watch:team'); cb(snap.data() as { name?: string; passphrase?: string }); notify(); }, error => { errors.set(`watch:${key}`, readableError(error)); notify(); }); };
      renewals.add(renew); renew();
      const stop = () => { renewals.delete(renew); stopSnapshot(); stops.delete(stop); };
      stops.add(stop); return stop;
    },
    saveTeamName: async name => { await updateDoc(doc(db, teamPath), { name }); },
    watchPlayers: cb => watch('players', collection(db, `${teamPath}/players`), cb),
    watchGames: (count, cb) => {
      let readLimit = count, stop = () => {}, active = true;
      const subscribe = () => {
        stop = watch<Game>('games', query(collection(db, `${teamPath}/games`), orderBy('date', 'desc'), limit(readLimit)), values => {
          const visible = values.filter(g => !g.trashedAt);
          cb(visible.slice(0, count));
          if (values.length >= readLimit && visible.length < count) {
            readLimit += Math.max(count, 30);
            queueMicrotask(() => { if (active) { stop(); subscribe(); } });
          }
        });
      };
      subscribe(); return () => { active = false; stop(); };
    },
    watchTrash: (count, cb) => watch('trash', query(collection(db, `${teamPath}/games`), where('trashedAt', '>', 0), orderBy('trashedAt', 'desc'), limit(count)), cb),
    watchGame: (gameId, cb) => {
      const key = `game:${gameId}`;
      let stopSnapshot = () => {};
      const renew = () => { stopSnapshot(); stopSnapshot = onSnapshot(doc(db, `${teamPath}/games/${gameId}`), { includeMetadataChanges: true }, snapshot => {
        snapshotPending.set(key, new Set(snapshot.metadata.hasPendingWrites ? [snapshot.ref.path] : []));
        cacheStates.set(key, snapshot.metadata.fromCache); errors.delete(`watch:${key}`);
        if (snapshot.exists()) generations.set(gameId, snapshot.data().generation ?? 0);
        cb(snapshot.exists() ? snapshot.data() as Game : undefined); notify();
      }, error => { errors.set(`watch:${key}`, readableError(error)); notify(); }); };
      renewals.add(renew); renew();
      const stop = () => { renewals.delete(renew); stopSnapshot(); snapshotPending.delete(key); cacheStates.delete(key); stops.delete(stop); notify(); };
      stops.add(stop); return stop;
    },
    watchPlays: (gameId, cb) => watch(`plays:${gameId}`, collection(db, `${teamPath}/games/${gameId}/plays`), cb),
    watchSync: cb => { syncListeners.add(cb); cb(state()); return () => { syncListeners.delete(cb); }; },
    savePlayer: value => save(`${teamPath}/players/${value.id}`, value),
    saveGame: value => save(`${teamPath}/games/${value.id}`, value),
    deleteGame: async (gameId, restore = false) => {
      if (!navigator.onLine || state().pending || state().error) throw new Error('通信を確認し、すべて保存済みになってから操作してください。');
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('チームに参加し直してください。');
      const response = await fetch('/api/game', {
        method: restore ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId }), cache: 'no-store', signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => null) as { deleted?: boolean; error?: string } | null;
      if (!response.ok || !result?.deleted) throw new Error(result?.error ?? '操作の完了を確認できません。一覧を確認して、同じ操作をもう一度お試しください。');
    },
    savePlay: value => save(`${teamPath}/games/${value.gameId}/plays/${value.id}`, { ...value, ...(generations.get(value.gameId) ? { generation: generations.get(value.gameId) } : {}) }),
    savePlays: async values => {
      // Persist the entire reorder locally before starting any network writes.
      const entries = values.map(value => ({ path: `${teamPath}/games/${value.gameId}/plays/${value.id}`, value: { ...value, ...(generations.get(value.gameId) ? { generation: generations.get(value.gameId) } : {}) }, version: crypto.randomUUID() }));
      const tx = outbox.transaction('writes', 'readwrite');
      for (const entry of entries) void tx.store.put(entry);
      await tx.done;
      for (const entry of entries) pending.add(entry.path);
      notify(); for (const entry of entries) void process(entry.path);
    },
    close: async () => {
      closed = true; stops.forEach(stop => stop()); syncListeners.clear();
      window.removeEventListener('online', online); outbox.close();
    },
  };
}
