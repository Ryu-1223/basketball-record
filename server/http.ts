import type { IncomingMessage, ServerResponse } from 'node:http';

// VercelのNode関数とローカルHTTPアダプターが使う範囲だけを定義する。
export type TeamRequest = IncomingMessage & { body?: unknown };
export type TeamResponse = ServerResponse & {
  status: (code: number) => TeamResponse;
  json: (value: unknown) => TeamResponse;
};
