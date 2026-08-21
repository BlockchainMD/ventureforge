import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth';
import { Shell } from '@/components/layout/shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <Shell user={user}>{children}</Shell>;
}
