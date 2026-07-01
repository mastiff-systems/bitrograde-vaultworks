import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://vaultworks:vaultworks@localhost:5433/vaultworks_test',
      JWT_SECRET: 'test-jwt-secret-for-vitest-at-least-32-chars-long',
      AUTH_PROVIDER: 'local',
      JWT_EXPIRY: '1h',
    },
  },
});
