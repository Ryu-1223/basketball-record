import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, getDocsFromCache, setDoc, updateDoc, deleteDoc, disableNetwork, enableNetwork } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const game = { id: 'game', opponent: '相手校', date: '2026-11-01', roster: [{ id: 'p7', name: '田中', number: '7' }], quarters: [{ number: 1, startedAt: 1000, endedAt: null }], status: 'running', createdAt: 1, updatedAt: 1 };
const play = { id: 'play', gameId: 'game', quarter: 1, elapsedMs: 5000, playerId: 'p7', action: 'made', shot: '3', createdAt: 1, updatedAt: 1, cancelled: false };
beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-basketball-record', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'teams/basketball/members/team-user'), { enabled: true });
    await setDoc(doc(context.firestore(), 'teams/basketball/games/game'), game);
  });
});
afterAll(async () => { await environment?.cleanup(); });
describe('部活のアクセス制御', () => {
  it('未認証と部外者の読み書きを拒否する', async () => {
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('outsider')]) {
      await assertFails(getDoc(doc(context.firestore(), 'teams/basketball/games/game')));
      await assertFails(setDoc(doc(context.firestore(), 'teams/basketball/games/game/plays/play'), play));
    }
  });
  it('部活アカウントは記録と訂正ができる', async () => {
    const db = environment.authenticatedContext('team-user').firestore();
    await assertSucceeds(getDoc(doc(db, 'teams/basketball/games/game')));
    await assertSucceeds(setDoc(doc(db, 'teams/basketball/games/game/plays/play'), play));
    await assertSucceeds(updateDoc(doc(db, 'teams/basketball/games/game/plays/play'), { cancelled: true }));
  });
  it('自分でアクセス権を取得できず、他の部活も読めない', async () => {
    const db = environment.authenticatedContext('outsider').firestore();
    await assertFails(setDoc(doc(db, 'teams/basketball/members/outsider'), { enabled: true }));
    const memberDb = environment.authenticatedContext('team-user').firestore();
    await assertFails(getDoc(doc(memberDb, 'teams/other/games/game')));
  });
  it('不正な記録・過去名簿の書換・物理削除を拒否する', async () => {
    const db = environment.authenticatedContext('team-user').firestore();
    const ref = doc(db, 'teams/basketball/games/game/plays/invalid');
    await assertFails(setDoc(ref, { ...play, id: 'invalid', shot: null }));
    await assertFails(setDoc(ref, { ...play, id: 'invalid', elapsedMs: -1 }));
    await assertFails(updateDoc(doc(db, 'teams/basketball/games/game'), { roster: [] }));
    await assertFails(deleteDoc(doc(db, 'teams/basketball/games/game')));
  });
  it('通信断中の20件を復帰後に別の利用端末から重複なく取得できる', async () => {
    const db = environment.authenticatedContext('team-user').firestore();
    const path = 'teams/basketball/games/offline-game';
    await setDoc(doc(db, path), { ...game, id: 'offline-game' });
    await disableNetwork(db);
    const writes = Array.from({ length: 20 }, (_, i) => setDoc(doc(db, `${path}/plays/play-${i}`), { ...play, id: `play-${i}`, gameId: 'offline-game' }));
    // SDKのローカル反映を待つ。サーバー応答はまだ待たない。
    const cached = await getDocsFromCache(collection(db, `${path}/plays`));
    if (cached.size !== 20) throw new Error(`端末キャッシュの件数が一致しません: ${cached.size}`);
    await enableNetwork(db);
    await Promise.all(writes);
    await setDoc(doc(db, `${path}/plays/play-0`), { ...play, id: 'play-0', gameId: 'offline-game' });
    const reader = environment.authenticatedContext('team-user').firestore();
    const result = await getDocs(collection(reader, `${path}/plays`));
    if (result.size !== 20) throw new Error(`同期後の件数が一致しません: ${result.size}`);
  });
  it('無効化した部活アカウントはアクセスできない', async () => {
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'teams/basketball/members/disabled-user'), { enabled: false }));
    const db = environment.authenticatedContext('disabled-user').firestore();
    await assertFails(getDoc(doc(db, 'teams/basketball/games/game')));
  });
});
