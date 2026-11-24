import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Game, Play } from './domain';
import { FoulSummary } from './FoulSummary';

afterEach(cleanup);

it('延長のチームファウルと選手の試合累計を別々に数える', () => {
  const game: Game = {
    id: 'game', opponent: '相手校', date: '2026-11-20', status: 'running',
    roster: [{ id: 'own-00', number: '00', name: '田中' }],
    quarters: Array.from({ length: 5 }, (_, i) => ({
      number: i + 1, startedAt: i * 100, endedAt: i < 4 ? (i + 1) * 100 : null,
    })),
    createdAt: 0, updatedAt: 0,
  };
  const foul = (id: string, quarter: number, overrides: Partial<Play> = {}): Play => ({
    id, gameId: game.id, quarter, elapsedMs: 0, action: 'foul', shot: null, playerId: 'own-00',
    createdAt: 0, updatedAt: 0, cancelled: false, details: { code: 'P', countsTeam: true }, ...overrides,
  });
  const plays = [
    foul('first', 1),
    foul('fourth', 4),
    foul('overtime', 5, { details: { code: 'F', countsTeam: false } }),
    foul('cancelled', 5, { cancelled: true }),
    foul('gd', 5, { details: { code: 'GD', countsTeam: false } }),
    foul('coach', 5, { playerId: '@coach', details: { code: 'C', countsTeam: false } }),
    foul('opponent', 5, { side: 'opponent', playerId: '00' }),
  ];
  render(<FoulSummary game={game} plays={plays} teamName="自校" />);
  expect(screen.getByRole('columnheader', { name: '第4Q・延長のチームファウル' })).toBeTruthy();
  for (const name of ['自校 1', '相手校 1', '自校 / 00 田中 3', '相手校 / 00 1']) {
    expect(screen.getByRole('row', { name })).toBeTruthy();
  }
  expect(screen.getAllByRole('row')).toHaveLength(6);
});
