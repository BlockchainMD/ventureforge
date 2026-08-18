import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
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
