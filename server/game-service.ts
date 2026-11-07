import type { Firestore } from '@google-cloud/firestore';
import { TeamError } from './team-service.js';

export async function deleteGame(db: Firestore, uid: string, teamId: string, gameId: string) {
  const teamPath = `teams/${teamId}`;
  await db.runTransaction(async tx => {
    const member = await tx.get(db.doc(`${teamPath}/members/${uid}`));
    if (member.data()?.enabled !== true) throw new TeamError(403, 'FORBIDDEN', 'このチームの試合は削除できません。');
    // Keep a marker so stale offline writes cannot recreate a deleted match.
    tx.set(db.doc(`${teamPath}/deletedGames/${gameId}`), { deletedAt: Date.now() });
  });
  // Retrying also completes an interrupted deletion, including its subcollections.
  await db.recursiveDelete(db.doc(`${teamPath}/games/${gameId}`));
}
