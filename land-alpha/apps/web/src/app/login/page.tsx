import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in — Land Alpha' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-baseline gap-1.5">
          <span className="num text-xl font-semibold tracking-tight text-alpha">LAND</span>
          <span className="num text-xl font-semibold tracking-tight text-ink">ALPHA</span>
        </div>
        <p className="mb-6 text-xs leading-relaxed text-ink-muted">
          Land-acquisition intelligence. Discovers obscure, underpriced vacant land from government
          and distressed-property sources, enriches it with public data, and ranks it by expected
          return after access, buildability, title and liquidity risk.
        </p>

        <div className="panel rounded-sm p-4">
          <LoginForm next={next ?? '/dashboard'} />
        </div>

        {process.env.NODE_ENV !== 'production' ? (
          <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">
            Development seed accounts — admin@landalpha.local, analyst@landalpha.local,
            viewer@landalpha.local. Password <span className="num">landalpha-dev</span>.
          </p>
        ) : null}
      </div>
    </main>
  );
}
