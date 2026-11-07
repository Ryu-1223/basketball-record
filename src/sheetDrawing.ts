import { quarterLabel, type Game, type Play } from './domain';
import { foulMarks, points, runningScore, sheetFor, sheetWarnings, sideOf, sortPlays, teamFouls, timeoutMinute, type SheetInfo, type Side } from './to';

// All coordinates are millimetres. SVG preview, print view and PDF share these primitives.
export type Ink = '#111111' | '#c51e2b' | '#626262';
export type Shape =
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: Ink; width: number }
  | { kind: 'line'; x: number; y: number; x2: number; y2: number; weight: number; color: Ink }
  | { kind: 'circle'; x: number; y: number; radius: number; weight: number; color: Ink; filled: boolean };
export type SheetPage = { title: string; shapes: Shape[] };
export type OutputKind = 'all' | 'sheet' | 'stats';
const BLACK: Ink = '#111111', RED: Ink = '#c51e2b';
const color = (q: number): Ink => q === 1 || q === 3 ? RED : BLACK;
class Pen {
  shapes: Shape[] = [];
  text(x: number, y: number, text: string | number, size = 2.8, width = 180, ink: Ink = BLACK) {
    const str = String(text).replace(/[\r\n\t]/g, ' ');
    const units = [...str].reduce((n, c) => n + (c.charCodeAt(0) < 256 ? 0.57 : 1), 0);
    const fitted = Math.min(size, width / Math.max(1, units));
    this.shapes.push({ kind: 'text', x, y, text: str, size: fitted, width, color: ink });
  }
  line(x: number, y: number, x2: number, y2: number, weight = .18, ink: Ink = BLACK) { this.shapes.push({ kind: 'line', x, y, x2, y2, weight, color: ink }); }
  rect(x: number, y: number, w: number, h: number, weight = .18, ink: Ink = BLACK) { this.line(x, y, x + w, y, weight, ink); this.line(x + w, y, x + w, y + h, weight, ink); this.line(x, y + h, x + w, y + h, weight, ink); this.line(x, y, x, y + h, weight, ink); }
  circle(x: number, y: number, radius: number, ink: Ink = BLACK, filled = false, weight = .25) { this.shapes.push({ kind: 'circle', x, y, radius, color: ink, filled, weight }); }
  cross(x: number, y: number, size: number, ink: Ink) { this.line(x, y, x + size, y + size, .3, ink); this.line(x + size, y, x, y + size, .3, ink); }
  double(x: number, y: number, w: number, ink: Ink = BLACK) { this.line(x, y - .4, x + w, y - .4, .35, ink); this.line(x, y + .4, x + w, y + .4, .35, ink); }
}
function teamSide(sheet: SheetInfo, letter: 'A' | 'B'): Side { return sheet.ownSide === letter ? 'own' : 'opponent'; }
function teamHeader(p: Pen, sheet: SheetInfo) {
  const a = sheet[teamSide(sheet, 'A')], b = sheet[teamSide(sheet, 'B')];
  p.text(55, 9, 'BASKETBALL SCORESHEET', 4.5, 145);
  p.rect(10, 12, 190, 25, .35);
  p.text(12, 17, 'チームA', 2.4); p.text(26, 17, a.name, 3.4, 76);
  p.text(107, 17, 'チームB', 2.4); p.text(122, 17, b.name, 3.4, 75); p.line(10, 19, 200, 19);
  p.text(12, 23, `大会名  ${sheet.competition}`, 2.7, 90);
  p.text(12, 29, `Game No.  ${sheet.gameNo}`, 2.6, 40);
  p.text(52, 29, `場所  ${sheet.venue}`, 2.7, 49);
  p.text(105, 23, `クルーチーフ  ${sheet.officials.chief}`, 2.7, 92);
  p.text(105, 29, `1st アンパイア  ${sheet.officials.umpire1}`, 2.6, 45);
  p.text(151, 29, `2nd アンパイア  ${sheet.officials.umpire2}`, 2.6, 46);
}
function teamPanel(p: Pen, game: Game, plays: Play[], sheet: SheetInfo, letter: 'A' | 'B', top: number) {
  const side = teamSide(sheet, letter), team = sheet[side], x = 10, w = 98;
  const finished = game.status === 'finished';
  p.rect(x, top, w, 102, .35); p.text(12, top + 4, `チーム${letter}  ${team.name}`, 3, 94);
  p.text(12, top + 8, 'タイムアウト', 2.1, 25); p.text(53, top + 8, 'チームファウル', 2.1, 52);
  const timeouts = sortPlays(plays).filter(e => !e.cancelled && sideOf(e) === side && e.action === 'timeout');
  for (let row = 0; row < 3; row++) {
    const y = top + 9 + row * 4, capacity = row === 0 ? 2 : 3;
    const list = timeouts.filter(e => row === 0 ? e.quarter <= 2 : row === 1 ? e.quarter >= 3 && e.quarter <= 4 : e.quarter > 4);
    // In Q4, an unused early timeout expires when the last two minutes begin.
    const shift = row === 1 && list.length > 0 && list[0].quarter === 4 && list[0].details?.remainingSec != null && list[0].details.remainingSec <= 120 ? 1 : 0;
    for (let j = 0; j < capacity; j++) {
      const bx = 12 + j * 5; p.rect(bx, y, 5, 4);
      const event = list[j - shift];
      if (event) { const minute = timeoutMinute(sheet, event); if (minute !== null) p.text(bx + 1, y + 3, minute, 2.8, 3, color(event.quarter)); }
      else if (finished && team.checked.timeouts) p.double(bx + .5, y + 2, 4);
    }
    p.text(29, y + 3, row === 0 ? '前半' : row === 1 ? '後半' : '延長', 2.2, 17);
  }
  for (let q = 1; q <= 4; q++) {
    const bx = 53 + ((q - 1) % 2) * 26, by = top + 10 + Math.floor((q - 1) / 2) * 6;
    p.text(bx, by + 2.7, `${q}Q`, 2.1, 6);
    const count = teamFouls(plays, side, q);
    for (let j = 0; j < 4; j++) {
      const xx = bx + 6 + j * 4.3; p.rect(xx, by, 4.3, 4);
      p.text(xx + 1.4, by + 2.9, j + 1, 2.2, 3);
      if (j < count) p.cross(xx + .4, by + .4, 3.2, color(q));
      else if (team.checked.fouls && game.quarters[q - 1]?.endedAt != null && (q !== 4 || finished)) p.double(xx + .5, by + 2, 3.3);
    }
  }
  const cols = [10, 14, 25, 65, 72, 79, 84.8, 90.6, 96.4, 102.2, 108];
  const header = top + 24, start = header + 6, h = 3.5, bottom = start + 18 * h;
  for (const cx of cols) p.line(cx, header, cx, bottom);
  p.line(10, header, 108, header); p.line(10, start, 108, start);
  p.text(10.5, header + 4, 'No.', 1.9, 3); p.text(14.5, header + 3, 'License', 1.7, 10); p.text(15, header + 5.2, 'no.', 1.6, 8);
  p.text(26, header + 4, '選手氏名 Players', 2.3, 38); p.text(65.5, header + 4, 'No.', 2.2, 6); p.text(72.2, header + 2.6, 'Player', 1.7, 6.5); p.text(73.5, header + 5, 'in', 1.7, 5);
  p.text(84, header + 2.5, 'ファウル Fouls', 2, 23);
  for (let i = 0; i < 5; i++) p.text(cols[5 + i] + 2, header + 5, i + 1, 1.8, 3);
  team.players.slice(0, 18).forEach((player, i) => {
    const y = start + i * h;
    p.text(10.7, y + 2.6, i + 1, 2, 3); p.text(14.5, y + 2.6, player.license, 2.2, 10);
    p.text(25.6, y + 2.6, `${player.name}${player.captain ? ' (CAP)' : ''}`, 2.6, 38.5);
    p.text(66.1, y + 2.6, player.number, 2.7, 5.5);
    const first = sortPlays(plays).find(e => !e.cancelled && e.action === 'entry' && sideOf(e) === side && e.playerId === player.id);
    if (player.starter) { p.cross(74, y + .6, 2.2, BLACK); p.circle(75.1, y + 1.7, 1.5, RED); }
    else if (first) p.cross(74, y + .6, 2.2, color(first.quarter));
    const marks = foulMarks(plays, side, player.id);
    marks.forEach((mark, j) => {
      if (j < 5) { const cx = cols[5 + j]; p.text(cx + .4, y + 2.7, mark.code, 2.7, 4, color(mark.quarter)); if (mark.penalty) p.text(cx + 3, y + 3, mark.penalty, 1.7, 2, color(mark.quarter)); }
      else if (j === 5 && mark.code === 'GD') p.text(108.2, y + 2.6, 'GD', 2.2, 3.6, color(mark.quarter));
    });
    const firstHalf = Math.min(5, marks.filter(m => m.quarter <= 2).length);
    if (firstHalf && game.quarters[1]?.endedAt != null && team.checked.fouls) p.rect(79, y, firstHalf * 5.8, h, .4);
    if (finished && team.checked.fouls && marks.length < 5) p.line(79 + marks.length * 5.8, y + h / 2, 108, y + h / 2, .4);
  });
  for (let i = 0; i <= 18; i++) p.line(10, start + i * h, 108, start + i * h);
  if (team.checked.roster && team.players.length < 18) {
    const y = start + team.players.length * h;
    p.line(14, y, 108, y, .4); p.line(14, y, 108, bottom, .4);
  }
  for (let i = 0; i < 2; i++) {
    const y = bottom + i * 4.5, id = i ? '@assistant' : '@coach';
    p.line(10, y, 108, y); p.text(11, y + 3.3, i ? 'A.コーチ' : 'コーチ', 2.2, 17);
    p.text(28, y + 3.3, i ? team.assistantLicense : team.coachLicense, 2.2, 10);
    p.text(39, y + 3.3, i ? team.assistant : team.coach, 2.7, 39);
    p.text(69, y + 3.3, '', 2, 9); // The blank after the name is reserved for a handwritten signature.
    const marks = foulMarks(plays, side, id);
    for (let j = 0; j < 3; j++) {
      const bx = 90.6 + j * 5.8; p.rect(bx, y, 5.8, 4.5);
      const mark = marks[j];
      if (mark) { p.text(bx + .4, y + 3.3, mark.code, 2.5, 4, color(mark.quarter)); if (mark.penalty) p.text(bx + 3.2, y + 3.5, mark.penalty, 1.6, 2, color(mark.quarter)); }
      else if (finished && team.checked.fouls) p.line(bx, y + 2.2, bx + 5.8, y + 2.2, .4);
    }
    if (marks[3]?.code === 'GD') p.text(108.2, y + 3.2, 'GD', 2.2, 3.6);
  }
}
function runningPanel(p: Pen, game: Game, plays: Play[], sheet: SheetInfo, offset: number) {
  const x = 112, y = 49, rowH = 4.1;
  p.text(x + 11, 43, 'ランニングスコア  RUNNING SCORE', 2.6, 76);
  for (let group = 0; group < 4; group++) {
    const gx = x + group * 22;
    p.rect(gx, 45, 22, 4 + 40 * rowH, .3);
    p.text(gx + 5, 48, 'A', 2.5, 8); p.text(gx + 16, 48, 'B', 2.5, 5);
    for (let c = 1; c < 4; c++) p.line(gx + c * 5.5, y, gx + c * 5.5, y + rowH * 40, c === 2 ? .3 : .15);
    for (let row = 0; row <= 40; row++) p.line(gx, y + row * rowH, gx + 22, y + row * rowH, .12);
    for (let row = 0; row < 40; row++) { const n = group * 40 + row + 1; p.text(gx + 6, y + row * rowH + 2.9, n, 2.5, 5); p.text(gx + 11.5, y + row * rowH + 2.9, n, 2.5, 5); }
  }
  const position = (total: number, side: Side) => {
    const local = total - offset - 1, group = Math.floor(local / 40), row = local % 40;
    const a = sheet.ownSide === 'A' ? side === 'own' : side === 'opponent';
    return { x: x + group * 22 + (a ? 0 : 11), y: y + row * rowH, a };
  };
  for (const side of ['own', 'opponent'] as const) {
    const scores = runningScore(plays, side), team = sheet[side];
    for (const { play, total } of scores) {
      if (total <= offset || total > offset + 160) continue;
      const pos = position(total, side), sx = pos.x + (pos.a ? 5.5 : 0), nx = pos.x + (pos.a ? 0 : 5.5), ink = color(play.quarter);
      if (play.shot === 'ft') p.circle(sx + 2.75, pos.y + 2, .65, ink, true);
      else p.line(sx + .5, pos.y + 3.7, sx + 5, pos.y + .4, .4, ink);
      const player = team.players.find(a => a.id === play.playerId);
      p.text(nx + .6, pos.y + 2.9, player?.number ?? (side === 'opponent' && play.playerId !== '@unknown' ? play.playerId : '?'), 2.6, 4.5, ink);
      if (play.shot === '3') p.circle(nx + 2.75, pos.y + 2.05, 2, ink);
    }
    if (team.checked.score) {
      for (const q of game.quarters.filter(q => q.endedAt != null)) {
        const total = scores.filter(s => s.play.quarter <= q.number).at(-1)?.total ?? 0;
        if (total <= offset || total > offset + 160) continue;
        const pos = position(total, side), ink = color(q.number);
        p.circle(pos.x + (pos.a ? 8.25 : 2.75), pos.y + 2.05, 2.05, ink, false, .4);
        if (game.status === 'finished' && q.number === game.quarters.length) p.double(pos.x, pos.y + rowH, 11, BLACK);
        else p.line(pos.x, pos.y + rowH, pos.x + 11, pos.y + rowH, .4, ink);
      }
      if (game.status === 'finished') {
        const total = scores.at(-1)?.total ?? 0;
        for (let group = 0; group < 4; group++) {
          const first = Math.max(total + 1, offset + group * 40 + 1), last = offset + group * 40 + 40;
          if (first > last) continue;
          const start = position(first, side), end = position(last, side);
          p.line(start.x + .4, start.y + .4, end.x + 10.6, end.y + rowH - .4, .45);
        }
      }
    }
  }
  if (offset) p.text(112, 220, `続紙：目盛1＝${offset + 1}点、目盛160＝${offset + 160}点`, 2.7, 88);
}
function resultsPanel(p: Pen, game: Game, plays: Play[], sheet: SheetInfo) {
  const a = teamSide(sheet, 'A'), b = teamSide(sheet, 'B');
  p.rect(112, 216, 88, 37, .3); p.text(114, 220, 'スコア Score', 2.5, 26);
  for (let i = 1; i <= 5; i++) {
    const y = 221 + i * 5.6;
    p.text(119, y, i === 5 ? 'オーバータイム合計' : `第${i}クォーター`, 2.6, 35);
    for (const [side, letter, x] of [[a, 'A', 157], [b, 'B', 179]] as const) {
      p.text(x, y, letter, 2.4, 5);
      const played = i === 5 ? game.quarters.length > 4 : game.quarters.length >= i;
      const score = plays.filter(e => sideOf(e) === side && (i === 5 ? e.quarter > 4 : e.quarter === i)).reduce((n, e) => n + points(e), 0);
      if (played && (sheet[side].checked.score || score > 0)) p.text(x + 7, y, score, 2.8, 12, color(i));
      else if (!played && game.status === 'finished') p.line(x + 8, y + .3, x + 13, y - 2.5, .25);
    }
  }
  const totals = [a, b].map(side => plays.filter(e => sideOf(e) === side).reduce((n, e) => n + points(e), 0));
  p.rect(112, 257, 88, 27, .3);
  p.text(114, 262, `最終スコア  A ${sheet[a].checked.score || totals[0] ? totals[0] : '未記録'}   B ${sheet[b].checked.score || totals[1] ? totals[1] : '未記録'}`, 3, 84);
  const winner = game.status === 'finished' && sheet[a].checked.score && sheet[b].checked.score ? totals[0] > totals[1] ? sheet[a].name : totals[1] > totals[0] ? sheet[b].name : '同点' : '';
  p.text(114, 269, `勝者チーム  ${winner}`, 2.8, 83);
  p.text(114, 275, `終了時間  ${sheet.endTime}`, 2.6, 82);
  p.line(112, 277, 200, 277); p.text(114, 280, '抗議があるときのキャプテンのサイン', 1.8, 84); p.line(148, 283, 198, 283);
}
function signaturePanel(p: Pen, sheet: SheetInfo) {
  p.rect(10, 253, 98, 31, .3);
  const entries = [['スコアラー', sheet.officials.scorer], ['A.スコアラー', sheet.officials.assistantScorer], ['タイマー', sheet.officials.timer], ['ショットクロック', sheet.officials.shotClock], ['クルーチーフ', sheet.officials.chief], ['1st アンパイア', sheet.officials.umpire1], ['2nd アンパイア', sheet.officials.umpire2]];
  entries.forEach(([label, name], i) => { const y = 257 + i * 3.8; p.text(12, y, label, 2.1, 26); p.text(39, y, name, 2.4, 38); p.line(80, y + .6, 106, y + .6); });
  p.text(82, 283.5, '署名（手書き）', 1.8, 24);
}
function footer(p: Pen, page: number, title: string) { p.text(10, 291, `部内記録用・2024年様式 / ${title}`, 2.3, 170, '#626262'); p.text(190, 291, page, 2.3, 10); }
export function buildSheetPages(game: Game, plays: Play[], kind: OutputKind = 'all'): SheetPage[] {
  const sheet = sheetFor(game, plays), pages: SheetPage[] = [];
  const warnings = sheetWarnings(game, plays, sheet);
  const add = (p: Pen, title: string) => { footer(p, pages.length + 1, title); pages.push({ title, shapes: p.shapes }); };
  if (kind !== 'stats') {
    const p = new Pen(); teamHeader(p, sheet);
    p.text(12, 35, `日付  ${game.date}      時間  ${sheet.startTime}`, 2.7, 90);
    teamPanel(p, game, plays, sheet, 'A', 40); teamPanel(p, game, plays, sheet, 'B', 146);
    runningPanel(p, game, plays, sheet, 0); resultsPanel(p, game, plays, sheet); signaturePanel(p, sheet);
    if (warnings.length) p.text(112, 287, '未記入・未確認あり（補足参照）', 2.4, 86, '#626262');
    add(p, 'スコアシート');
    const maximum = Math.max(...(['own', 'opponent'] as const).map(side => runningScore(plays, side).at(-1)?.total ?? 0));
    for (let offset = 160; offset < maximum; offset += 160) { const next = new Pen(); teamHeader(next, sheet); runningPanel(next, game, plays, sheet, offset); add(next, `ランニングスコア続紙 ${offset + 1}〜${offset + 160}`); }
    const details: string[] = [...warnings];
    for (const side of ['own', 'opponent'] as const) {
      const team = sheet[side], label = side === 'own' ? '自チーム' : '相手';
      team.players.slice(18).forEach(player => { const first = sortPlays(plays).find(e => !e.cancelled && sideOf(e) === side && e.playerId === player.id && e.action === 'entry'); details.push(`${label} ${player.number} ${player.name} / License ${player.license} ${player.captain ? 'CAP' : ''} / ${player.starter ? '先発' : first ? `${quarterLabel(first.quarter)} 初出場` : '出場未記入'} / ${foulMarks(plays, side, player.id).map(m => `${quarterLabel(m.quarter)} ${m.code}${m.penalty}`).join(', ')}`); });
      for (const id of [...team.players.map(x => x.id), '@coach', '@assistant']) { const marks = foulMarks(plays, side, id); if (marks.length > (id.startsWith('@') ? 3 : 5)) details.push(`${label} ${team.players.find(x => x.id === id)?.number ?? id} ファウル全記録：${marks.map(m => `${quarterLabel(m.quarter)} ${m.code}${m.penalty}`).join(', ')}`); }
    }
    const toEvents = sortPlays(plays).filter(e => !e.cancelled && ['foul', 'timeout', 'entry'].includes(e.action));
    toEvents.forEach(e => { const side = sideOf(e), name = sheet[side].players.find(p => p.id === e.playerId); const target = e.playerId === '@team' ? '' : e.playerId === '@coach' ? 'ヘッドコーチ' : e.playerId === '@assistant' ? 'A.コーチ' : `${name?.number ?? e.playerId} ${name?.name ?? ''}`; details.push(`${side === 'own' ? '自' : '相手'} ${quarterLabel(e.quarter)} ${target}：${e.action === 'foul' ? `${e.details?.code}${e.details?.penalty ?? ''}${e.details?.countsTeam ? '（チームF加算）' : ''}` : e.action === 'entry' ? '初出場' : `タイムアウト ${timeoutMinute(sheet, e) ?? '未記入'}分目${e.details?.remainingSec != null ? `（残り${Math.floor(e.details.remainingSec / 60)}:${String(e.details.remainingSec % 60).padStart(2, '0')}）` : ''}`} ${e.details?.note ?? ''}`); });
    if (details.length) {
      let p = new Pen(), y = 24; p.text(10, 14, 'スコアシート補足・未確認事項', 4.5, 190);
      for (const detail of details) {
        const chars = [...detail];
        while (chars.length) { if (y > 278) { add(p, 'スコアシート補足'); p = new Pen(); p.text(10, 14, 'スコアシート補足（続き）', 4.5, 190); y = 24; } p.text(12, y, chars.splice(0, 60).join(''), 2.9, 186); y += 5; }
        y += 2;
      }
      add(p, 'スコアシート補足');
    }
  }
  if (kind !== 'sheet') {
    for (const side of ['own', 'opponent'] as const) {
      const team = sheet[side]; let p = new Pen(), y = 32;
      const full = side === 'own' ? game.recordMode !== 'scores' : game.kind === 'scrimmage' && (game.recordMode === 'both' || game.recordMode === undefined);
      const headers = full ? ['選手', '2点 成功/試投', '3点 成功/試投', 'FT 成功/試投', '得点', 'REB', 'パスカット'] : ['選手', '2点成功', '3点成功', 'FT成功', '得点'];
      const xs = full ? [10, 67, 95, 123, 153, 168, 183, 200] : [10, 84, 113, 142, 171, 200];
      function startPage() { p.text(10, 14, `選手別成績  ${side === 'own' ? '自チーム' : '相手'} ${team.name}`, 4, 190); p.text(10, 21, `${game.date}  対 ${game.opponent} / 時刻は省略・取消済み記録は除外`, 2.7, 190); headers.forEach((h, i) => p.text(xs[i] + 1, 29, h, 2.4, xs[i + 1] - xs[i] - 2)); p.line(10, 31, 200, 31, .3); }
      startPage();
      const rows = [...team.players.map(player => ({ name: `${player.number} ${player.name}`, id: player.id })), { name: 'チーム合計', id: null }];
      for (const row of rows) {
        // Long names must stay readable on paper instead of shrinking to fit one line.
        const nameChars = [...row.name];
        const nameLines: string[] = [];
        while (nameChars.length) nameLines.push(nameChars.splice(0, full ? 18 : 24).join(''));
        const rowHeight = Math.max(9, nameLines.length * 4 + 2);
        if (y + rowHeight > 278) { add(p, '選手別成績'); p = new Pen(); y = 32; startPage(); }
        const selected = plays.filter(e => !e.cancelled && sideOf(e) === side && (row.id === null || e.playerId === row.id));
        const cells = [row.name, ...(['2', '3', 'ft'] as const).map(shot => { const made = selected.filter(e => e.action === 'made' && e.shot === shot).length; const attempts = selected.filter(e => ['made', 'miss'].includes(e.action) && e.shot === shot).length; return full ? `${made} / ${attempts}` : String(made); }), String(selected.reduce((n, e) => n + points(e), 0)), ...(full ? [String(selected.filter(e => e.action === 'rebound').length), String(selected.filter(e => e.action === 'steal').length)] : [])];
        nameLines.forEach((line, i) => p.text(xs[0] + 1, y + 5 + i * 4, line, 2.8, xs[1] - xs[0] - 2));
        cells.slice(1).forEach((cell, i) => p.text(xs[i + 1] + 1, y + 5, cell, 2.8, xs[i + 2] - xs[i + 1] - 2));
        p.line(10, y + rowHeight - 2, 200, y + rowHeight - 2); y += rowHeight;
      }
      if (!team.checked.score || !full) p.text(10, y + 8, full ? '得点は未確認のため、記録された分の集計です。' : '得点のみ記録。シュート失敗・リバウンド等は未集計です。', 2.7, 190);
      add(p, '選手別成績');
    }
  }
  return pages;
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)); }
export function pageSvg(page: SheetPage) {
  const body = page.shapes.map(s => s.kind === 'text' ? `<text x="${s.x}" y="${s.y}" font-size="${s.size}" fill="${s.color}">${escape(s.text)}</text>` : s.kind === 'line' ? `<line x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}" stroke="${s.color}" stroke-width="${s.weight}"/>` : `<circle cx="${s.x}" cy="${s.y}" r="${s.radius}" stroke="${s.color}" stroke-width="${s.weight}" fill="${s.filled ? s.color : 'none'}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" role="img" aria-label="${escape(page.title)}" style="background:white;font-family:SheetJP,sans-serif">${body}</svg>`;
}
