import Link from 'next/link';
import { Nav } from './nav';
import { MobileNav } from './mobile-nav';
import { Badge } from '@/components/ui/badge';
import type { SessionUser } from '@/server/auth';

/**
 * The terminal chrome: a fixed rail, a thin status bar, and content.
 * No hero, no marketing surface — the product opens onto data.
 *
 * Below `lg` the rail becomes a drawer and the status bar sheds everything that
 * is not identity, so the content column keeps the full width of the screen.
 */
export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-ground">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <Link href="/dashboard" className="flex items-baseline gap-1.5">
            <span className="num text-sm font-semibold tracking-tight text-alpha">LAND</span>
            <span className="num text-sm font-semibold tracking-tight text-ink">ALPHA</span>
          </Link>
        </div>
        <Nav role={user.role} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav role={user.role} />
            <Link href="/dashboard" className="flex items-baseline gap-1.5 lg:hidden">
              <span className="num text-sm font-semibold tracking-tight text-alpha">LAND</span>
              <span className="num text-sm font-semibold tracking-tight text-ink">ALPHA</span>
            </Link>
            <p className="hidden truncate text-[11px] text-ink-faint lg:block">
              Find asymmetric land opportunities before other buyers understand them.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge tone="muted" className="hidden sm:inline-flex">
              {user.role}
            </Badge>
            <span className="hidden text-xs text-ink-muted md:inline">{user.name}</span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-4">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
