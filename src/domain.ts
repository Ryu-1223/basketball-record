import type { SheetInfo, ToDetails, ToAction } from './to';
export type Player = { id: string; name: string; number: string; active: boolean };
export type RosterPlayer = Pick<Player, 'id' | 'name' | 'number'>;
export type Quarter = { number: number; startedAt: number; endedAt: number | null; pausedAt?: number | null; pausedMs?: number };
export type Game = {
  id: string; opponent: string; date: string; roster: RosterPlayer[];
  status: 'ready' | 'running' | 'interval' | 'finished';
  recordChecked?: { own?: { shots?: boolean; rebound?: boolean; steal?: boolean }; opponent?: { shots?: boolean; rebound?: boolean; steal?: boolean } };
  kind?: 'scrimmage'; recordMode?: 'scores' | 'own' | 'both'; opponentRoster?: (RosterPlayer & { memberId: string })[]; sessionId?: string; archived?: boolean;
  quarters: Quarter[]; createdAt: number; updatedAt: number; opponentTracking?: boolean; sheet?: SheetInfo;
};
export const actionLabels = {
  miss: 'シュート外', made: 'シュート決', rebound: 'リバウンド', steal: 'パスカット',
} as const;
export type Action = keyof typeof actionLabels;
export type Shot = '2' | '3' | 'ft';
export type Play = {
  id: string; gameId: string; quarter: number; elapsedMs: number;
  playerId: string; action: Action | ToAction; shot: Shot | null;
  createdAt: number; updatedAt: number; cancelled: boolean; side?: 'opponent';
  details?: ToDetails;
  order?: number;
};
export type Draft = Pick<Play, 'id' | 'gameId' | 'quarter' | 'elapsedMs' | 'createdAt'> & { action: Action; playerId?: string; side?: 'opponent' };

export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function elapsed(quarter: Quarter | undefined, now: number) {
  return quarter ? Math.max(0, (quarter.pausedAt ?? quarter.endedAt ?? now) - quarter.startedAt - (quarter.pausedMs ?? 0)) : 0;
}
export function isShot(action: Play['action']) { return action === 'made' || action === 'miss'; }
export function playLabel(play: Pick<Play, 'action' | 'shot' | 'details'>) {
  if (play.action === 'foul') return `ファウル ${play.details?.code ?? ''}${play.details?.penalty ?? ''}${play.details?.note ? ` (${play.details.note})` : ''}`;
  if (play.action === 'timeout') return `タイムアウト${play.details?.remainingSec != null ? `・残り${formatTime(play.details.remainingSec * 1000)}` : '・時間未記入'}`;
  if (play.action === 'entry') return '初出場';
  if (!isShot(play.action)) return actionLabels[play.action];
  return `${play.shot === 'ft' ? 'フリースロー' : `${play.shot}点シュート`}${play.action === 'made' ? '成功' : '失敗'}`;
}
export function sortPlayers<T extends RosterPlayer>(players: T[]) {
  return [...players].sort((a, b) => numberOrder(a.number) - numberOrder(b.number));
}
export function numberOrder(number: string) { return number === '00' ? -1 : Number(number); }
export function quarterLabel(number: number) { return number <= 4 ? `第${number}Q` : `延長${number - 4}`; }
export function periodLabel(game: Game, n: number) { return game.kind === 'scrimmage' ? `${n}本目` : quarterLabel(n); }
export function validatePlayer(player: Player, others: Player[]) {
  if (!player.name.trim() || player.name.trim().length > 40) throw new Error('名前は1〜40文字で入力してください。');
  if (!/^(?:[0-9]|[1-9][0-9]|00)$/.test(player.number)) throw new Error('背番号は0〜99、または00で入力してください。');
  if (player.active && others.some(p => p.id !== player.id && p.active && p.number === player.number)) throw new Error('この背番号は登録済みです。');
}
export function transition(game: Game, command: 'start' | 'endQuarter' | 'next' | 'undoEnd' | 'finish' | 'undoFinish' | 'pause' | 'resume', now: number): Game {
  const next = structuredClone(game);
  const q = next.quarters.at(-1);
  if ((command === 'start' && game.status === 'ready') || (command === 'next' && game.status === 'interval')) {
    next.quarters.push({ number: next.quarters.length + 1, startedAt: now, endedAt: null });
    next.status = 'running';
  } else if (command === 'pause' && game.status === 'running' && q && q.pausedAt == null) {
    if (now < q.startedAt) throw new Error('端末の時刻を確認してください。');
    q.pausedAt = now;
  } else if (command === 'resume' && game.status === 'running' && q && q.pausedAt != null) {
    if (now < q.pausedAt) throw new Error('端末の時刻を確認してください。');
    q.pausedMs = (q.pausedMs ?? 0) + now - q.pausedAt;
    q.pausedAt = null;
  } else if (command === 'endQuarter' && game.status === 'running' && q) {
    if (now < q.startedAt) throw new Error('端末の時刻を確認してください。');
    q.endedAt = now; next.status = 'interval';
  } else if (command === 'undoEnd' && game.status === 'interval' && q) {
    q.endedAt = null; next.status = 'running';
  } else if (command === 'finish' && game.status === 'interval') {
    next.status = 'finished';
    if (next.sheet && !next.sheet.endTime) next.sheet.endTime = new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  } else if (command === 'undoFinish' && game.status === 'finished') {
    next.status = 'interval';
  } else throw new Error('この操作は現在の試合状態では行えません。');
  next.updatedAt = now;
  return next;
}
export function beginPlay(game: Game, action: Action, now: number, id: string = crypto.randomUUID()): Draft {
  const q = game.quarters.at(-1);
  if (game.status !== 'running' || !q) throw new Error('Qを開始してから記録してください。');
  if (now < q.startedAt) throw new Error('端末の時刻が変更されています。時刻を確認してください。');
  return { id, gameId: game.id, quarter: q.number, elapsedMs: elapsed(q, now), action, createdAt: now };
}
export function completePlay(game: Game, draft: Draft, playerId: string, shot: Shot | null, now: number): Play {
  if (draft.gameId !== game.id || !((playerId === '@unknown' && draft.action === 'made') || (draft.side === 'opponent' ? game.opponentRoster?.some(p => p.id === playerId) : game.roster.some(p => p.id === playerId)))) throw new Error('この試合の選手を選んでください。');
  if (game.status !== 'running' || draft.quarter !== game.quarters.at(-1)?.number) throw new Error('Qの状態が変わりました。もう一度記録してください。');
  if (isShot(draft.action) && !shot) throw new Error('シュートの種類を選んでください。');
  return { ...draft, playerId, shot: isShot(draft.action) ? shot : null, cancelled: false, updatedAt: now };
}
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
