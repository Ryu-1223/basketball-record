import { describe, expect, it } from 'vitest';
import { beginPlay, completePlay, elapsed, formatTime, transition, validatePlayer, type Game } from './domain';

const ready: Game = { id: 'game', opponent: '相手校', date: '2026-11-01', roster: [{ id: 'p7', number: '7', name: '田中' }], quarters: [], status: 'ready', createdAt: 1, updatedAt: 1 };

it('一時停止中も記録でき、再開後は停止時間を除いて計測する', () => {
  let game = transition(ready, 'start', 1000);
  game = transition(game, 'pause', 4000);
  expect(elapsed(game.quarters[0], 9000)).toBe(3000);
  expect(beginPlay(game, 'made', 9000, 'play').elapsedMs).toBe(3000);
  game = transition(JSON.parse(JSON.stringify(game)), 'resume', 10000);
  expect(elapsed(game.quarters[0], 12000)).toBe(5000);
  game = transition(game, 'pause', 13000);
  game = transition(game, 'endQuarter', 20000);
  expect(elapsed(game.quarters[0], 30000)).toBe(6000);
  game = transition(game, 'undoEnd', 30000);
  expect(elapsed(game.quarters[0], 40000)).toBe(6000);
});
describe('Qごとの経過時間と記録', () => {
  it('制限時間がなく、中断を含めた15分後も経過時間を表示する', () => {
    const game = transition(ready, 'start', 10_000);
    expect(formatTime(elapsed(game.quarters[0], 910_000))).toBe('15:00');
    expect(game.status).toBe('running');
  });
  it('選手・種別選択にかかった時間をプレー時刻に加えない', () => {
    const game = transition(ready, 'start', 10_000);
    const draft = beginPlay(game, 'made', 342_000, 'operation-1');
    const play = completePlay(game, draft, 'p7', '3', 347_000);
    expect(formatTime(play.elapsedMs)).toBe('05:32');
    expect(play.shot).toBe('3'); expect(play.id).toBe('operation-1');
  });
  it('Q間の休憩を次のQに含めず、Q終了の取消では元の起点を使う', () => {
    let game = transition(ready, 'start', 1_000);
    game = transition(game, 'endQuarter', 601_000);
    expect(elapsed(game.quarters[0], 700_000)).toBe(600_000);
    game = transition(game, 'undoEnd', 701_000);
    expect(elapsed(game.quarters[0], 702_000)).toBe(701_000);
    game = transition(game, 'endQuarter', 703_000);
    game = transition(game, 'next', 800_000);
    expect(game.quarters[1].number).toBe(2);
    expect(elapsed(game.quarters[1], 805_000)).toBe(5_000);
  });
  it('再読み込み用に保存・復元しても計測の起点が変わらない', () => {
    const game = transition(ready, 'start', 50_000);
    const restored = JSON.parse(JSON.stringify(game)) as Game;
    expect(elapsed(restored.quarters[0], 110_000)).toBe(60_000);
  });
  it('未開始・Q間・終了後は新規プレーを登録できない', () => {
    expect(() => beginPlay(ready, 'rebound', 1_000)).toThrow();
    const game = transition(transition(ready, 'start', 1_000), 'endQuarter', 2_000);
    expect(() => beginPlay(game, 'rebound', 3_000)).toThrow();
    expect(() => transition(game, 'start', 4_000)).toThrow();
  });
  it('時刻の逆行と別Qに移った未確定プレーを拒否する', () => {
    const game = transition(ready, 'start', 10_000);
    expect(() => beginPlay(game, 'made', 9_000)).toThrow();
    const draft = beginPlay(game, 'made', 11_000);
    const next = transition(transition(game, 'endQuarter', 12_000), 'next', 13_000);
    expect(() => completePlay(next, draft, 'p7', '2', 14_000)).toThrow();
  });
  it('試合にいない選手と、種別のないシュートを拒否する', () => {
    const game = transition(ready, 'start', 1_000);
    const draft = beginPlay(game, 'made', 2_000);
    expect(() => completePlay(game, draft, 'unknown', '2', 3_000)).toThrow();
    expect(() => completePlay(game, draft, 'p7', null, 3_000)).toThrow();
  });
  it('0と00を別の背番号として扱い、現役選手の重複だけを拒否する', () => {
    const player = { id: 'p0', number: '0', name: '山田', active: true };
    expect(() => validatePlayer({ ...player, id: 'p00', number: '00' }, [player])).not.toThrow();
    expect(() => validatePlayer({ ...player, id: 'other' }, [player])).toThrow();
    expect(() => validatePlayer({ ...player, number: '07' }, [])).toThrow();
  });
});
