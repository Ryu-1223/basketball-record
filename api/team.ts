import type { TeamRequest, TeamResponse } from '../server/http.js';
import { getBackend } from '../server/firebase.js';
import { TeamError, TeamService } from '../server/team-service.js';

export default async function handler(request: TeamRequest, response: TeamResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST'); return response.status(405).json({ error: 'この操作は利用できません。' });
  }
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== request.headers.host) return response.status(403).json({ error: 'この画面からは操作できません。' }); }
    catch { return response.status(403).json({ error: 'この画面からは操作できません。' }); }
  }
  if (!request.headers['content-type']?.startsWith('application/json')) return response.status(415).json({ error: '入力形式を確認してください。' });
  const body = request.body as { action?: unknown; passphrase?: unknown } | null;
  if (!body || typeof body !== 'object' || (body.action !== 'create' && body.action !== 'join') || typeof body.passphrase !== 'string' || body.passphrase.length > 256) {
    return response.status(400).json({ error: '合言葉を入力してください。' });
  }
  try {
    const { db, auth } = getBackend();
    const service = new TeamService(db, (uid, claims) => auth.createCustomToken(uid, claims), process.env.TEAM_PASSPHRASE_SECRET ?? '');
    const forwarded = request.headers['x-vercel-forwarded-for'] ?? request.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ?? request.socket.remoteAddress ?? 'unknown';
    await service.rateLimit(ip);
    const result = await service.access(body.action, body.passphrase);
    return response.status(200).json(result);
  } catch (error) {
    if (error instanceof TeamError) {
      if (error.status === 429) response.setHeader('Retry-After', '600');
      return response.status(error.status).json({ error: error.message, code: error.code });
    }
    // 合言葉・トークン・Googleの認証応答はログへ出さない。
    console.error('Team access failed', { code: (error as { code?: string }).code ?? 'SERVER_ERROR' });
    return response.status(503).json({ error: 'チームに接続できませんでした。少し待ってからもう一度お試しください。' });
  }
}
