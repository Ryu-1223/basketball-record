import { afterEach, expect, it, vi } from 'vitest';
import type { TeamRequest, TeamResponse } from '../server/http';
const backend = vi.hoisted(() => ({ db: {}, purge: vi.fn() }));
vi.mock('../server/firebase.js', () => ({ getBackend: () => ({ db: backend.db }) }));
vi.mock('../server/game-service.js', () => ({ purgeExpiredGames: backend.purge }));
import handler from '../api/cleanup-games';
afterEach(() => vi.unstubAllEnvs());
function response() {
  return { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as TeamResponse;
}
it('Cronの秘密値がない・一致しない呼び出しは削除を実行しない', async () => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  const res = response();
  await handler({ method: 'GET', headers: {} } as TeamRequest, res);
  expect(res.status).toHaveBeenCalledWith(401);
  await handler({ method: 'GET', headers: { authorization: 'Bearer invalid' } } as TeamRequest, res);
  expect(backend.purge).not.toHaveBeenCalled();
});
it('認証済みCronだけ実行し、失敗時は503を返す', async () => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  backend.purge.mockResolvedValueOnce({ deleted: 1, remaining: false });
  const req = { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } } as TeamRequest;
  const res = response();
  await handler(req, res);
  expect(res.json).toHaveBeenCalledWith({ deleted: 1, remaining: false });
  backend.purge.mockRejectedValueOnce({ code: 'unavailable' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
});
