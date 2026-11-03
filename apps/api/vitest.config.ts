import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Plusieurs tests démarrent une application NestJS complète : quelques centaines
    // de millisecondes au repos, mais davantage pendant un `next build` en parallèle.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  // SWC émet les métadonnées de décorateurs dont dépend l'injection NestJS.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
