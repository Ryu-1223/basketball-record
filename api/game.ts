import type { TeamRequest, TeamResponse } from '../server/http.js';
import { getBackend } from '../server/firebase.js';
import { deleteGame } from '../server/game-service.js';
import { TeamError } from '../server/team-service.js';

export default async function handler(request: TeamRequest, response: TeamResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'DELETE') {
    response.setHeader('Allow', 'DELETE');
    return response.status(405).json({ error: 'この操作は利用できません。' });
  }
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== request.headers.host) return response.status(403).json({ error: 'この画面からは操作できません。' }); }
    catch { return response.status(403).json({ error: 'この画面からは操作できません。' }); }
  }
  if (!request.headers['content-type']?.startsWith('application/json')) return response.status(415).json({ error: '入力形式を確認してください。' });
  const gameId = (request.body as { gameId?: unknown } | undefined)?.gameId;
  if (typeof gameId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(gameId)) return response.status(400).json({ error: '削除する試合を確認してください。' });
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return response.status(401).json({ error: 'チームに参加し直してください。' });
  try {
    const { db, auth } = getBackend();
    const token = await auth.verifyIdToken(authorization.slice(7));
    if (typeof token.teamId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(token.teamId)) return response.status(403).json({ error: 'このチームの試合は削除できません。' });
    await deleteGame(db, token.uid, token.teamId, gameId);
    return response.status(200).json({ deleted: true });
  } catch (error) {
    if (error instanceof TeamError) return response.status(error.status).json({ error: error.message });
    const code = String((error as { code?: unknown }).code ?? '');
    if (code.startsWith('auth/')) return response.status(401).json({ error: '認証を確認して、もう一度お試しください。' });
    console.error('Game deletion failed', { code });
    return response.status(503).json({ error: '削除を完了できませんでした。同じ試合の削除をもう一度お試しください。' });
  }
}
