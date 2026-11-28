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
  beginPlay, completePlay, normalizeRecordOptions, playLabel, primaryActions, transition,
  type Game, type Play,
} from './domain';

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
vi.stubGlobal('scrollTo', vi.fn());

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('フェーズ1：データモデルと後方互換', () => {
  const ready: Game = {
    id: 'g1', opponent: '相手校', date: '2026-11-28',
    roster: [{ id: 'p7', number: '7', name: '田中' }],
    quarters: [], status: 'ready', createdAt: 1, updatedAt: 1,
  };

  it('新種別（assist/turnover/block）とreboundKindをDraftからPlayに引き継ぐ', () => {
    const running = transition(ready, 'start', 1000);
    for (const action of ['assist', 'turnover', 'block'] as const) {
      const draft = beginPlay(running, action, 2000, `p-${action}`);
      const play = completePlay(running, { ...draft, reboundKind: 'off' }, 'p7', null, 3000);
      expect(play.action).toBe(action);
      expect(play.shot).toBeNull();
      expect('reboundKind' in play).toBe(false);
    }
    const rebDraft = beginPlay(running, 'rebound', 4000, 'p-reb-off');
    const rebOff = completePlay(running, { ...rebDraft, reboundKind: 'off' }, 'p7', null, 5000);
    expect(rebOff.reboundKind).toBe('off');
    expect(playLabel(rebOff)).toBe('攻撃リバウンド');

    const rebDef = completePlay(running, rebDraft, 'p7', null, 5000, 'def');
    expect(rebDef.reboundKind).toBe('def');
    expect(playLabel(rebDef)).toBe('守備リバウンド');

    const rebPlain = completePlay(running, rebDraft, 'p7', null, 5000);
    expect('reboundKind' in rebPlain).toBe(false);
    expect(playLabel(rebPlain)).toBe('リバウンド');
  });

  it('playLabelとnormalizeRecordOptionsが既存データ・新種別を正しく扱う', () => {
    expect(primaryActions).toEqual(['miss', 'made', 'rebound', 'steal']);
    expect(playLabel({ action: 'assist', shot: null })).toBe('アシスト');
    expect(playLabel({ action: 'turnover', shot: null })).toBe('ターンオーバー');
    expect(playLabel({ action: 'block', shot: null })).toBe('ブロック');
    expect(normalizeRecordOptions(undefined)).toBeUndefined();
    expect(normalizeRecordOptions({ assist: false, turnover: false, block: false, reboundSplit: false })).toBeUndefined();
    expect(normalizeRecordOptions({ assist: true, turnover: false, block: true })).toEqual({ assist: true, block: true });
  });
});

describe('フェーズ1：Results・DailyResults・RetroPlay', () => {
  const baseGame: Game = {
    id: 'g', opponent: '相手', date: '2026-11-28',
    roster: [{ id: 'p1', number: '4', name: '佐藤' }, { id: 'p2', number: '7', name: '鈴木' }],
    quarters: [{ number: 1, startedAt: 0, endedAt: 5000 }],
    status: 'finished', createdAt: 0, updatedAt: 0, opponentTracking: true,
  };

  it('オプション未設定の試合では現行と同一のタブと1列リバウンドを表示する', async () => {
    const user = userEvent.setup();
    const legacyReb: Play = { id: 'r1', gameId: 'g', quarter: 1, elapsedMs: 100, playerId: 'p1', action: 'rebound', shot: null, createdAt: 1, updatedAt: 1, cancelled: false };
    render(<Results game={baseGame} plays={[legacyReb]} />);
    const categories = within(screen.getByRole('group', { name: '成績の種類' }));
    expect(categories.getAllByRole('button').map(b => b.textContent)).toEqual(['シュート', 'パスカット', 'リバウンド', '相手の得点']);
    await user.click(categories.getByRole('button', { name: 'リバウンド' }));
    expect(within(screen.getAllByRole('row')[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['選手', '回数']);
    expect(screen.getByRole('row', { name: '4 佐藤 1' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '7 鈴木 —' })).toBeTruthy();
  });

  it('オプションオンの試合では追加タブ・確認済みチェック・攻守区別リバウンドを表示する', async () => {
    const user = userEvent.setup();
    const optsGame: Game = {
      ...baseGame,
      recordOptions: { assist: true, turnover: true, block: true, reboundSplit: true },
    };
    const plays: Play[] = [
      { id: 'a1', gameId: 'g', quarter: 1, elapsedMs: 100, playerId: 'p1', action: 'assist', shot: null, createdAt: 1, updatedAt: 1, cancelled: false },
      { id: 't1', gameId: 'g', quarter: 1, elapsedMs: 200, playerId: 'p2', action: 'turnover', shot: null, createdAt: 2, updatedAt: 2, cancelled: false },
      { id: 'b1', gameId: 'g', quarter: 1, elapsedMs: 300, playerId: 'p1', action: 'block', shot: null, createdAt: 3, updatedAt: 3, cancelled: false },
      { id: 'r1', gameId: 'g', quarter: 1, elapsedMs: 400, playerId: 'p1', action: 'rebound', shot: null, reboundKind: 'off', createdAt: 4, updatedAt: 4, cancelled: false },
      { id: 'r2', gameId: 'g', quarter: 1, elapsedMs: 500, playerId: 'p1', action: 'rebound', shot: null, reboundKind: 'def', createdAt: 5, updatedAt: 5, cancelled: false },
      { id: 'r3', gameId: 'g', quarter: 1, elapsedMs: 600, playerId: 'p1', action: 'rebound', shot: null, createdAt: 6, updatedAt: 6, cancelled: false },
    ];
    let current = optsGame;
    const { rerender } = render(<Results game={current} plays={plays} onCheck={next => { current = { ...current, recordChecked: next }; rerender(<Results game={current} plays={plays} onCheck={() => {}} />); }} />);

    const categories = within(screen.getByRole('group', { name: '成績の種類' }));
    expect(categories.getAllByRole('button').map(b => b.textContent)).toEqual(['シュート', 'パスカット', 'リバウンド', 'アシスト', 'ターンオーバー', 'ブロック', '相手の得点']);

    await user.click(categories.getByRole('button', { name: 'リバウンド' }));
    expect(within(screen.getAllByRole('row')[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['選手', '合計', '攻撃', '守備', '区別なし']);
    expect(screen.getByRole('row', { name: '4 佐藤 3 1 1 1' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '7 鈴木 — — — —' })).toBeTruthy();
    expect(screen.getByRole('row', { name: 'チーム合計 3 1 1 1' })).toBeTruthy();

    await user.click(categories.getByRole('button', { name: 'アシスト' }));
    expect(screen.getByRole('row', { name: '4 佐藤 1' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '7 鈴木 —' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'アシストの記録を確認済み' }));
    expect(screen.getByRole('row', { name: '7 鈴木 0' })).toBeTruthy();

    await user.click(categories.getByRole('button', { name: 'ターンオーバー' }));
    expect(screen.getByRole('row', { name: '7 鈴木 1' })).toBeTruthy();

    await user.click(categories.getByRole('button', { name: 'ブロック' }));
    expect(screen.getByRole('row', { name: '4 佐藤 1' })).toBeTruthy();
  });

  it('DailyResultsはオプションがオンだった試合のみを分母として集計し注記を出す', async () => {
    await deleteDB('basketball-record-daily-extra');
    const repo = await createLocalRepository('basketball-record-daily-extra');
    const g1: Game = {
      id: 'd1', kind: 'scrimmage', recordMode: 'both', sessionId: 'sess-1',
      opponent: 'チーム２', date: '2026-11-28', status: 'finished',
      roster: [{ id: 'p1', number: '4', name: '佐藤' }],
      opponentRoster: [{ id: '7', number: '7', name: '鈴木', memberId: 'p2' }],
      quarters: [{ number: 1, startedAt: 1, endedAt: 1000 }],
      recordOptions: { assist: true, reboundSplit: true },
      createdAt: 1, updatedAt: 1,
    };
    const g2: Game = {
      ...g1, id: 'd2', recordOptions: undefined, createdAt: 2, updatedAt: 2,
    };
    await repo.saveGame(g1);
    await repo.saveGame(g2);
    await repo.savePlay({ id: 'p-a1', gameId: 'd1', quarter: 1, elapsedMs: 10, playerId: 'p1', action: 'assist', shot: null, createdAt: 1, updatedAt: 1, cancelled: false });
    await repo.savePlay({ id: 'p-a2', gameId: 'd1', quarter: 1, elapsedMs: 20, playerId: '7', side: 'opponent', action: 'assist', shot: null, createdAt: 2, updatedAt: 2, cancelled: false });
    await repo.savePlay({ id: 'p-a-off', gameId: 'd2', quarter: 1, elapsedMs: 30, playerId: 'p1', action: 'assist', shot: null, createdAt: 3, updatedAt: 3, cancelled: false });
    await repo.savePlay({ id: 'p-r1', gameId: 'd1', quarter: 1, elapsedMs: 40, playerId: 'p1', action: 'rebound', shot: null, reboundKind: 'off', createdAt: 4, updatedAt: 4, cancelled: false });
    await repo.savePlay({ id: 'p-r2', gameId: 'd2', quarter: 1, elapsedMs: 50, playerId: 'p1', action: 'rebound', shot: null, createdAt: 5, updatedAt: 5, cancelled: false });

    const user = userEvent.setup();
    render(<DailyResults game={g2} games={[g1, g2]} repo={repo} />);
    expect(await screen.findByText(/アシスト（1\/2ゲーム）/)).toBeTruthy();
    expect(screen.getByText(/リバウンド攻守区別（1\/2ゲーム）/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'アシスト' }));
    expect(screen.getByRole('row', { name: '4 佐藤 1' })).toBeTruthy();
    expect(screen.getByRole('row', { name: '7 鈴木 1' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'リバウンド' }));
    expect(screen.getByRole('row', { name: '4 佐藤 2 1 0 1' })).toBeTruthy();

    await repo.close();
  });

  it('RetroPlayで新種別とreboundKindを追加できる', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<RetroPlay game={baseGame} plays={[]} busy={false} save={save} close={() => {}} />);
    await user.selectOptions(screen.getByLabelText('プレー'), 'rebound');
    await user.selectOptions(screen.getByLabelText('リバウンドの種類'), 'off');
    await user.click(screen.getByRole('button', { name: '追加する' }));
    expect(save.mock.calls[0][0][0]).toMatchObject({ action: 'rebound', reboundKind: 'off', shot: null });

    await user.selectOptions(screen.getByLabelText('プレー'), 'block');
    expect(screen.queryByLabelText('リバウンドの種類')).toBeNull();
    await user.click(screen.getByRole('button', { name: '追加する' }));
    expect(save.mock.calls[1][0][0]).toMatchObject({ action: 'block', shot: null });
    expect('reboundKind' in save.mock.calls[1][0][0]).toBe(false);
  });
});

describe('フェーズ1：記録画面〜再読込〜訂正〜設定変更の結合フロー', () => {
  it('オプションオフでは主グリッド4種のみ・追加行なし・リバウンド2タップで完結する', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    await repo.saveGame({
      id: 'off-game', opponent: 'オフ試合', date: '2026-11-28',
      roster: [{ id: 'p7', number: '7', name: '田中' }],
      quarters: [{ number: 1, startedAt: 1000, endedAt: null }],
      status: 'running', createdAt: 1, updatedAt: 1,
    });
    await repo.close();
    localStorage.setItem('basketball-current-game:local', 'off-game');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await screen.findByRole('button', { name: 'リバウンド' });

    const primaryGrid = container.querySelector('.action-grid') as HTMLElement;
    expect(within(primaryGrid).getAllByRole('button').map(b => b.textContent)).toEqual(['シュート外', 'シュート決', 'リバウンド', 'パスカット']);
    expect(screen.queryByRole('group', { name: '追加の記録' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'リバウンド' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /7\s*田中/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('list')).getByText('リバウンド')).toBeTruthy();
  });

  it('オプションオンで入力・再読込・訂正・オプション切替・次の試合引継ぎが一連で動く', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    await repo.savePlayer({ id: 'p7', number: '7', name: '田中', active: true });
    await repo.close();

    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await user.click(await screen.findByRole('button', { name: '新しい試合' }));
    await user.type(screen.getByLabelText('対戦相手'), '追加スタッツ相手');
    await user.click(screen.getByRole('checkbox', { name: 'アシストを記録' }));
    await user.click(screen.getByRole('checkbox', { name: 'ターンオーバーを記録' }));
    await user.click(screen.getByRole('checkbox', { name: 'ブロックを記録' }));
    await user.click(screen.getByRole('checkbox', { name: 'リバウンドを攻撃・守備に分けて記録' }));
    await user.click(screen.getByRole('button', { name: 'この内容で試合を作成' }));
    await user.click(await screen.findByRole('button', { name: '試合開始' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'アシスト' }) as HTMLButtonElement).disabled).toBe(false));

    // 主グリッドは4ボタン固定、新種別は追加の記録行に分離
    const primaryGrid = first.container.querySelector('.action-grid') as HTMLElement;
    expect(within(primaryGrid).getAllByRole('button').map(b => b.textContent)).toEqual(['シュート外', 'シュート決', 'リバウンド', 'パスカット']);
    const extraGroup = screen.getByRole('group', { name: '追加の記録' });
    expect(within(extraGroup).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['アシスト', 'ターンオーバー', 'ブロック']);

    // アシスト：選手不明ボタンは出ず、選手タップで即保存
    await user.click(within(extraGroup).getByRole('button', { name: 'アシスト' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '選手不明' })).toBeNull();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /7\s*田中/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // ターンオーバー・ブロックも記録
    await user.click(within(extraGroup).getByRole('button', { name: 'ターンオーバー' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /7\s*田中/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(within(extraGroup).getByRole('button', { name: 'ブロック' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /7\s*田中/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // リバウンド：選手選択後に攻撃／守備リバウンド選択ステップ
    await user.click(within(primaryGrid).getByRole('button', { name: 'リバウンド' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /7\s*田中/ }));
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'リバウンドの種類' })).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '攻撃リバウンド' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const list = screen.getByRole('list');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    expect(within(list).getByText('攻撃リバウンド')).toBeTruthy();
    expect(within(list).getByText('アシスト')).toBeTruthy();

    // 再読込を模擬
    first.unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await screen.findByRole('group', { name: '追加の記録' });

    // 攻撃リバウンドを守備リバウンドへ訂正
    const reloadedList = await screen.findByRole('list');
    await waitFor(() => expect(within(reloadedList).getAllByRole('listitem')).toHaveLength(4));
    const firstItem = reloadedList.querySelectorAll('li')[0] as HTMLElement;
    await user.click(within(firstItem).getByRole('button', { name: '訂正' }));
    await user.selectOptions(screen.getByLabelText('リバウンドの種類'), 'def');
    await user.click(screen.getByRole('button', { name: '訂正を保存' }));
    await waitFor(() => expect(within(screen.getByRole('list')).getByText('守備リバウンド')).toBeTruthy());

    // 試合終了→結果確認
    await user.click(screen.getByRole('button', { name: 'このQを終了' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'このQを終了する' }));
    await user.click(await screen.findByRole('button', { name: '試合全体を終了' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '試合全体を終了' }));
    await screen.findByText('試合結果');

    await user.click(screen.getByRole('button', { name: 'リバウンド' }));
    expect(screen.getByRole('row', { name: '7 田中 1 0 1 0' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'アシスト' }));
    expect(screen.getByRole('row', { name: '7 田中 1' })).toBeTruthy();

    // オプションをオフに変更してもデータは消えず、タブが隠れ、再オンで復活する
    await user.click(screen.getByRole('button', { name: 'スコアシート・PDF' }));
    await user.click(screen.getByRole('button', { name: 'スコアシートの情報を入力・確認' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'アシストを記録' }));
    expect(within(screen.getByRole('dialog')).getByText(/記録済みデータは消えません/)).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'スコアシート情報を保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: '選手別成績' }));
    expect(screen.queryByRole('button', { name: 'アシスト' })).toBeNull();

    // 記録一覧には残っている
    await user.click(screen.getByRole('button', { name: '記録を確認・訂正する' }));
    expect(within(screen.getByRole('list')).getByText('アシスト')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '記録一覧を閉じる' }));

    // 再びオンにすると集計に戻る
    await user.click(screen.getByRole('button', { name: 'スコアシート・PDF' }));
    await user.click(screen.getByRole('button', { name: 'スコアシートの情報を入力・確認' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'アシストを記録' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'スコアシート情報を保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: '選手別成績' }));
    await user.click(screen.getByRole('button', { name: 'アシスト' }));
    expect(screen.getByRole('row', { name: '7 田中 1' })).toBeTruthy();

    // 次の試合を準備で recordOptions を引き継ぐ
    await user.click(screen.getByRole('button', { name: '次の試合を準備' }));
    expect((screen.getByRole('checkbox', { name: 'アシストを記録' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'ターンオーバーを記録' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'ブロックを記録' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'リバウンドを攻撃・守備に分けて記録' }) as HTMLInputElement).checked).toBe(true);
  }, 25_000);

  it('部内ゲームの記録範囲ルールが追加ボタンと相手組の結果にも適用される', async () => {
    await deleteDB('basketball-record-local');
    const repo = await createLocalRepository();
    const scrim: Game = {
      id: 'scrim-extra-ui', kind: 'scrimmage', recordMode: 'own',
      opponent: 'チーム２', date: '2026-11-28', status: 'running',
      roster: [{ id: 'p1', number: '4', name: '佐藤' }],
      opponentRoster: [{ id: '7', number: '7', name: '鈴木', memberId: 'p2' }],
      quarters: [{ number: 1, startedAt: Date.now(), endedAt: null }],
      recordOptions: { assist: true, block: true },
      createdAt: 1, updatedAt: 1,
    };
    await repo.saveGame(scrim);
    await repo.close();
    localStorage.setItem('basketball-current-game:local', scrim.id);

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'チームを作成' }));
    await user.click(screen.getByRole('button', { name: 'この端末で試す' }));
    await screen.findByRole('group', { name: '追加の記録' });
    expect((screen.getByRole('button', { name: 'アシスト' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'チーム２を記録' }));
    expect((screen.getByRole('button', { name: 'アシスト' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'ブロック' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
