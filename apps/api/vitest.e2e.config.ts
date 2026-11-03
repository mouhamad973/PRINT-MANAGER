import { defineConfig } from 'vitest/config';

/**
 * Tests de bout en bout : ils visent la stack Docker démarrée (`docker compose up`)
 * et écrivent de vraies données dans sa base. Ils ne font pas partie de `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
