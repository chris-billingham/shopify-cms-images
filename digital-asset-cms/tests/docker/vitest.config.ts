import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/docker/**/*.test.ts'],
    testTimeout: 300_000, // 5 minutes — Docker operations are slow
    hookTimeout: 300_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
