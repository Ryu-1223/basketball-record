import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { localTeamApi } from './server/local-api.ts';

export default defineConfig(({ mode }) => {
  const emulator = mode === 'emulator';
  if (emulator) {
    const env = loadEnv(mode, process.cwd(), '');
    for (const key of ['TEAM_API_EMULATORS', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'TEAM_PASSPHRASE_SECRET']) process.env[key] = env[key];
  }
  return {
  plugins: [react(), ...(emulator ? [localTeamApi()] : []), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'バスケの記録', short_name: 'バスケの記録', lang: 'ja',
      description: 'バスケ部の試合記録', theme_color: '#234b39',
      background_color: '#f6f7f5', display: 'standalone', start_url: '/',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      runtimeCaching: [{ urlPattern: /\/fonts\/NotoSansJP\.ttf$/, handler: 'CacheFirst', options: { cacheName: 'sheet-font-v1', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 1, maxAgeSeconds: 31536000 } } }],
      // 更新ボタンから有効化し、入力中の画面を維持する。
      skipWaiting: false,
      clientsClaim: false,
      // Firebaseの応答や認証情報はService Workerでキャッシュしない。
    },
  })],
  build: {
    target: ['es2022', 'safari16'],
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'firebase-auth', test: /node_modules[\\/]@firebase[\\/]auth/ },
      { name: 'firebase-data', test: /node_modules[\\/]@firebase[\\/]firestore/ },
      { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
    ] } } },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true },
}; });
