import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePackage = (name: string, entry = 'src/index.ts'): string =>
  fileURLToPath(new URL(`./packages/${name}/${entry}`, import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
  },
  resolve: {
    // Tests under the root `tests/` directory are not inside a workspace
    // package, so pnpm's symlinks do not resolve for them. Aliases keep
    // integration tests importable from one place.
    alias: [
      { find: /^@land-alpha\/db\/(.*)$/, replacement: resolvePackage('db', 'src/$1.ts') },
      { find: '@land-alpha/db', replacement: resolvePackage('db') },
      { find: '@land-alpha/core', replacement: resolvePackage('core') },
      { find: '@land-alpha/gis', replacement: resolvePackage('gis') },
      { find: '@land-alpha/valuation', replacement: resolvePackage('valuation') },
      { find: '@land-alpha/ingestion', replacement: resolvePackage('ingestion') },
      { find: '@land-alpha/ai', replacement: resolvePackage('ai') },
      { find: '@land-alpha/source-registry', replacement: resolvePackage('source-registry') },
      { find: '@land-alpha/title-research', replacement: resolvePackage('title-research') },
      { find: '@land-alpha/listing-engine', replacement: resolvePackage('listing-engine') },
      { find: /^@land-alpha\/shared\/(.*)$/, replacement: resolvePackage('shared', 'src/$1.ts') },
      { find: '@land-alpha/shared', replacement: resolvePackage('shared') },
    ],
  },
});
