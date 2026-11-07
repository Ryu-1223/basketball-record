import type { Plugin } from 'vite';
import type { TeamRequest, TeamResponse } from './http.ts';

// --mode emulatorだけで使う開発用のHTTPアダプター。本番の/api/teamと同じ処理を呼ぶ。
export function localTeamApi(): Plugin {
  return {
    name: 'local-team-api',
    configureServer(server) {
      for (const route of ['team', 'game']) server.middlewares.use(`/api/${route}`, async (request, response) => {
        const res = Object.assign(response, {
          status(code: number) { response.statusCode = code; return res; },
          json(value: unknown) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return res; },
        });
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 4096) { res.status(413).json({ error: '入力が長すぎます。' }); return; } chunks.push(chunk); }
          Object.assign(request, { body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined });
          const module = await server.ssrLoadModule(`/api/${route}.ts`);
          await module.default(request as TeamRequest, res as unknown as TeamResponse);
        } catch {
          res.status(503).json({ error: '開発用サーバーへ接続できません。エミュレーターの起動を確認してください。' });
        }
      });
    },
  };
}
