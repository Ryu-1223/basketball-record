import type { Game, Play, Player } from './domain';

export type SyncState = { pending: number; error: string | null; fromCache: boolean };
export type Stop = () => void;
export interface Repository {
  mode: 'local' | 'cloud';
  scope: string;
  watchPlayers: (cb: (players: Player[]) => void) => Stop;
  watchGames: (limit: number, cb: (games: Game[]) => void) => Stop;
  watchPlays: (gameId: string, cb: (plays: Play[]) => void) => Stop;
  watchSync: (cb: (state: SyncState) => void) => Stop;
  savePlayer: (player: Player) => Promise<void>;
  saveGame: (game: Game) => Promise<void>;
  savePlay: (play: Play) => Promise<void>;
  close: () => Promise<void>;
}

export function readableError(error: unknown) {
  const code = (error as { code?: string })?.code ?? '';
  if (code.includes('permission-denied')) return '保存権限を確認できません。管理者に連絡してください。';
  if (code.includes('unauthenticated') || code.includes('user-token-expired')) return '認証の有効期限が切れました。接続を確認してログインし直してください。';
  if (code.includes('quota') || code.includes('resource-exhausted')) return '保存先の利用上限に達しました。管理者に連絡してください。';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('invalid-login-credentials')) return '合言葉を確認してください。';
  if (code.includes('too-many-requests')) return '試行回数が多いため、少し待ってからお試しください。';
  if (code.includes('network-request-failed')) return '通信できません。接続を確認してください。';
  return error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。';
}
