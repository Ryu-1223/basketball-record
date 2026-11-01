import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const access = vi.hoisted(() => vi.fn());
vi.mock('./firebaseRepository', () => ({ hasCloudConfig: true, getServices: () => ({ auth: {} }), accessTeam: access }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: null) => void) => { callback(null); return () => {}; } }));
vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => Promise.resolve() }));
import App from './App';
afterEach(() => { cleanup(); access.mockReset(); });
describe('メールを使わない入口', () => {
  it('最初は2つのボタンだけを表示する', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'チームを作成' });
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['チームを作成', 'チームに参加']);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText(/メール/)).toBeNull();
  });
  it('作成は合言葉だけを送り、使用済みなら理由を表示して入力を残す', async () => {
    access.mockRejectedValue(new Error('この合言葉はすでに使われています。別の合言葉にしてください。'));
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'チームを作成' }));
    await user.type(screen.getByLabelText('合言葉'), 'バスケの部活');
    await user.click(screen.getByRole('button', { name: 'この合言葉で作成' }));
    await waitFor(() => expect(access).toHaveBeenCalledWith('create', 'バスケの部活'));
    expect((await screen.findByRole('alert')).textContent).toContain('すでに使われています');
    expect((screen.getByLabelText('合言葉') as HTMLInputElement).value).toBe('バスケの部活');
  });
  it('参加は合言葉だけを送り、戻ると入力を消す', async () => {
    access.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'チームに参加' }));
    await user.type(screen.getByLabelText('合言葉'), 'みんなで練習');
    await user.click(screen.getByRole('button', { name: '参加する' }));
    await waitFor(() => expect(access).toHaveBeenCalledWith('join', 'みんなで練習'));
    await user.click(screen.getByRole('button', { name: '← 戻る' }));
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
