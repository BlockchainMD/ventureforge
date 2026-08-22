import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth';
import { Shell } from '@/components/layout/shell';

/**
 * The analyst terminal is never indexed. It holds acquisition analysis on
 * parcels the business intends to bid on, and a competitor reading it from a
 * search result would be a direct commercial loss.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <Shell user={user}>{children}</Shell>;
}
