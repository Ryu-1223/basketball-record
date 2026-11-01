import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Play } from './domain';
import type { SyncState } from './repository';

const backend = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), connectAuthEmulator: vi.fn(), signInWithCustomToken: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
  connectFirestoreEmulator: vi.fn(), collection: vi.fn(), doc: (_db: unknown, path: string) => ({ path }),
  onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), limit: vi.fn(),
  setDoc: backend.save, terminate: vi.fn(), clearIndexedDbPersistence: vi.fn(),
}));
beforeAll(() => {
  for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(name, 'queue-test');
});
describe('クラウド送信待ちの復旧', () => {
  it('サーバーが保存を拒否しても記録を保持し、再起動後に同じIDで再送する', async () => {
    const { createCloudRepository } = await import('./firebaseRepository');
    backend.save.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const uid = crypto.randomUUID();
    const repo = await createCloudRepository(uid, 'queue-test');
    let state: SyncState = { pending: 0, error: null, fromCache: false };
    repo.watchSync(value => { state = value; });
    const play: Play = { id: 'record-to-recover', gameId: 'game', quarter: 1, elapsedMs: 1234, playerId: 'p7', action: 'foul', details: { code: 'P', penalty: '2', countsTeam: true }, shot: null, createdAt: 1, updatedAt: 1, cancelled: false };
    await repo.savePlays([play]);
    await expect.poll(() => state.error).not.toBeNull();
    expect(state.pending).toBe(1);
    await repo.close();
    backend.save.mockResolvedValue(undefined);
    const restored = await createCloudRepository(uid, 'queue-test');
    restored.watchSync(value => { state = value; });
    await expect.poll(() => state.pending).toBe(0);
    expect(state.error).toBeNull();
    expect(backend.save).toHaveBeenLastCalledWith({ path: 'teams/queue-test/games/game/plays/record-to-recover' }, play);
    await restored.close();
  });
});
