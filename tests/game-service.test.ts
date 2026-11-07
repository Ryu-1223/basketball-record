import { Firestore } from '@google-cloud/firestore';
import { afterAll, expect, it, vi } from 'vitest';
import { deleteGame, purgeExpiredGames, TRASH_RETENTION_MS } from '../server/game-service';
const db = new Firestore({ projectId: 'demo-basketball-record' });
afterAll(() => db.terminate());
const now = 1800000000000;
async function seed(team: string) {
  const base = `teams/${team}`;
  await db.doc(`${base}/members/user`).set({ enabled: true });
  await db.doc(`${base}/games/target`).set({ id: 'target', quarters: [{ number: 1, startedAt: now - 1000, endedAt: null }], status: 'running' });
  await db.doc(`${base}/games/other`).set({ id: 'other' });
  await db.doc(`${base}/players/player`).set({ id: 'player' });
  return base;
}
it('移動はサーバー時刻から30日、時計を停止し、期限直前まで復元できる。再試行で期限を延ばさない', async () => {
  const base = await seed('trash-restore');
  await deleteGame(db, 'user', 'trash-restore', 'target', false, now);
  await deleteGame(db, 'user', 'trash-restore', 'target', false, now + 500);
  const trash = (await db.doc(`${base}/games/target`).get()).data()!;
  expect(trash).toMatchObject({ trashedAt: now, expiresAt: now + TRASH_RETENTION_MS, generation: 1 });
  expect(trash.quarters[0].pausedAt).toBe(now);
  await deleteGame(db, 'user', 'trash-restore', 'target', true, now + TRASH_RETENTION_MS - 1);
  await deleteGame(db, 'user', 'trash-restore', 'target', true, now + TRASH_RETENTION_MS - 1);
  expect((await db.doc(`${base}/games/target`).get()).data()).not.toHaveProperty('trashedAt');
  expect((await db.doc('_gameTrash/trash-restore:target').get()).exists).toBe(false);
  await deleteGame(db, 'user', 'trash-restore', 'target', false, now + 1000);
  expect((await db.doc(`${base}/games/target`).get()).data()?.generation).toBe(2);
});
it('期限ちょうどから復元を拒否し、505件のプレーも完全削除する。他の試合と名簿は残る', async () => {
  const base = await seed('trash-purge');
  const writer = db.bulkWriter();
  for (let i = 0; i < 505; i++) void writer.set(db.doc(`${base}/games/target/plays/${i}`), { id: String(i) });
  await writer.close();
  await deleteGame(db, 'user', 'trash-purge', 'target', false, now);
  expect((await db.collection(`${base}/games/target/plays`).get()).size).toBe(505);
  await expect(deleteGame(db, 'user', 'trash-purge', 'target', true, now + TRASH_RETENTION_MS)).rejects.toMatchObject({ status: 409 });
  await purgeExpiredGames(db, now + TRASH_RETENTION_MS);
  expect((await db.doc(`${base}/games/target`).get()).exists).toBe(false);
  expect((await db.collection(`${base}/games/target/plays`).get()).empty).toBe(true);
  expect((await db.doc(`${base}/deletedGames/target`).get()).exists).toBe(true);
  expect((await db.doc(`${base}/games/other`).get()).exists).toBe(true);
  expect((await db.doc(`${base}/players/player`).get()).exists).toBe(true);
  await purgeExpiredGames(db, now + TRASH_RETENTION_MS);
}, 45000);
it('部外者を拒否し、完全削除の失敗後もキューを残して再試行できる', async () => {
  const base = await seed('trash-retry');
  await expect(deleteGame(db, 'outsider', 'trash-retry', 'target', false, now)).rejects.toMatchObject({ status: 403 });
  await deleteGame(db, 'user', 'trash-retry', 'target', false, now);
  const failure = vi.spyOn(db, 'recursiveDelete').mockRejectedValueOnce(new Error('connection lost'));
  await expect(purgeExpiredGames(db, now + TRASH_RETENTION_MS)).rejects.toThrow('connection lost');
  failure.mockRestore();
  expect((await db.doc('_gameTrash/trash-retry:target').get()).exists).toBe(true);
  await expect(deleteGame(db, 'user', 'trash-retry', 'target', true, now)).rejects.toMatchObject({ status: 404 });
  await purgeExpiredGames(db, now + TRASH_RETENTION_MS);
  expect((await db.doc(`${base}/games/target`).get()).exists).toBe(false);
});
it('復元が先に完了した記録は古い削除キューがあっても消さない', async () => {
  const base = await seed('trash-race');
  await deleteGame(db, 'user', 'trash-race', 'target', false, now);
  await deleteGame(db, 'user', 'trash-race', 'target', true, now + 1);
  await db.doc('_gameTrash/trash-race:target').set({ teamId: 'trash-race', gameId: 'target', expiresAt: now });
  await purgeExpiredGames(db, now + TRASH_RETENTION_MS);
  expect((await db.doc(`${base}/games/target`).get()).exists).toBe(true);
});
