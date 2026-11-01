// ログイン済みFirebase CLIの認証をメモリ内だけで使用する。
// パスワード・アクセストークン・サービスアカウント鍵は出力しない。
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { getGlobalDefaultAccount, getAccessToken } = require('firebase-tools/lib/auth');

const uid = process.argv.find(arg => arg.startsWith('--uid='))?.slice(6);
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
  console.error('使い方: npm run setup:team -- --uid=Firebaseで作成した共通ユーザーのUID');
  process.exit(1);
}
try {
  const config = JSON.parse(await readFile('.firebaserc', 'utf8'));
  const project = config.projects.default;
  const account = getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('先に npx firebase login でログインしてください。');
  const credential = await getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  async function request(url, method, body) {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${credential.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Firebaseの設定を完了できませんでした（${response.status}）。プロジェクトと管理権限を確認してください。`);
    return data;
  }
  let env = await readFile('.env.local', 'utf8');
  if (!env.split(/\r?\n/).includes(`VITE_FIREBASE_PROJECT_ID=${project}`)) throw new Error('.env.localとFirebaseのプロジェクトが一致していません。');
  const result = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, 'POST', { localId: [uid] });
  const user = result.users?.find(value => value.localId === uid);
  if (!user?.email || user.disabled) throw new Error('指定された共通ユーザーが見つからないか、無効になっています。');
  await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/teams/basketball/members/${uid}?updateMask.fieldPaths=enabled`, 'PATCH', { fields: { enabled: { booleanValue: true } } });
  env = env.replace(/^VITE_TEAM_EMAIL=.*$/m, `VITE_TEAM_EMAIL=${user.email}`);
  await writeFile('.env.local', env);
  console.log('部活アカウントを接続しました。開発サーバーを再起動すると合言葉で入れます。');
  console.log('VercelのVITE_TEAM_EMAILにも同じ共通アカウントのメールアドレスを設定してください。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '設定できませんでした。');
  process.exitCode = 1;
}
