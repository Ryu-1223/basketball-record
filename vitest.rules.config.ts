import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/firestore.rules.test.ts', 'tests/team-service.test.ts', 'tests/game-service.test.ts'], fileParallelism: false, testTimeout: 30_000 } });
