import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Land Alpha',
  description:
    'Land-acquisition intelligence: discover, underwrite and rank mispriced government land inventory.',
  robots: { index: false, follow: false },
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
