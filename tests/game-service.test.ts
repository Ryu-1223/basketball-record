import { Firestore } from '@google-cloud/firestore';
import { afterAll, expect, it, vi } from 'vitest';
import { deleteGame } from '../server/game-service';

const db = new Firestore({ projectId: 'demo-basketball-record' });
afterAll(() => db.terminate());

it('500件を超えるプレーを削除し、他の試合と選手は残す。再試行も成功する', async () => {
  const path = 'teams/deletion-test';
  await db.doc(`${path}/members/user`).set({ enabled: true });
  await db.doc(`${path}/games/target`).set({ id: 'target' });
  await db.doc(`${path}/games/other`).set({ id: 'other' });
  await db.doc(`${path}/players/player`).set({ id: 'player' });
  for (let start = 0; start < 505; start += 400) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 400, 505); i++) batch.set(db.doc(`${path}/games/target/plays/${i}`), { id: String(i) });
    await batch.commit();
  }
  await deleteGame(db, 'user', 'deletion-test', 'target');
  expect((await db.doc(`${path}/games/target`).get()).exists).toBe(false);
  expect((await db.collection(`${path}/games/target/plays`).get()).empty).toBe(true);
  expect((await db.doc(`${path}/deletedGames/target`).get()).exists).toBe(true);
  expect((await db.doc(`${path}/games/other`).get()).exists).toBe(true);
  expect((await db.doc(`${path}/players/player`).get()).exists).toBe(true);
  await deleteGame(db, 'user', 'deletion-test', 'target');
}, 45_000);

it('削除失敗後も再試行で完了し、部外者の削除は拒否する', async () => {
  const path = 'teams/deletion-retry';
  await db.doc(`${path}/members/user`).set({ enabled: true });
  await db.doc(`${path}/games/target`).set({ id: 'target' });
  await expect(deleteGame(db, 'outsider', 'deletion-retry', 'target')).rejects.toMatchObject({ status: 403 });
  expect((await db.doc(`${path}/deletedGames/target`).get()).exists).toBe(false);
  const failure = vi.spyOn(db, 'recursiveDelete').mockRejectedValueOnce(new Error('connection lost'));
  await expect(deleteGame(db, 'user', 'deletion-retry', 'target')).rejects.toThrow('connection lost');
  failure.mockRestore();
  await deleteGame(db, 'user', 'deletion-retry', 'target');
  expect((await db.doc(`${path}/games/target`).get()).exists).toBe(false);
});
