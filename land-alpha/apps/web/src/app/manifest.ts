import type { MetadataRoute } from 'next';

/**
 * Present so the terminal can be added to a phone's home screen and opened
 * without browser chrome — the analyst-on-the-move case, checking what
 * ingestion found rather than underwriting from a handset.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Land Alpha',
    short_name: 'Land Alpha',
    description:
      'Land-acquisition intelligence: discover, underwrite and rank mispriced government land inventory.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#07090d',
    theme_color: '#07090d',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  };
}
