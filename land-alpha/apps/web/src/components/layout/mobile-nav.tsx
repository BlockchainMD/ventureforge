'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Nav } from './nav';

/**
 * The navigation rail on a phone.
 *
 * The desktop rail is always visible and costs nothing; on a 390px screen it
 * would take more than half the width, so below `lg` it becomes a drawer. The
 * nav itself is shared — there is one list of destinations, not two that drift.
 */
export function MobileNav({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating is the whole point of opening it, so a route change closes it.
  useEffect(() => setOpen(false), [pathname]);

  // A drawer over a scrolled page should not scroll the page behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="focus-ring -ml-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-raised hover:text-ink lg:hidden"
      >
        <Menu className="size-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ground/80"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
              <Link href="/dashboard" className="flex items-baseline gap-1.5">
                <span className="num text-sm font-semibold tracking-tight text-alpha">LAND</span>
                <span className="num text-sm font-semibold tracking-tight text-ink">ALPHA</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="focus-ring flex size-7 items-center justify-center rounded-sm text-ink-muted hover:bg-raised hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <Nav role={role} />
          </div>
        </div>
      ) : null}
    </>
  );
}
