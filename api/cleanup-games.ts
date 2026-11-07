import { timingSafeEqual } from 'node:crypto';
import type { TeamRequest, TeamResponse } from '../server/http.js';
import { getBackend } from '../server/firebase.js';
import { purgeExpiredGames } from '../server/game-service.js';
export default async function handler(request: TeamRequest, response: TeamResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.authorization;
  if (!secret || !supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${secret}`) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${secret}`))) return response.status(401).json({ error: 'UNAUTHORIZED' });
  try { return response.status(200).json(await purgeExpiredGames(getBackend().db)); }
  catch (error) { console.error('Trash cleanup failed', { code: String((error as { code?: unknown }).code ?? '') }); return response.status(503).json({ error: 'CLEANUP_FAILED' }); }
}
