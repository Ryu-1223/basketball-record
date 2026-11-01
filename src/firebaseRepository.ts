import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, onSnapshot, orderBy, query, limit, setDoc, terminate, clearIndexedDbPersistence,
  type Firestore, type DocumentData, type Query,
} from 'firebase/firestore';
import { openDB } from 'idb';
import type { Game, Play, Player } from './domain';
import { readableError, type Repository, type SyncState } from './repository';

export const hasCloudConfig = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_TEAM_EMAIL', 'VITE_TEAM_ID'].every(key => Boolean(import.meta.env[key]));
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
export async function login(passphrase: string) {
  await signInWithEmailAndPassword(getServices().auth, import.meta.env.VITE_TEAM_EMAIL, passphrase);
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
export async function createCloudRepository(uid: string): Promise<Repository & { retry: () => void }> {
  const { db } = getServices();
  const teamPath = `teams/${import.meta.env.VITE_TEAM_ID}`;
  // サーバー拒否時も入力を失わないよう、Firestoreとは別の送信待ちを保持する。
  const outbox = await openDB(`basketball-outbox-${import.meta.env.VITE_FIREBASE_PROJECT_ID}-${import.meta.env.VITE_TEAM_ID}-${uid}`, 1, {
    upgrade(database) { database.createObjectStore('writes', { keyPath: 'path' }); },
  });
  const syncListeners = new Set<(state: SyncState) => void>();
  const snapshotPending = new Map<string, Set<string>>();
  const cacheStates = new Map<string, boolean>();
  const errors = new Map<string, string>();
  const pending = new Set<string>((await outbox.getAllKeys('writes')) as string[]);
  const processing = new Set<string>();
  const stops = new Set<() => void>();
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
        const tx = outbox.transaction('writes', 'readwrite');
        const latest = await tx.store.get(path) as QueuedWrite | undefined;
        if (latest?.version === entry.version) await tx.store.delete(path);
        await tx.done;
        errors.delete(path);
        entry = await outbox.get('writes', path);
      }
      if (!entry) pending.delete(path);
    } catch (error) { errors.set(path, readableError(error)); }
    finally { processing.delete(path); notify(); }
  };
  const retry = () => { [...pending].forEach(path => { void process(path); }); };
  const save = async (path: string, value: Player | Game | Play) => {
    await outbox.put('writes', { path, value, version: crypto.randomUUID() } satisfies QueuedWrite);
    pending.add(path); notify(); void process(path);
  };
  const watch = <T,>(key: string, q: Query<DocumentData>, cb: (values: T[]) => void) => {
    const stopSnapshot = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      snapshotPending.set(key, new Set(snapshot.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.ref.path)));
      cacheStates.set(key, snapshot.metadata.fromCache);
      errors.delete(`watch:${key}`);
      cb(snapshot.docs.map(d => d.data() as T)); notify();
    }, error => { errors.set(`watch:${key}`, readableError(error)); notify(); });
    const stop = () => { stopSnapshot(); snapshotPending.delete(key); cacheStates.delete(key); stops.delete(stop); notify(); };
    stops.add(stop); return stop;
  };
  const online = () => retry();
  window.addEventListener('online', online);
  retry();
  return {
    mode: 'cloud', retry,
    watchPlayers: cb => watch('players', collection(db, `${teamPath}/players`), cb),
    watchGames: (count, cb) => watch('games', query(collection(db, `${teamPath}/games`), orderBy('date', 'desc'), limit(count)), cb),
    watchPlays: (gameId, cb) => watch(`plays:${gameId}`, collection(db, `${teamPath}/games/${gameId}/plays`), cb),
    watchSync: cb => { syncListeners.add(cb); cb(state()); return () => { syncListeners.delete(cb); }; },
    savePlayer: value => save(`${teamPath}/players/${value.id}`, value),
    saveGame: value => save(`${teamPath}/games/${value.id}`, value),
    savePlay: value => save(`${teamPath}/games/${value.gameId}/plays/${value.id}`, value),
    close: async () => {
      closed = true; stops.forEach(stop => stop()); syncListeners.clear();
      window.removeEventListener('online', online); outbox.close();
    },
  };
}
