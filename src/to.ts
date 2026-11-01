import { numberOrder, type Game, type Play, type RosterPlayer } from './domain';

export type Side = 'own' | 'opponent';
export type ToAction = 'foul' | 'timeout' | 'entry';
export type FoulCode = 'P' | 'T' | 'U' | 'D' | 'F' | 'C' | 'B' | 'M' | 'GD';
export type ToDetails = {
  code?: FoulCode; penalty?: '' | '1' | '2' | '3' | 'c'; countsTeam?: boolean;
  remainingSec?: number | null; note?: string;
};
export type SheetPlayer = RosterPlayer & { license: string; captain: boolean; starter: boolean };
export type Checked = { roster: boolean; entry: boolean; fouls: boolean; timeouts: boolean; score: boolean };
export type SheetTeam = { name: string; players: SheetPlayer[]; coach: string; assistant: string; coachLicense: string; assistantLicense: string; checked: Checked };
export type SheetInfo = {
  version: 1; ownSide: 'A' | 'B'; competition: string; gameNo: string; venue: string; startTime: string; endTime: string;
  quarterMinutes: number; overtimeMinutes: number;
  officials: { chief: string; umpire1: string; umpire2: string; scorer: string; assistantScorer: string; timer: string; shotClock: string };
  own: SheetTeam; opponent: SheetTeam;
};
export const toLabels = { foul: 'ファウル', timeout: 'タイムアウト', entry: '出場' } as const;
export const foulLabels: Record<FoulCode, string> = {
  P: 'P パーソナル', T: 'T テクニカル', U: 'U アンスポーツマンライク', D: 'D ディスクォリファイング',
  F: 'F ファイティングによる退場', C: 'C コーチ自身のテクニカル', B: 'B ベンチ等のテクニカル', M: 'M マンツーマンペナルティ', GD: 'GD 失格・退場の付記',
};
export const checkedLabels: Record<keyof Checked, string> = { roster: '名簿', entry: '先発・出場', fouls: 'ファウル', timeouts: 'タイムアウト', score: '得点' };
const blankTeam = (name: string): SheetTeam => ({ name, players: [], coach: '', assistant: '', coachLicense: '', assistantLicense: '', checked: { roster: false, entry: false, fouls: false, timeouts: false, score: false } });
export function newSheet(name = ''): SheetInfo {
  return { version: 1, ownSide: 'A', competition: '', gameNo: '', venue: '', startTime: '', endTime: '', quarterMinutes: 8, overtimeMinutes: 3,
    officials: { chief: '', umpire1: '', umpire2: '', scorer: '', assistantScorer: '', timer: '', shotClock: '' }, own: blankTeam(name), opponent: blankTeam('') };
}
export function sideOf(play: Play): Side { return play.side === 'opponent' ? 'opponent' : 'own'; }
export function isToAction(action: string): action is ToAction { return action === 'foul' || action === 'timeout' || action === 'entry'; }
export function sheetFor(game: Game, plays: Play[] = [], teamName = ''): SheetInfo {
  const sheet = structuredClone(game.sheet ?? newSheet(teamName));
  sheet.opponent.name ||= game.opponent;
  // Immutable match roster supplies identity; only sheet-specific fields are augmented.
  sheet.own.players = game.roster.map(p => ({ ...p, license: '', captain: false, starter: false, ...sheet.own.players.find(x => x.id === p.id), id: p.id, number: p.number }));
  for (const play of plays) {
    if (play.side === 'opponent' && !play.cancelled && validNumber(play.playerId) && !sheet.opponent.players.some(p => p.id === play.playerId)) {
      sheet.opponent.players.push({ id: play.playerId, number: play.playerId, name: '', license: '', captain: false, starter: false });
    }
  }
  for (const side of ['own', 'opponent'] as const) sheet[side].players.sort((a, b) => numberOrder(a.number) - numberOrder(b.number));
  return sheet;
}
export function validNumber(n: string) { return /^(?:[0-9]|[1-9][0-9]|00)$/.test(n); }
export function periodSeconds(sheet: SheetInfo, quarter: number) { return 60 * (quarter > 4 ? sheet.overtimeMinutes : sheet.quarterMinutes); }
export function timeoutMinute(sheet: SheetInfo, play: Play): number | null {
  const remaining = play.details?.remainingSec;
  if (remaining == null) return null;
  const duration = periodSeconds(sheet, play.quarter);
  if (remaining < 0 || remaining > duration) return null;
  return Math.max(1, Math.ceil((duration - remaining) / 60));
}
export function sortPlays(plays: Play[]) { return [...plays].sort((a, b) => a.quarter - b.quarter || (a.order ?? a.elapsedMs) - (b.order ?? b.elapsedMs) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)); }
export function points(play: Play) { return !play.cancelled && play.action === 'made' ? play.shot === '3' ? 3 : play.shot === '2' ? 2 : play.shot === 'ft' ? 1 : 0 : 0; }
export function runningScore(plays: Play[], side: Side) {
  let total = 0;
  return sortPlays(plays).filter(p => !p.cancelled && p.action === 'made' && sideOf(p) === side).map(play => {
    total += points(play); return { play, total };
  });
}
export function teamFouls(plays: Play[], side: Side, quarter: number) {
  return plays.filter(p => !p.cancelled && sideOf(p) === side && p.action === 'foul' && (quarter === 4 ? p.quarter >= 4 : p.quarter === quarter) && p.details?.countsTeam).length;
}
export type FoulMark = { code: string; penalty: string; quarter: number; generated?: boolean };
export function foulMarks(plays: Play[], side: Side, playerId: string): FoulMark[] {
  const events = sortPlays(plays).filter(p => !p.cancelled && sideOf(p) === side && p.action === 'foul' && p.playerId === playerId);
  const marks: FoulMark[] = []; let technical = 0, unsport = 0, coachC = 0, coachB = 0; let gd = false;
  for (const p of events) {
    const code = p.details?.code ?? 'P';
    if (code === 'GD' && gd) continue;
    marks.push({ code, penalty: p.details?.penalty ?? '', quarter: p.quarter });
    if (code === 'T') technical++; if (code === 'U') unsport++; if (code === 'C') coachC++; if (code === 'B') coachB++;
    if (code === 'GD') gd = true;
    const disqualified = playerId === '@coach' ? coachC >= 2 || coachC + coachB >= 3 : technical + unsport >= 2;
    if (disqualified && !gd) { marks.push({ code: 'GD', penalty: '', quarter: p.quarter, generated: true }); gd = true; }
  }
  return marks;
}
export function validateSheet(sheet: SheetInfo) {
  if (sheet.version !== 1 || !['A', 'B'].includes(sheet.ownSide)) throw new Error('スコアシートの形式を確認してください。');
  if (![sheet.quarterMinutes, sheet.overtimeMinutes].every(n => Number.isInteger(n) && n >= 1 && n <= 60)) throw new Error('競技時間は1〜60分で指定してください。');
  for (const side of ['own', 'opponent'] as const) {
    const team = sheet[side];
    if (team.players.length > 40) throw new Error('1チーム40人まで登録できます。');
    if (new Set(team.players.map(p => p.number)).size !== team.players.length || team.players.some(p => !validNumber(p.number))) throw new Error('背番号の重複や形式を確認してください。');
    if (team.players.filter(p => p.starter).length > 5) throw new Error('先発は各チーム5人までです。');
    if (team.players.filter(p => p.captain).length > 1) throw new Error('キャプテンは各チーム1人です。');
    if (team.checked.entry && team.players.filter(p => p.starter).length !== 5) throw new Error('出場を確認済みにする場合は先発5人を選んでください。');
    if (team.players.some(p => p.license && !/^\d{3}$/.test(p.license))) throw new Error('ライセンス番号は下3桁、または空欄にしてください。');
  }
}
export function validateToPlay(game: Game, play: Play) {
  const sheet = sheetFor(game);
  const maxQ = game.quarters.length + (play.action === 'foul' && game.status !== 'finished' && game.status !== 'running' ? 1 : 0);
  if (!Number.isInteger(play.quarter) || play.quarter < 1 || play.quarter > maxQ) throw new Error('記録するQを確認してください。');
  if (play.action === 'timeout') {
    if (play.playerId !== '@team') throw new Error('タイムアウトのチームを確認してください。');
    const sec = play.details?.remainingSec;
    if (sec != null && (!Number.isInteger(sec) || sec < 0 || sec > periodSeconds(sheet, play.quarter))) throw new Error('残り時間が競技時間を超えています。');
  } else {
    const side = sideOf(play);
    if (play.playerId !== '@coach' && play.playerId !== '@assistant' && !(side === 'own' ? game.roster.some(p => p.id === play.playerId) : validNumber(play.playerId))) throw new Error('選手を選んでください。');
    if (play.action === 'entry' && play.playerId.startsWith('@')) throw new Error('出場する選手を選んでください。');
    if (play.action === 'foul') {
      const code = play.details?.code;
      if (!code || !Object.hasOwn(foulLabels, code)) throw new Error('ファウルの種類を確認してください。');
      if (play.playerId.startsWith('@') && play.details?.countsTeam) throw new Error('コーチのファウルはチームファウルに含めません。');
      if (play.playerId === '@coach' ? ['P', 'T', 'U'].includes(code) : play.playerId === '@assistant' ? !['D', 'F', 'GD'].includes(code) : ['B', 'C', 'M'].includes(code)) throw new Error('対象者とファウルの種類を確認してください。');
    }
  }
}
export function sheetWarnings(game: Game, plays: Play[], sheet = sheetFor(game)) {
  const warnings: string[] = [];
  if (game.status !== 'finished') warnings.push('試合は終了していません。途中経過として出力します。');
  if (!sheet.competition || !sheet.venue || !sheet.startTime) warnings.push('大会名・会場・開始時刻に未記入の項目があります。');
  for (const side of ['own', 'opponent'] as const) {
    const team = sheet[side], name = side === 'own' ? '自チーム' : '相手';
    const unchecked = Object.entries(team.checked).filter(([, done]) => !done).map(([key]) => checkedLabels[key as keyof Checked]);
    if (unchecked.length) warnings.push(`${name}：${unchecked.join('・')}が未確認です。空欄や部分的な記録を含みます。`);
    if (!team.name || team.players.some(p => !p.name)) warnings.push(`${name}：チーム名または選手名が未記入です。`);
    if (team.players.length > 18) warnings.push(`${name}：19人目以降は続紙に記載します。`);
    if (plays.some(p => !p.cancelled && p.action === 'timeout' && sideOf(p) === side && timeoutMinute(sheet, p) === null)) warnings.push(`${name}：時間未記入のタイムアウトがあります。`);
    for (const p of team.players) if (plays.filter(x => !x.cancelled && x.action === 'entry' && sideOf(x) === side && x.playerId === p.id).length > 1) warnings.push(`${name} ${p.number}番：初出場が複数あり、最初の記録を使用します。`);
  }
  return warnings;
}

// Reindex the complete period so equal captured timestamps cannot lose insertion order.
export function insertPlay(plays: Play[], play: Play, beforeId?: string): Play[] {
  const list = sortPlays(plays.filter(p => !p.cancelled && p.quarter === play.quarter && p.id !== play.id));
  const index = beforeId ? list.findIndex(p => p.id === beforeId) : -1;
  list.splice(index < 0 ? list.length : index, 0, play);
  return list.map((p, i) => ({ ...p, order: (i + 1) * 1000, updatedAt: play.updatedAt }));
}

export function appendPlay(plays: Play[], play: Play): Play {
  const latest = Math.max(-1000, ...plays.filter(p => !p.cancelled && p.quarter === play.quarter).map(p => p.order ?? p.elapsedMs));
  return { ...play, order: latest + 1000 };
}
