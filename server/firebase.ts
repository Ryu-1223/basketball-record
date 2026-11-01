import { getApps, initializeApp, type Credential } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';

// Vercelの短期OIDC資格情報だけでGoogleへ接続する。秘密鍵ファイルは作らない。
let backend: { db: Firestore; auth: ReturnType<typeof getAuth> } | undefined;
export function getBackend() {
  if (backend) return backend;
  if (process.env.TEAM_API_EMULATORS === 'true' && process.env.NODE_ENV !== 'production') {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('INVALID_EMULATOR_HOST');
    const app = getApps().find(value => value.name === 'team-emulator') ?? initializeApp({ projectId: 'demo-basketball-record' }, 'team-emulator');
    backend = { db: new Firestore({ projectId: 'demo-basketball-record' }), auth: getAuth(app) };
    return backend;
  }
  const projectId = process.env.GCP_PROJECT_ID;
  const account = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const audience = process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE;
  if (!projectId || !account || !audience) throw new Error('SERVER_CONFIGURATION');
  const client = ExternalAccountClient.fromJSON({
      type: 'external_account', audience,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    });
    if (!client) throw new Error('SERVER_CONFIGURATION');
    client.scopes = ['https://www.googleapis.com/auth/cloud-platform'];
    const credential: Credential = { async getAccessToken() {
      const token = await client.getAccessToken();
      if (!token.token) throw new Error('SERVER_AUTHENTICATION');
      return { access_token: token.token, expires_in: Math.max(60, Math.floor(((client.credentials.expiry_date ?? Date.now() + 300_000) - Date.now()) / 1000)) };
    } };
  const app = getApps().find(value => value.name === 'team-server') ?? initializeApp({ projectId, serviceAccountId: account, credential }, 'team-server');
  backend = { db: new Firestore({ projectId, authClient: client }), auth: getAuth(app) };
  return backend;
}
