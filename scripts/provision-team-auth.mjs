// このアプリ専用のVercel→Google短期認証を設定する。秘密鍵は発行しない。
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { getGlobalDefaultAccount, getAccessToken } = require('firebase-tools/lib/auth');
const project = JSON.parse(await readFile('.firebaserc', 'utf8')).projects.default;
const vercel = JSON.parse(await readFile('.vercel/project.json', 'utf8'));
let envText = await readFile('.env.local', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]; }));
const oidc = env.VERCEL_OIDC_TOKEN;
if (!oidc) throw new Error('先に npx vercel env pull .env.local で開発用OIDCトークンを取得してください。');
const claims = JSON.parse(Buffer.from(oidc.split('.')[1], 'base64url').toString());
if (claims.project_id !== vercel.projectId || claims.owner_id !== vercel.orgId) throw new Error('Vercelのプロジェクトが一致していません。');
const account = getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) throw new Error('先に npx firebase login を実行してください。');
const credential = await getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
async function request(url, method = 'GET', body, allowMissing = false) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${credential.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error(`Google設定エラー ${response.status}: ${method} ${new URL(url).pathname}`); }
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Google設定エラー ${response.status}: ${data.error?.message ?? 'unknown'}`);
  return data;
}
async function operation(result, base) {
  if (!result?.name || result.done) { if (result?.error) throw new Error(result.error.message); return result; }
  for (let count = 0; count < 60; count++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const next = await request(`${base}/${result.name}`);
    if (next.done) { if (next.error) throw new Error(next.error.message); return next; }
  }
  throw new Error('Google設定の処理が継続中です。少し待ってから同じコマンドを再実行してください。');
}
const cloudProject = await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
const number = cloudProject.projectNumber;
console.log('必要な無料APIを有効にします。');
const apis = await request(`https://serviceusage.googleapis.com/v1/projects/${number}/services:batchEnable`, 'POST', { serviceIds: ['iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com', 'identitytoolkit.googleapis.com'] });
await operation(apis, 'https://serviceusage.googleapis.com/v1');
const email = `basketball-api@${project}.iam.gserviceaccount.com`;
const serviceAccountUrl = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}`;
if (!await request(serviceAccountUrl, 'GET', undefined, true)) {
  await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`, 'POST', { accountId: 'basketball-api', serviceAccount: { displayName: 'Basketball team access API' } });
}
console.log('このVercelプロジェクト専用のOIDC接続を設定します。');
const poolName = `projects/${number}/locations/global/workloadIdentityPools/vercel-basketball`;
const poolUrl = `https://iam.googleapis.com/v1/${poolName}`;
if (!await request(poolUrl, 'GET', undefined, true)) {
  await operation(await request(`https://iam.googleapis.com/v1/projects/${number}/locations/global/workloadIdentityPools?workloadIdentityPoolId=vercel-basketball`, 'POST', { displayName: 'Basketball Vercel' }), 'https://iam.googleapis.com/v1');
}
const providerName = `${poolName}/providers/vercel`;
const providerUrl = `https://iam.googleapis.com/v1/${providerName}`;
const provider = {
  displayName: 'Basketball Vercel only',
  oidc: { issuerUri: claims.iss, allowedAudiences: [claims.aud] },
  attributeMapping: { 'google.subject': 'assertion.sub', 'attribute.project_id': 'assertion.project_id' },
  attributeCondition: `assertion.owner_id == '${vercel.orgId}' && assertion.project_id == '${vercel.projectId}' && assertion.environment in ['production', 'preview', 'development']`,
};
if (!await request(providerUrl, 'GET', undefined, true)) {
  await operation(await request(`${poolUrl}/providers?workloadIdentityPoolProviderId=vercel`, 'POST', provider), 'https://iam.googleapis.com/v1');
} else {
  await operation(await request(`${providerUrl}?updateMask=oidc,attributeMapping,attributeCondition`, 'PATCH', provider), 'https://iam.googleapis.com/v1');
}
function addBinding(policy, role, member) {
  policy.bindings ??= [];
  let binding = policy.bindings.find(value => value.role === role && !value.condition);
  if (!binding) { binding = { role, members: [] }; policy.bindings.push(binding); }
  if (!binding.members.includes(member)) binding.members.push(member);
}
const projectPolicyUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
const projectPolicy = await request(`${projectPolicyUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
addBinding(projectPolicy, 'roles/datastore.user', `serviceAccount:${email}`);
await request(`${projectPolicyUrl}:setIamPolicy`, 'POST', { policy: projectPolicy });
const saPolicy = await request(`${serviceAccountUrl}:getIamPolicy?options.requestedPolicyVersion=3`, 'POST');
addBinding(saPolicy, 'roles/iam.workloadIdentityUser', `principalSet://iam.googleapis.com/${poolName}/attribute.project_id/${vercel.projectId}`);
addBinding(saPolicy, 'roles/iam.serviceAccountTokenCreator', `serviceAccount:${email}`);
await request(`${serviceAccountUrl}:setIamPolicy`, 'POST', { policy: saPolicy });
// Firebase Authの構成が未初期化のプロジェクトだけ初期化する。課金アップグレードはしない。
const authConfigUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
if (!await request(authConfigUrl, 'GET', undefined, true)) {
  await request(`https://identitytoolkit.googleapis.com/v2/projects/${project}/identityPlatform:initializeAuth`, 'POST', {});
}
const values = {
  GCP_PROJECT_ID: project,
  GCP_SERVICE_ACCOUNT_EMAIL: email,
  GCP_WORKLOAD_IDENTITY_AUDIENCE: `//iam.googleapis.com/${providerName}`,
  TEAM_PASSPHRASE_SECRET: env.TEAM_PASSPHRASE_SECRET || randomBytes(32).toString('hex'),
};
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  envText = new RegExp(`^${key}=.*$`, 'm').test(envText) ? envText.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${envText.trimEnd()}\n${line}\n`;
}
await writeFile('.env.local', envText);
console.log('サーバーの接続設定を.env.localへ保存しました。秘密値の内容は表示していません。');
