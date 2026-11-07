import type { Firestore } from '@google-cloud/firestore';
import { TeamError } from './team-service.js';
export const TRASH_RETENTION_MS = 30 * 86400000;
export async function deleteGame(db: Firestore, uid: string, teamId: string, gameId: string, restore = false, now = Date.now()) {
  const base = `teams/${teamId}`;
  const ref = db.doc(`${base}/games/${gameId}`);
  const queue = db.doc(`_gameTrash/${teamId}:${gameId}`);
  await db.runTransaction(async tx => {
    const [member, snapshot, marker] = await tx.getAll(db.doc(`${base}/members/${uid}`), ref, db.doc(`${base}/deletedGames/${gameId}`));
    if (member.data()?.enabled !== true) throw new TeamError(403, 'FORBIDDEN', 'このチームの試合は操作できません。');
    if (!snapshot.exists || marker.exists) throw new TeamError(404, 'MISSING', 'この試合は完全に削除されています。');
    const game = snapshot.data()!;
    if (restore) {
      if (!game.trashedAt) return;
      if (typeof game.expiresAt !== 'number' || game.expiresAt <= now) throw new TeamError(409, 'EXPIRED', '復元できる期限を過ぎています。');
      const { trashedAt: _trashedAt, expiresAt: _expiresAt, archived: _archived, ...value } = game;
      tx.set(ref, { ...value, updatedAt: now });
      tx.delete(queue);
    } else if (!game.trashedAt) {
      const expiresAt = now + TRASH_RETENTION_MS;
      tx.update(ref, {
        trashedAt: now, expiresAt, updatedAt: now, generation: (game.generation ?? 0) + 1,
        quarters: (game.quarters ?? []).map((q: { endedAt: number | null; pausedAt?: number | null }) => q.endedAt == null && q.pausedAt == null ? { ...q, pausedAt: now } : q),
      });
      tx.set(queue, { teamId, gameId, expiresAt });
    }
  });
}
// Queue survives interrupted deletion; the marker blocks stale offline writes permanently.
export async function purgeExpiredGames(db: Firestore, now = Date.now(), budgetMs = 40_000) {
  const started = Date.now();
  const items = await db.collection('_gameTrash').where('expiresAt', '<=', now).limit(20).get();
  let deleted = 0;
  for (const item of items.docs) {
    if (Date.now() - started >= budgetMs) break;
    const { teamId, gameId } = item.data();
    if (typeof teamId !== 'string' || typeof gameId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(teamId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(gameId)) throw new Error('INVALID_TRASH_QUEUE');
    const ref = db.doc(`teams/${teamId}/games/${gameId}`);
    const marker = db.doc(`teams/${teamId}/deletedGames/${gameId}`);
    const claimed = await db.runTransaction(async tx => {
      const [job, game, tombstone] = await tx.getAll(item.ref, ref, marker);
      if (!job.exists || job.data()!.expiresAt > now) return false;
      if (!tombstone.exists && (!game.exists || !game.data()?.trashedAt || game.data()!.expiresAt > now)) { tx.delete(item.ref); return false; }
      tx.set(marker, { deletedAt: now });
      return true;
    });
    if (!claimed) continue;
    await db.recursiveDelete(ref);
    await item.ref.delete();
    deleted++;
  }
  return { deleted, remaining: (await db.collection('_gameTrash').where('expiresAt', '<=', now).limit(1).get()).size > 0 };
}
