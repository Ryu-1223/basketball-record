export type Player = { id: string; name: string; number: string; active: boolean };
export type RosterPlayer = Pick<Player, 'id' | 'name' | 'number'>;
export type Quarter = { number: number; startedAt: number; endedAt: number | null };
export type Game = {
  id: string; opponent: string; date: string; roster: RosterPlayer[];
  status: 'ready' | 'running' | 'interval' | 'finished';
  quarters: Quarter[]; createdAt: number; updatedAt: number; opponentTracking?: boolean;
};
export const actionLabels = {
  miss: 'シュート外', made: 'シュート決', rebound: 'リバウンド', steal: 'パスカット',
} as const;
export type Action = keyof typeof actionLabels;
export type Shot = '2' | '3' | 'ft';
export type Play = {
  id: string; gameId: string; quarter: number; elapsedMs: number;
  playerId: string; action: Action; shot: Shot | null;
  createdAt: number; updatedAt: number; cancelled: boolean; side?: 'opponent';
};
export type Draft = Pick<Play, 'id' | 'gameId' | 'quarter' | 'elapsedMs' | 'action' | 'createdAt'> & { playerId?: string };

export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function elapsed(quarter: Quarter | undefined, now: number) {
  return quarter ? Math.max(0, (quarter.endedAt ?? now) - quarter.startedAt) : 0;
}
export function isShot(action: Action) { return action === 'made' || action === 'miss'; }
export function playLabel(play: Pick<Play, 'action' | 'shot'>) {
  if (!isShot(play.action)) return actionLabels[play.action];
  return `${play.shot === 'ft' ? 'フリースロー' : `${play.shot}点シュート`}${play.action === 'made' ? '成功' : '失敗'}`;
}
export function sortPlayers<T extends RosterPlayer>(players: T[]) {
  return [...players].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));
}
export function validatePlayer(player: Player, others: Player[]) {
  if (!player.name.trim() || player.name.trim().length > 40) throw new Error('名前は1〜40文字で入力してください。');
  if (!/^(?:[0-9]|[1-9][0-9]|00)$/.test(player.number)) throw new Error('背番号は0〜99、または00で入力してください。');
  if (player.active && others.some(p => p.id !== player.id && p.active && p.number === player.number)) throw new Error('この背番号は登録済みです。');
}
export function transition(game: Game, command: 'start' | 'endQuarter' | 'next' | 'undoEnd' | 'finish', now: number): Game {
  const next = structuredClone(game);
  const q = next.quarters.at(-1);
  if ((command === 'start' && game.status === 'ready') || (command === 'next' && game.status === 'interval')) {
    next.quarters.push({ number: next.quarters.length + 1, startedAt: now, endedAt: null });
    next.status = 'running';
  } else if (command === 'endQuarter' && game.status === 'running' && q) {
    if (now < q.startedAt) throw new Error('端末の時刻を確認してください。');
    q.endedAt = now; next.status = 'interval';
  } else if (command === 'undoEnd' && game.status === 'interval' && q) {
    q.endedAt = null; next.status = 'running';
  } else if (command === 'finish' && game.status === 'interval') {
    next.status = 'finished';
  } else throw new Error('この操作は現在の試合状態では行えません。');
  next.updatedAt = now;
  return next;
}
export function beginPlay(game: Game, action: Action, now: number, id: string = crypto.randomUUID()): Draft {
  const q = game.quarters.at(-1);
  if (game.status !== 'running' || !q) throw new Error('Qを開始してから記録してください。');
  if (now < q.startedAt) throw new Error('端末の時刻が変更されています。時刻を確認してください。');
  return { id, gameId: game.id, quarter: q.number, elapsedMs: now - q.startedAt, action, createdAt: now };
}
export function completePlay(game: Game, draft: Draft, playerId: string, shot: Shot | null, now: number): Play {
  if (draft.gameId !== game.id || !game.roster.some(p => p.id === playerId)) throw new Error('この試合の選手を選んでください。');
  if (game.status !== 'running' || draft.quarter !== game.quarters.at(-1)?.number) throw new Error('Qの状態が変わりました。もう一度記録してください。');
  if (isShot(draft.action) && !shot) throw new Error('シュートの種類を選んでください。');
  return { ...draft, playerId, shot: isShot(draft.action) ? shot : null, cancelled: false, updatedAt: now };
}
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
