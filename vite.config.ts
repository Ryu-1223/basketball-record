import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
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
      cleanupOutdatedCaches: true,
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
});
