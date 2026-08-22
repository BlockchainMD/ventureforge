import type { Metadata, Viewport } from 'next';
import { env } from '@land-alpha/shared/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'Land Alpha',
  description:
    'Land-acquisition intelligence: discover, underwrite and rank mispriced government land inventory.',
  // Deliberately not set here. The root layout covers both the analyst
  // terminal and the public listing site, and a blanket noindex — which is
  // what used to be here — was correct for the terminal and silently kept
  // every listing out of every search result. The terminal opts out in its own
  // layout; robots.ts states the same rule for crawlers that never render.
  metadataBase: new URL(env().NEXT_PUBLIC_SITE_URL),
};

/**
 * Explicit rather than relying on the framework default, because this is a
 * dense data UI: `maximumScale` is left unset on purpose so a phone can pinch
 * into a table rather than being locked out of it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07090d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
