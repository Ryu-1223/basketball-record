import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalRepository } from './localRepository';
import type { Play } from './domain';

describe('端末への永続保存', () => {
  it('通信なしで20件保存し、再接続相当の再作成後も20件を復元する。同じIDの再送は重複しない', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repo = await createLocalRepository(name);
    const play: Play = { id: 'first', gameId: 'game', quarter: 1, elapsedMs: 5_000, playerId: 'p7', action: 'rebound', shot: null, createdAt: 1, updatedAt: 1, cancelled: false };
    for (let i = 0; i < 20; i++) await repo.savePlay({ ...play, id: `play-${i}` });
    await repo.savePlay({ ...play, id: 'play-0' });
    await repo.close();
    const restored = await createLocalRepository(name);
    const values = await new Promise<Play[]>(resolve => { const stop = restored.watchPlays('game', value => { stop(); resolve(value); }); });
    expect(values).toHaveLength(20);
    await restored.savePlay({ ...values[0], cancelled: true });
    const cancelled = await new Promise<Play[]>(resolve => { const stop = restored.watchPlays('game', value => { stop(); resolve(value); }); });
    expect(cancelled.filter(p => !p.cancelled)).toHaveLength(19);
    await restored.close();
  });
});
