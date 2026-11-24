import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToEditor } from './ToControls';
import type { Game } from './domain';
import { newSheet } from './to';

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
afterEach(() => { cleanup(); sessionStorage.clear(); });
const game: Game = { id: 'g', opponent: '相手', date: '2026-11-02', roster: [{ id: 'p', number: '4', name: '山田' }], quarters: [{ number: 1, startedAt: 1, endedAt: null }], status: 'running', createdAt: 1, updatedAt: 1, sheet: newSheet() };

it('残り時間の範囲を確認してから会場の時計を保存する', async () => {
  const save = vi.fn(), user = userEvent.setup();
  render(<ToEditor game={game} plays={[]} action="timeout" busy={false} save={save} close={() => {}} />);
  await user.type(screen.getByLabelText('会場の時計の残り時間'), '09:00');
  await user.click(screen.getByRole('button', { name: '記録を保存' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('競技時間');
  await user.clear(screen.getByLabelText('会場の時計の残り時間'));
  await user.type(screen.getByLabelText('会場の時計の残り時間'), '03:44');
  await user.click(screen.getByRole('button', { name: '記録を保存' }));
  expect(save.mock.calls[0][0].details.remainingSec).toBe(224);
});

it('未登録の相手背番号と、チーム加算しないコーチのファウルを保存できる', async () => {
  const save = vi.fn(), user = userEvent.setup();
  render(<ToEditor game={game} plays={[]} action="foul" busy={false} save={save} close={() => {}} />);
  await user.selectOptions(screen.getByLabelText('チーム'), 'opponent');
  await user.type(screen.getByLabelText('未登録なら背番号を入力'), '00');
  await user.selectOptions(screen.getByLabelText('フリースローの付記'), '2');
  await user.click(screen.getByRole('button', { name: '記録を保存' }));
  expect(save.mock.calls[0][0]).toMatchObject({ side: 'opponent', playerId: '00', details: { code: 'P', penalty: '2', countsTeam: true } });
  await user.selectOptions(screen.getByLabelText('対象'), '@coach');
  await user.click(screen.getByRole('button', { name: '記録を保存' }));
  expect(save.mock.calls[1][0]).toMatchObject({ playerId: '@coach', details: { code: 'C', countsTeam: false } });
});

it('入力途中のタイムアウトを再表示し、競技時計の入力を保持する', async () => {
  const user = userEvent.setup(), save = vi.fn();
  const first = render(<ToEditor game={game} plays={[]} action="timeout" busy={false} save={save} close={() => {}} />);
  await user.type(screen.getByLabelText('会場の時計の残り時間'), '03:44');
  first.unmount();
  render(<ToEditor game={game} plays={[]} action="timeout" busy={false} save={save} close={() => {}} />);
  expect((screen.getByLabelText('会場の時計の残り時間') as HTMLInputElement).value).toBe('03:44');
});
