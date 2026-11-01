import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TeamError, TeamService } from '../server/team-service';

const db = new Firestore({ projectId: 'demo-basketball-record' });
const secret = 'only-for-emulator-tests-without-live-credentials';
const signer = async (uid: string) => `test-token-for-${uid}`;
const service = new TeamService(db, signer, secret);
afterAll(async () => { await db.terminate(); });
describe('合言葉だけでのチーム作成・参加', () => {
  it('同じ合言葉で作成したチームへ参加できる。合言葉の本文は保存されない', async () => {
    const phrase = `部活-${randomUUID()}`;
    const created = await service.access('create', phrase);
    const joined = await service.access('join', ` ${phrase} `);
    expect(joined.token).toBe(created.token);
    const entries = await db.collection('_teamPassphrases').get();
    expect(JSON.stringify(entries.docs.map(d => d.data()))).not.toContain(phrase);
  });
  it('同じ合言葉による同時作成は1件だけ成功し、残りは使用済みになる', async () => {
    const phrase = `同時作成-${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.access('create', phrase)));
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const failed = results.filter(value => value.status === 'rejected');
    expect(failed).toHaveLength(4);
    for (const result of failed) expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'PASSPHRASE_TAKEN' });
  });
  it('異なる合言葉には異なるチームが割り当てられる', async () => {
    const first = await service.access('create', `1-${randomUUID()}`);
    const second = await service.access('create', `2-${randomUUID()}`);
    expect(first.token).not.toBe(second.token);
  });
  it('見つからない合言葉・短すぎる合言葉では参加できない', async () => {
    await expect(service.access('join', randomUUID())).rejects.toMatchObject({ status: 404, code: 'TEAM_NOT_FOUND' });
    await expect(service.access('create', 'abc')).rejects.toMatchObject({ status: 400 });
  });
  it('トークンの署名に失敗した合言葉は使用済みにならない', async () => {
    const phrase = randomUUID();
    const failing = new TeamService(db, async () => { throw new Error('sign failure'); }, secret);
    await expect(failing.access('create', phrase)).rejects.toThrow('sign failure');
    await expect(service.access('create', phrase)).resolves.toHaveProperty('token');
  });
  it('停止したチームへの参加ではトークンを発行しない', async () => {
    const phrase = randomUUID();
    const sign = vi.fn(signer);
    const target = new TeamService(db, sign, secret);
    await target.access('create', phrase);
    const uid = sign.mock.calls[0][0];
    const id = uid.slice('team:'.length);
    await db.doc(`teams/${id}/members/${uid}`).update({ enabled: false });
    sign.mockClear();
    await expect(target.access('join', phrase)).rejects.toBeInstanceOf(TeamError);
    expect(sign).not.toHaveBeenCalled();
  });
  it('試行回数を複数のサーバー処理で共有し、一定時間後に再開できる', async () => {
    const ip = randomUUID();
    for (let i = 0; i < 60; i++) await service.rateLimit(ip, 1_000);
    const secondServer = new TeamService(db, signer, secret);
    await expect(secondServer.rateLimit(ip, 1_001)).rejects.toMatchObject({ status: 429 });
    await expect(secondServer.rateLimit(ip, 601_001)).resolves.toBeUndefined();
  });
});
