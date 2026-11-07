// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { type Game, type Play, sortPlayers } from './domain';
import { appendPlay, insertPlay, newSheet, sheetFor, timeoutMinute, teamFouls, foulMarks, runningScore, validateToPlay, sheetWarnings } from './to';
import { buildSheetPages, pageSvg } from './sheetDrawing';
import { createSheetPdf } from './sheetPdf';

const roster = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, number: i === 0 ? '00' : String(i - 1), name: ['田中 美咲', '佐藤 遥', '鈴木 陽菜', '山田 葵', '高橋 結衣'][i % 5] }));
function gameFixture(): Game {
  const g: Game = { id: 'sample', opponent: '青空中学校', date: '2026-11-02', roster, quarters: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, startedAt: 1000 + i * 700000, endedAt: 601000 + i * 700000 })), status: 'finished', createdAt: 1, updatedAt: 1, opponentTracking: true, sheet: newSheet('さくら中学校') };
  const s = sheetFor(g); s.competition = '秋季バスケットボール大会'; s.gameNo = '12'; s.venue = '中央体育館'; s.startTime = '10:30'; s.endTime = '12:02';
  s.officials = { chief: '東京 一郎', umpire1: '大阪 次郎', umpire2: '福岡 三郎', scorer: '記録 担当', assistantScorer: '補助 担当', timer: '時計 担当', shotClock: '計時 担当' };
  for (const side of ['own', 'opponent'] as const) {
    s[side].players = roster.map((p, i) => ({ ...p, id: side === 'own' ? p.id : p.number, name: side === 'own' ? p.name : `相手 ${i + 1}`, license: String(100 + i), starter: i < 5, captain: i === 0 }));
    s[side].coach = '山田 コーチ'; s[side].assistant = '佐藤 コーチ'; s[side].checked = { roster: true, entry: true, fouls: true, timeouts: true, score: true };
  }
  g.sheet = s; return g;
}
function event(id: number, overrides: Partial<Play> = {}): Play { return { id: `e${id}`, gameId: 'sample', quarter: 1, elapsedMs: id * 1000, playerId: 'p0', action: 'made', shot: '2', createdAt: id + 1, updatedAt: id + 1, cancelled: false, ...overrides }; }
function samplePlays(): Play[] {
  const plays: Play[] = [];
  for (let i = 0; i < 82; i++) plays.push(event(i, { quarter: Math.min(6, Math.floor(i / 14) + 1), playerId: `p${i % 18}`, shot: i % 7 === 0 ? '3' : i % 5 === 0 ? 'ft' : '2' }));
  for (let i = 0; i < 35; i++) plays.push(event(100 + i, { side: 'opponent', playerId: String(i % 12), quarter: Math.min(6, Math.floor(i / 6) + 1), shot: i % 3 === 0 ? '3' : '2' }));
  plays.push(event(200, { action: 'foul', shot: null, details: { code: 'P', penalty: '2', countsTeam: true } }), event(201, { quarter: 2, action: 'foul', shot: null, details: { code: 'T', penalty: '1', countsTeam: true } }), event(202, { quarter: 4, action: 'foul', shot: null, details: { code: 'U', penalty: 'c', countsTeam: true } }));
  plays.push(event(203, { action: 'timeout', shot: null, quarter: 4, playerId: '@team', details: { remainingSec: 119 } }), event(204, { action: 'entry', shot: null, quarter: 3, playerId: 'p15', details: {} }));
  plays.push(event(205, { action: 'foul', shot: null, quarter: 3, playerId: '@coach', details: { code: 'B', penalty: '1', countsTeam: false, note: 'ベンチのテクニカル' } }));
  return plays;
}
describe('TO記録と帳票', () => {
  it('00を0より前に並べる', () => { expect(sortPlayers([roster[1], roster[0]]).map(p => p.number)).toEqual(['00', '0']); });
  it('競技時計の分境界を換算し、未記録はゼロにしない', () => {
    const s = newSheet();
    expect(timeoutMinute(s, event(1, { action: 'timeout', details: { remainingSec: 224 } }))).toBe(5);
    expect(timeoutMinute(s, event(1, { details: { remainingSec: 420 } }))).toBe(1);
    expect(timeoutMinute(s, event(1, { details: { remainingSec: 419 } }))).toBe(2);
    expect(timeoutMinute(s, event(1, { details: { remainingSec: 480 } }))).toBe(1);
    expect(timeoutMinute(s, event(1, { quarter: 5, details: { remainingSec: 13 } }))).toBe(3);
    expect(timeoutMinute(s, event(1))).toBeNull();
    s.quarterMinutes = 10; expect(timeoutMinute(s, event(1, { details: { remainingSec: 224 } }))).toBe(7);
  });
  it('延長のチームファウルは第4Qへ加算しコーチ分と取消を除く', () => {
    const list = [event(1, { quarter: 4, action: 'foul', details: { countsTeam: true } }), event(2, { quarter: 5, action: 'foul', details: { countsTeam: true } }), event(3, { quarter: 6, action: 'foul', playerId: '@coach', details: { countsTeam: false } }), event(4, { quarter: 4, action: 'foul', cancelled: true, details: { countsTeam: true } })];
    expect(teamFouls(list, 'own', 4)).toBe(2);
  });
  it('TとUの累積でGDを付記し、訂正で解消する', () => {
    const list = [event(1, { action: 'foul', details: { code: 'T' } }), event(2, { quarter: 2, action: 'foul', details: { code: 'U', penalty: '2' } })];
    expect(foulMarks(list, 'own', 'p0').map(m => m.code)).toEqual(['T', 'U', 'GD']);
    expect(foulMarks([list[0], { ...list[1], cancelled: true }], 'own', 'p0')).toHaveLength(1);
  });
  it('得点の挿入・取消・並べ替え後に累計を再計算する', () => {
    const list = [event(1), event(2, { shot: '3', order: 500 }), event(3, { shot: 'ft' }), event(4, { cancelled: true })];
    expect(runningScore(list, 'own').map(x => [x.play.id, x.total])).toEqual([['e2', 3], ['e1', 5], ['e3', 6]]);
  });
  it('同時刻の記録の間にも指定位置へ挿入し、元の記録は変更しない', () => {
    const list = [event(1, { elapsedMs: 0 }), event(2, { elapsedMs: 0 })];
    const inserted = insertPlay(list, event(3, { elapsedMs: 0, shot: '3' }), 'e2');
    expect(runningScore(inserted, 'own').map(x => [x.play.id, x.total])).toEqual([['e1', 2], ['e3', 5], ['e2', 7]]);
    expect(list.every(p => p.order === undefined)).toBe(true);
    expect(runningScore([...inserted, appendPlay(inserted, event(4, { elapsedMs: 1 }))], 'own').at(-1)?.play.id).toBe('e4');
  });
  it('Q間のファウルは次のQに記録でき、公式残り時間の範囲を検証する', () => {
    const g = gameFixture(); g.status = 'interval';
    expect(() => validateToPlay(g, event(1, { quarter: 7, action: 'foul', details: { code: 'P', countsTeam: true } }))).not.toThrow();
    expect(() => validateToPlay(g, event(2, { quarter: 6, action: 'timeout', playerId: '@team', details: { remainingSec: 181 } }))).toThrow();
  });
  it('旧形式の試合は未知の情報を空欄にし、元データを変更しない', () => {
    const g = gameFixture(); delete g.sheet; delete g.opponentTracking;
    const before = JSON.stringify(g); const s = sheetFor(g, []);
    expect(s.opponent.players).toHaveLength(0); expect(s.opponent.checked.score).toBe(false);
    expect(sheetWarnings(g, []).join('')).toContain('未確認');
    expect(JSON.stringify(g)).toBe(before);
  });
  it('18人超過・160点超過は続紙に残し、色と日付を保持する', () => {
    const g = gameFixture(), plays = samplePlays();
    const pages = buildSheetPages(g, plays);
    expect(pages.some(p => p.title.includes('161'))).toBe(true);
    const text = pages.flatMap(p => p.shapes.filter(s => s.kind === 'text').map(s => s.text)).join(' ');
    expect(text).toContain('自チーム 17'); expect(text).toContain('2026-11-02'); expect(text).toContain('ベンチのテクニカル');
    expect(pages[0].shapes.some(s => s.color === '#c51e2b')).toBe(true);
    expect(pageSvg(pages[0])).not.toContain('<script');
    for (const page of pages) for (const s of page.shapes) { expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(210); expect(s.y).toBeLessThanOrEqual(297); }
  });
  it('部内ゲームは相手組の試投とリバウンドも成績ページに出力する', () => {
    const g = gameFixture(); g.kind = 'scrimmage'; g.recordMode = 'both';
    const pages = buildSheetPages(g, [event(1, { side: 'opponent', playerId: '0', action: 'miss', shot: '2' }), event(2, { side: 'opponent', playerId: '0', action: 'rebound', shot: null })], 'stats');
    const texts = pages[1].shapes.filter(s => s.kind === 'text').map(s => s.text);
    expect(texts).toContain('2点 成功/試投'); expect(texts).toContain('0 / 1'); expect(texts).toContain('REB');
  });
  it('長い選手名は成績表で読める大きさに保ち、複数行に折り返す', () => {
    const g = gameFixture();
    const name = '長'.repeat(40);
    g.sheet!.own.players[0].name = name;
    const pages = buildSheetPages(g, [], 'stats');
    const pieces = pages.flatMap(p => p.shapes).filter(s => s.kind === 'text' && s.text.includes('長'));
    expect(pieces.map(s => s.kind === 'text' ? s.text : '').join('')).toContain(name);
    expect(pieces.every(s => s.kind === 'text' && s.size >= 2.8)).toBe(true);
  });
  it('日本語フォント埋め込み済みのA4 PDFを再読込できる', async () => {
    const pages = buildSheetPages(gameFixture(), samplePlays());
    const bytes = await createSheetPdf(pages, new Uint8Array(readFileSync('public/fonts/NotoSansJP.ttf')));
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(pages.length);
    expect(loaded.getPages()[0].getWidth()).toBeCloseTo(595.28, 1);
    if (process.env.RENDER_SHEET_FIXTURES === '1') { mkdirSync('tmp/pdfs', { recursive: true }); writeFileSync('tmp/pdfs/to-sheet-sample.pdf', bytes); writeFileSync('tmp/pdfs/to-sheet-sample.svg', pageSvg(pages[0])); }
  }, 30000);
});
