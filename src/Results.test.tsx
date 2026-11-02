import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Results } from './Results';
import type { Game, Play } from './domain';

afterEach(cleanup);
const game: Game = { id: 'g', opponent: '相手', date: '2026-11-02', roster: [{ id: 'p', number: '1', name: '山田' }], quarters: [{ number: 1, startedAt: 0, endedAt: 5000 }], status: 'finished', createdAt: 0, updatedAt: 0, opponentTracking: true };
const play: Play = { id: 'x', gameId: 'g', quarter: 1, elapsedMs: 100, playerId: '@team', action: 'timeout', details: { remainingSec: null }, shot: null, createdAt: 1, updatedAt: 1, cancelled: false, side: 'opponent' };
it('相手のTOを得点者に混ぜず、背番号不明の得点を表示する', async () => {
  const user = userEvent.setup();
  render(<Results game={game} plays={[play, { ...play, id: 'score', action: 'made', playerId: '@unknown', shot: '2' }]} />);
  await user.click(screen.getByRole('button', { name: '相手の得点' }));
  expect(within(screen.getByRole('table')).queryByText('@team')).toBeNull();
  expect(screen.getByRole('row', { name: /不明 1 0 0 2/ })).toBeTruthy();
});

it('記録が未確認の空欄は0と区別し、確認後は0と表示する', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Results game={game} plays={[]} onCheck={next => rerender(<Results game={{ ...game, recordChecked: next }} plays={[]} onCheck={() => {}} />)} />);
  expect(screen.getByRole('row', { name: /1 山田 — — — —/ })).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'シュートの記録を確認済み' }));
  expect(screen.getByRole('row', { name: /1 山田 0 0 — 0/ })).toBeTruthy();
});
