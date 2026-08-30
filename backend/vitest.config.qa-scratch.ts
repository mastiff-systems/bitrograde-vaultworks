import { defineConfig } from 'vitest/config';

// Scratch-DB vitest config for QA runs done alongside other concurrent work.
// Originated as a one-off for MAS-643; kept and generalized (MAS-662) because
// concurrent vitest runs against the shared vaultworks_test DB stomp on each
// other's fixtures (see project_mas639_email_save_bug memory). Point this at
// a disposable DB via QA_SCRATCH_DB_NAME (create it once with
// `createdb -h localhost -p 5433 -U vaultworks <name>`) and run with:
//   pnpm vitest run --config vitest.config.qa-scratch.ts
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
      DATABASE_URL: `postgresql://vaultworks:vaultworks@localhost:5433/${process.env.QA_SCRATCH_DB_NAME || 'vaultworks_qa_scratch'}`,
      JWT_SECRET: 'test-jwt-secret-for-vitest-at-least-32-chars-long',
      AUTH_PROVIDER: 'local',
      JWT_EXPIRY: '1h',
    },
  },
});
