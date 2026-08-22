import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle with only the files it actually needs.
  // This is what the container runs: a full pnpm workspace install is ~1.5GB of
  // node_modules, and the standalone trace is a fraction of that.
  output: 'standalone',
  // The trace has to start at the workspace root, or it stops at apps/web and
  // misses every internal package.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  // Internal packages ship TypeScript source rather than a build artefact, so
  // Next compiles them as part of the app. See docs/decisions/0002.
  transpilePackages: [
    '@land-alpha/shared',
    '@land-alpha/db',
    '@land-alpha/core',
    '@land-alpha/gis',
    '@land-alpha/valuation',
    '@land-alpha/ingestion',
    '@land-alpha/ai',
    '@land-alpha/source-registry',
    '@land-alpha/title-research',
    '@land-alpha/listing-engine',
  ],
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  typedRoutes: false,
};

export default config;
