import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Land Alpha',
  description:
    'Land-acquisition intelligence: discover, underwrite and rank mispriced government land inventory.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
