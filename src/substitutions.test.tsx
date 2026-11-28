import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';

vi.mock('./firebaseRepository', () => ({ hasCloudConfig: false }));
vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => Promise.resolve() }));
import App from './App';
import { Results } from './Results';
import { DailyResults } from './DailyResults';
import { RetroPlay } from './ToControls';
import { createLocalRepository } from './localRepository';
import {
  beginPlay, completePlay, normalizeRecordOptions, onCourt, playLabel, playingTimes, transition,
  type Game, type Play, type RosterPlayer,
} from './domain';
import { newSheet, type SheetInfo } from './to';

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
vi.stubGlobal('scrollTo', vi.fn());

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

const roster7: RosterPlayer[] = [
  { id: 'p4', number: '4', name: '佐藤' },
  { id: 'p5', number: '5', name: '鈴木' },
  { id: 'p6', number: '6', name: '高橋' },
  { id: 'p7', number: '7', name: '田中' },
  { id: 'p8', number: '8', name: '伊藤' },
  { id: 'p9', number: '9', name: '渡辺' },
  { id: 'p10', number: '10', name: '山本' },
];

function sheetWithStarters(starterIds: string[], roster = roster7): SheetInfo {
  const sheet = newSheet('さくら中');
  sheet.own.players = roster.map(p => ({
    ...p,
    license: '',
    captain: false,
    starter: starterIds.includes(p.id),
  }));
  return sheet;
}

function makeSub(partial: Partial<Play> & Pick<Play, 'id' | 'quarter' | 'elapsedMs' | 'playerId'>): Play {
  return {
    gameId: 'g1',
    action: 'sub',
    shot: null,
    createdAt: partial.elapsedMs,
    updatedAt: partial.elapsedMs,
    cancelled: false,
    ...partial,
  };
}

describe('フェーズ2：playingTimes / onCourt / データモデル単体テスト', () => {
  const baseGame: Game = {
    id: 'g1',
    opponent: '相手校',
    date: '2026-11-28',
    roster: roster7,
    quarters: [{ number: 1, startedAt: 0, endedAt: 480_000 }],
    status: 'finished',
    recordOptions: { substitutions: true },
    sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8']),
    createdAt: 1,
    updatedAt: 1,
  };

  it('スタメン5人がQ1フル出場で全員がQ経過時間どおりになり、控えは0になる', () => {
    const times = playingTimes(baseGame, [], 500_000);
    expect(times).not.toBeNull();
    for (const id of ['p4', 'p5', 'p6', 'p7', 'p8']) {
      expect(times!.get(id)?.totalMs).toBe(480_000);
      expect(times!.get(id)?.byQuarter.get(1)).toBe(480_000);
    }
    for (const id of ['p9', 'p10']) {
      expect(times!.get(id)?.totalMs).toBe(0);
      expect(times!.get(id)?.byQuarter.get(1)).toBe(0);
    }
    expect([...onCourt(baseGame, [], 500_000)!].sort()).toEqual(['p4', 'p5', 'p6', 'p7', 'p8']);
  });

  it('Q途中の交代でout/inの時間が正しく分かれる', () => {
    const plays: Play[] = [
      makeSub({ id: 's1', quarter: 1, elapsedMs: 180_000, outPlayerId: 'p4', playerId: 'p9', createdAt: 100 }),
    ];
    const times = playingTimes(baseGame, plays, 500_000)!;
    expect(times.get('p4')?.totalMs).toBe(180_000);
    expect(times.get('p4')?.byQuarter.get(1)).toBe(180_000);
    expect(times.get('p9')?.totalMs).toBe(300_000);
    expect(times.get('p9')?.byQuarter.get(1)).toBe(300_000);
    expect(times.get('p5')?.totalMs).toBe(480_000);
    expect([...onCourt(baseGame, plays, 500_000)!].sort()).toEqual(['p5', 'p6', 'p7', 'p8', 'p9']);
  });

  it('同時交代（同一elapsedMsに2組）が正しく計算される', () => {
    const plays: Play[] = [
      makeSub({ id: 's2', quarter: 1, elapsedMs: 120_000, outPlayerId: 'p5', playerId: 'p10', createdAt: 200 }),
      makeSub({ id: 's1', quarter: 1, elapsedMs: 120_000, outPlayerId: 'p4', playerId: 'p9', createdAt: 100 }),
    ];
    const times = playingTimes(baseGame, plays, 500_000)!;
    expect(times.get('p4')?.totalMs).toBe(120_000);
    expect(times.get('p5')?.totalMs).toBe(120_000);
    expect(times.get('p9')?.totalMs).toBe(360_000);
    expect(times.get('p10')?.totalMs).toBe(360_000);
    expect(times.get('p6')?.totalMs).toBe(480_000);
    expect([...onCourt(baseGame, plays, 500_000)!].sort()).toEqual(['p10', 'p6', 'p7', 'p8', 'p9']);
  });

  it('Qをまたいで出場が継続し、試合終了時点で出場中の選手は最終Qの終了まで加算される', () => {
    const twoQGame: Game = {
      ...baseGame,
      quarters: [
        { number: 1, startedAt: 0, endedAt: 480_000 },
        { number: 2, startedAt: 600_000, endedAt: 1_080_000 },
        { number: 3, startedAt: 1_200_000, endedAt: null, pausedAt: 1_320_000 },
      ],
      status: 'running',
    };
    const plays: Play[] = [
      makeSub({ id: 's1', quarter: 1, elapsedMs: 240_000, outPlayerId: 'p4', playerId: 'p9', createdAt: 10 }),
      makeSub({ id: 's2', quarter: 2, elapsedMs: 180_000, outPlayerId: 'p9', playerId: 'p4', createdAt: 20 }),
    ];
    // Q1=480s, Q2=480s, Q3=120s (pausedAt)
    const times = playingTimes(twoQGame, plays, 2_000_000)!;
    // p4: Q1 240s, Q2 300s (180..480), Q3 120s => 660s
    expect(times.get('p4')?.byQuarter.get(1)).toBe(240_000);
    expect(times.get('p4')?.byQuarter.get(2)).toBe(300_000);
    expect(times.get('p4')?.byQuarter.get(3)).toBe(120_000);
    expect(times.get('p4')?.totalMs).toBe(660_000);
    // p9: Q1 240s, Q2 180s, Q3 0s => 420s
    expect(times.get('p9')?.byQuarter.get(1)).toBe(240_000);
    expect(times.get('p9')?.byQuarter.get(2)).toBe(180_000);
    expect(times.get('p9')?.byQuarter.get(3)).toBe(0);
    expect(times.get('p9')?.totalMs).toBe(420_000);
    // p5: all 3 Qs => 1080s
    expect(times.get('p5')?.totalMs).toBe(1_080_000);
  });

  it('subの取り消し（cancelled）や相手側プレーを無視して再計算される', () => {
    const plays: Play[] = [
      makeSub({ id: 's1', quarter: 1, elapsedMs: 180_000, outPlayerId: 'p4', playerId: 'p9', cancelled: true }),
      makeSub({ id: 's2', quarter: 1, elapsedMs: 100_000, outPlayerId: 'p5', playerId: 'p10', side: 'opponent' }),
    ];
    const times = playingTimes(baseGame, plays, 500_000)!;
    expect(times.get('p4')?.totalMs).toBe(480_000);
    expect(times.get('p5')?.totalMs).toBe(480_000);
    expect(times.get('p9')?.totalMs).toBe(0);
    expect(times.get('p10')?.totalMs).toBe(0);
  });

  it('不整合なsub（コート上にいない選手のout指定、既にコート上の選手のin指定）でも例外なく計算できる', () => {
    const plays: Play[] = [
      // p9はコート上にいないのでout無視、p10はコート上にいないのでin適用
      makeSub({ id: 's1', quarter: 1, elapsedMs: 100_000, outPlayerId: 'p9', playerId: 'p10', createdAt: 1 }),
      // p4はコート上にいるのでout適用、p5は既にコート上なのでin無視（開始時刻0を維持）
      makeSub({ id: 's2', quarter: 1, elapsedMs: 200_000, outPlayerId: 'p4', playerId: 'p5', createdAt: 2 }),
    ];
    const times = playingTimes(baseGame, plays, 500_000)!;
    expect(times.get('p9')?.totalMs).toBe(0);
    expect(times.get('p10')?.totalMs).toBe(380_000);
    expect(times.get('p4')?.totalMs).toBe(200_000);
    expect(times.get('p5')?.totalMs).toBe(480_000);
  });

  it('スタメン未設定（sheetなし、starterが5人でない）でnullを返す', () => {
    const noSheet: Game = { ...baseGame, sheet: undefined };
    expect(playingTimes(noSheet, [], 500_000)).toBeNull();
    expect(onCourt(noSheet, [], 500_000)).toBeNull();

    const fourStarters: Game = { ...baseGame, sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7']) };
    expect(playingTimes(fourStarters, [], 500_000)).toBeNull();
    expect(onCourt(fourStarters, [], 500_000)).toBeNull();

    const sixStarters: Game = { ...baseGame, sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8', 'p9']) };
    expect(playingTimes(sixStarters, [], 500_000)).toBeNull();
    expect(onCourt(sixStarters, [], 500_000)).toBeNull();
  });

  it('completePlay・playLabel・normalizeRecordOptionsがsubとsubstitutionsを正しく扱う', () => {
    const running = transition({ ...baseGame, status: 'ready', quarters: [] }, 'start', 1000);
    const subDraft = beginPlay(running, 'sub', 2000, 'sub-ok');
    const subPlay = completePlay(running, { ...subDraft, outPlayerId: 'p4' }, 'p9', null, 2500);
    expect(subPlay.action).toBe('sub');
    expect(subPlay.shot).toBeNull();
    expect(subPlay.playerId).toBe('p9');
    expect(subPlay.outPlayerId).toBe('p4');
    expect(playLabel(subPlay)).toBe('交代');

    const samePlay = completePlay(running, { ...subDraft, outPlayerId: 'p9' }, 'p9', null, 2500);
    expect('outPlayerId' in samePlay).toBe(false);

    const otherDraft = beginPlay(running, 'steal', 3000, 'steal-1');
    const stealPlay = completePlay(running, { ...otherDraft, outPlayerId: 'p4' }, 'p9', null, 3500);
    expect('outPlayerId' in stealPlay).toBe(false);

    expect(normalizeRecordOptions({ substitutions: false })).toBeUndefined();
    expect(normalizeRecordOptions({ substitutions: true })).toEqual({ substitutions: true });
  });
});

describe('フェーズ2：UI結合テスト（記録画面・TO編集・訂正・結果画面・部内ゲーム）', () => {
  it('substitutionsオフの試合では交代ボタンが出ず、TO編集の出場導線が従来どおり出て、結果に出場時間タブがない', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    await repo.saveGame({
      id: 'sub-off-game',
      opponent: 'オフ相手',
      date: '2026-11-28',
      roster: roster7,
      quarters: [{ number: 1, startedAt: 1000, endedAt: null }],
      status: 'running',
      sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8']),
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.close();
    localStorage.setItem('basketball-current-game:local', 'sub-off-game');

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await screen.findByRole('button', { name: 'リバウンド' });

    expect(screen.queryByRole('button', { name: '交代' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Player in' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '途中成績を見る' }));
    const categories = within(screen.getByRole('group', { name: '成績の種類' }));
    expect(categories.queryByRole('button', { name: '出場時間' })).toBeNull();
  });

  it('substitutionsオン＋スタメン未設定では交代ボタンが出ず、結果画面に注記のみ出る', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    await repo.saveGame({
      id: 'sub-no-starters',
      opponent: 'スタメンなし相手',
      date: '2026-11-28',
      roster: roster7,
      quarters: [{ number: 1, startedAt: 1000, endedAt: null }],
      status: 'running',
      recordOptions: { substitutions: true },
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.close();
    localStorage.setItem('basketball-current-game:local', 'sub-no-starters');

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await screen.findByRole('button', { name: 'リバウンド' });

    expect(screen.queryByRole('button', { name: '交代' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Player in' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '途中成績を見る' }));
    const categories = within(screen.getByRole('group', { name: '成績の種類' }));
    await user.click(categories.getByRole('button', { name: '出場時間' }));
    expect(screen.getByText('出場時間は、スコアシート情報でスタメン（先発5人）を指定した試合でのみ表示されます。')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('substitutionsオン＋スタメン設定済みで交代記録・再読込・結果表示・EditPlay訂正が一連で動く', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    const startAt = Date.now() - 120_000;
    await repo.saveGame({
      id: 'sub-on-game',
      opponent: '交代相手',
      date: '2026-11-28',
      roster: roster7,
      quarters: [{ number: 1, startedAt: startAt, endedAt: null, pausedAt: startAt + 120_000 }],
      status: 'running',
      recordOptions: { substitutions: true },
      sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8']),
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.close();
    localStorage.setItem('basketball-current-game:local', 'sub-on-game');

    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));

    const subButton = await screen.findByRole('button', { name: '交代' }) as HTMLButtonElement;
    await waitFor(() => expect(subButton.disabled).toBe(false));
    // TO編集のentry導線は隠れる
    expect(screen.queryByRole('button', { name: 'Player in' })).toBeNull();

    // 1段目「出る選手」にはコート上の5人のみ表示
    await user.click(subButton);
    const dialog1 = screen.getByRole('dialog');
    expect(within(dialog1).getByRole('heading', { name: '出る選手' })).toBeTruthy();
    expect(within(dialog1).getByRole('button', { name: /4\s*佐藤/ })).toBeTruthy();
    expect(within(dialog1).getByRole('button', { name: /8\s*伊藤/ })).toBeTruthy();
    expect(within(dialog1).queryByRole('button', { name: /9\s*渡辺/ })).toBeNull();
    expect(within(dialog1).queryByRole('button', { name: /10\s*山本/ })).toBeNull();

    // 4 佐藤を選択 -> 2段目「入る選手」には控え2人のみ表示
    await user.click(within(dialog1).getByRole('button', { name: /4\s*佐藤/ }));
    const dialog2 = screen.getByRole('dialog');
    expect(within(dialog2).getByRole('heading', { name: '入る選手' })).toBeTruthy();
    expect(within(dialog2).queryByRole('button', { name: /4\s*佐藤/ })).toBeNull();
    expect(within(dialog2).queryByRole('button', { name: /5\s*鈴木/ })).toBeNull();
    expect(within(dialog2).getByRole('button', { name: /9\s*渡辺/ })).toBeTruthy();
    expect(within(dialog2).getByRole('button', { name: /10\s*山本/ })).toBeTruthy();

    // 9 渡辺を選んで保存
    await user.click(within(dialog2).getByRole('button', { name: /9\s*渡辺/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(screen.getByRole('list')).getByText('交代')).toBeTruthy());

    // 再読込を模擬
    first.unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    const reloadedList = await screen.findByRole('list');
    await waitFor(() => expect(within(reloadedList).getByText('交代')).toBeTruthy());

    // 試合を終了して結果画面の出場時間タブを確認（時刻はQ1=02:00で停止中なので02:00）
    // まずQ1の時間を調整するため、EditPlayで交代時刻を01:00に変更＋入る選手を10 山本、出る選手を5 鈴木に訂正
    const item = reloadedList.querySelectorAll('li')[0] as HTMLElement;
    await user.click(within(item).getByRole('button', { name: '訂正' }));
    const editDialog = screen.getByRole('dialog');
    expect((within(editDialog).getByLabelText('入る選手') as HTMLSelectElement).value).toBe('p9');
    expect((within(editDialog).getByLabelText('出る選手') as HTMLSelectElement).value).toBe('p4');
    await user.selectOptions(within(editDialog).getByLabelText('入る選手'), 'p10');
    await user.selectOptions(within(editDialog).getByLabelText('出る選手'), 'p5');
    const timeInput = within(editDialog).getByLabelText(/開始から/);
    await user.clear(timeInput);
    await user.type(timeInput, '01:00');
    await user.click(within(editDialog).getByRole('button', { name: '訂正を保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Q終了→試合終了
    const endQuarterBtn = screen.getByRole('button', { name: 'このQを終了' }) as HTMLButtonElement;
    await waitFor(() => expect(endQuarterBtn.disabled).toBe(false));
    await user.click(endQuarterBtn);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'このQを終了する' }));
    await user.click(await screen.findByRole('button', { name: '試合全体を終了' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '試合全体を終了' }));
    await screen.findByText('試合結果');

    const categories = within(screen.getByRole('group', { name: '成績の種類' }));
    const tabLabels = categories.getAllByRole('button').map(b => b.textContent);
    expect(tabLabels.at(-2)).toBe('相手の得点');
    expect(tabLabels.at(-1)).toBe('出場時間');

    await user.click(categories.getByRole('button', { name: '出場時間' }));
    expect(within(screen.getAllByRole('row')[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['選手', '合計', 'Q1']);
    // 4 佐藤は訂正で交代しなくなったのでフル2:00、5 鈴木は1:00、10 山本は1:00、9 渡辺は0:00
    expect(screen.getByRole('row', { name: '4 佐藤 2:00 2:00' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '5 鈴木 1:00 1:00' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '10 山本 1:00 1:00' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '9 渡辺 0:00 0:00' })).toBeTruthy();
  }, 20_000);

  it('RetroPlayはsubstitutionsオンでのみ交代を出してentryを隠し、入る選手・出る選手で保存できる', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const gameOn: Game = {
      id: 'g-retro',
      opponent: '相手',
      date: '2026-11-28',
      roster: roster7,
      quarters: [{ number: 1, startedAt: 0, endedAt: 480_000 }],
      status: 'finished',
      recordOptions: { substitutions: true },
      createdAt: 1,
      updatedAt: 1,
    };
    const { rerender } = render(<RetroPlay game={gameOn} plays={[]} busy={false} save={save} close={() => {}} />);
    const actionSelect = screen.getByLabelText('プレー');
    expect(within(actionSelect).queryByRole('option', { name: '交代' })).not.toBeNull();
    expect(within(actionSelect).queryByRole('option', { name: '初出場' })).toBeNull();

    await user.selectOptions(actionSelect, 'sub');
    await user.selectOptions(screen.getByLabelText('入る選手'), 'p9');
    await user.selectOptions(screen.getByLabelText('出る選手'), 'p4');
    await user.click(screen.getByRole('button', { name: '追加する' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0][0]).toMatchObject({
      action: 'sub',
      shot: null,
      playerId: 'p9',
      outPlayerId: 'p4',
    });

    const gameOff: Game = { ...gameOn, recordOptions: undefined };
    rerender(<RetroPlay game={gameOff} plays={[]} busy={false} save={save} close={() => {}} />);
    expect(within(screen.getByLabelText('プレー')).queryByRole('option', { name: '交代' })).toBeNull();
    expect(within(screen.getByLabelText('プレー')).queryByRole('option', { name: '初出場' })).not.toBeNull();
  });

  it('部内ゲームでは相手組の記録時に交代ボタンが無効になり、DailyResultsには出場時間タブが出ない', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    const scrim: Game = {
      id: 'scrim-sub-ui',
      kind: 'scrimmage',
      recordMode: 'both',
      sessionId: 'sess-sub',
      opponent: 'チーム２',
      date: '2026-11-28',
      status: 'running',
      roster: roster7.slice(0, 6),
      opponentRoster: [{ id: '10', number: '10', name: '山本', memberId: 'p10' }],
      quarters: [{ number: 1, startedAt: Date.now() - 60_000, endedAt: null }],
      recordOptions: { substitutions: true },
      sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8'], roster7.slice(0, 6)),
      createdAt: 1,
      updatedAt: 1,
    };
    await repo.saveGame(scrim);
    await repo.close();
    localStorage.setItem('basketball-current-game:local', scrim.id);

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));

    const subBtn = await screen.findByRole('button', { name: '交代' }) as HTMLButtonElement;
    await waitFor(() => expect(subBtn.disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'チーム２を記録' }));
    expect(subBtn.disabled).toBe(true);

    // DailyResults に出場時間タブが出ないこと
    await deleteDB('basketball-record-daily-sub');
    const dailyRepo = await createLocalRepository('basketball-record-daily-sub');
    await dailyRepo.saveGame({ ...scrim, status: 'finished' });
    render(<DailyResults game={{ ...scrim, status: 'finished' }} games={[{ ...scrim, status: 'finished' }]} repo={dailyRepo} />);
    await screen.findByText(/同じ連続ゲームに含まれる1ゲーム/);
    expect(screen.queryByRole('button', { name: '出場時間' })).toBeNull();
    await dailyRepo.close();
  });

  it('Resultsの出場時間タブで延長戦も含めたQ列と0:00表示が出る', async () => {
    const user = userEvent.setup();
    const otGame: Game = {
      id: 'g-ot',
      opponent: '延長相手',
      date: '2026-11-28',
      roster: roster7,
      quarters: [
        { number: 1, startedAt: 0, endedAt: 480_000 },
        { number: 2, startedAt: 500_000, endedAt: 980_000 },
        { number: 3, startedAt: 1_000_000, endedAt: 1_480_000 },
        { number: 4, startedAt: 1_500_000, endedAt: 1_980_000 },
        { number: 5, startedAt: 2_000_000, endedAt: 2_180_000 },
      ],
      status: 'finished',
      recordOptions: { substitutions: true },
      sheet: sheetWithStarters(['p4', 'p5', 'p6', 'p7', 'p8']),
      createdAt: 1,
      updatedAt: 1,
    };
    render(<Results game={otGame} plays={[]} />);
    await user.click(screen.getByRole('button', { name: '出場時間' }));
    expect(within(screen.getAllByRole('row')[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      '選手', '合計', 'Q1', 'Q2', 'Q3', 'Q4', '延長1',
    ]);
    expect(screen.getByRole('row', { name: '4 佐藤 35:00 8:00 8:00 8:00 8:00 3:00' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '9 渡辺 0:00 0:00 0:00 0:00 0:00 0:00' })).toBeTruthy();
  });
});
