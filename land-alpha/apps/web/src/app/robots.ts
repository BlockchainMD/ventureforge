import type { MetadataRoute } from 'next';
import { env } from '@land-alpha/shared/env';

/**
 * Two audiences, opposite rules.
 *
 * The property pages exist to be found — organic search is a primary channel
 * for rural land, and a buyer who cannot find the listing is a sale that does
 * not happen. Everything else is an internal terminal holding acquisition
 * analysis, and must never be indexed.
 *
 * The root layout previously applied `noindex` to the whole application, which
 * was right for the terminal and quietly suppressed every listing with it.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/properties', '/properties/'],
        disallow: [
          '/api/',
          '/login',
          '/dashboard',
          '/opportunities',
          '/deals',
          '/portfolio',
          '/leads',
          '/sources',
          '/ingestion',
          '/watchlists',
          '/allocate',
          '/map',
          '/settings',
          '/admin',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
