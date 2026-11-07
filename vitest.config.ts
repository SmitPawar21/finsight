import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source (the `@finsight/source`
// export condition), so tests never run against a stale `dist/` build.
// We EXTEND Vite's defaults; replacing them would break resolution of other packages.
const conditions = ['@finsight/source', ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        extends: true,
        test: {
          // Integration tests start real Postgres/Redis containers (Docker required).
          name: 'integration',
          include: ['{apps,packages}/*/src/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 30_000,
          hookTimeout: 180_000, // first run pulls images
        },
      },
    ],
  },
});
