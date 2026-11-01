import { createHmac, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizePassphrase, type TeamAction } from '../src/team.js';

export class TeamError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type SignToken = (uid: string, claims: { teamId: string }) => Promise<string>;
export class TeamService {
  constructor(private db: Firestore, private sign: SignToken, private secret: string) {
    if (secret.length < 32) throw new Error('SERVER_CONFIGURATION');
  }
  private digest(kind: string, value: string) {
    return createHmac('sha256', this.secret).update(`${kind}\0${value}`).digest('hex');
  }
  async rateLimit(ip: string, now = Date.now()) {
    const ref = this.db.doc(`_teamAccessAttempts/${this.digest('ip', ip)}`);
    const blocked = await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const old = snapshot.data();
      const current = old && now - old.startedAt < 600_000 ? old : { startedAt: now, count: 0 };
      if (current.count >= 60) return true;
      tx.set(ref, { startedAt: current.startedAt, count: current.count + 1 });
      return false;
    });
    if (blocked) throw new TeamError(429, 'TOO_MANY_ATTEMPTS', '試行回数が多いため、しばらく待ってからお試しください。');
  }
  async access(action: TeamAction, input: unknown) {
    let passphrase: string;
    try { passphrase = normalizePassphrase(input); }
    catch (error) { throw new TeamError(400, 'INVALID_PASSPHRASE', (error as Error).message); }
    const ref = this.db.doc(`_teamPassphrases/${this.digest('passphrase', passphrase)}`);
    if (action === 'create') {
      const teamId = randomUUID();
      // 署名に失敗した場合は、合言葉を使用済みにしない。
      const token = await this.sign(`team:${teamId}`, { teamId });
      await this.db.runTransaction(async tx => {
        const existing = await tx.get(ref);
        if (existing.exists) throw new TeamError(409, 'PASSPHRASE_TAKEN', 'この合言葉はすでに使われています。別の合言葉にしてください。');
        const createdAt = Date.now();
        tx.create(ref, { teamId, createdAt });
        tx.create(this.db.doc(`teams/${teamId}`), { id: teamId, createdAt });
        tx.create(this.db.doc(`teams/${teamId}/members/team:${teamId}`), { enabled: true });
      });
      return { token };
    }
    const entry = await ref.get();
    const teamId = entry.data()?.teamId as string | undefined;
    if (!teamId) throw new TeamError(404, 'TEAM_NOT_FOUND', 'この合言葉のチームは見つかりません。合言葉を確認してください。');
    const member = await this.db.doc(`teams/${teamId}/members/team:${teamId}`).get();
    if (member.data()?.enabled !== true) throw new TeamError(403, 'TEAM_DISABLED', 'このチームには現在参加できません。');
    return { token: await this.sign(`team:${teamId}`, { teamId }) };
  }
}
