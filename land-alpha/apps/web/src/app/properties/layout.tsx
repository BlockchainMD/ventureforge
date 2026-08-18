/**
 * Public site layout.
 *
 * Deliberately outside the authenticated `(app)` group: these pages are for
 * buyers, carry no session, and must never render an internal figure.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <a href="/properties" className="flex items-baseline gap-1.5">
            <span className="num text-base font-semibold tracking-tight text-alpha">LAND</span>
            <span className="num text-base font-semibold tracking-tight text-ink">ALPHA</span>
          </a>
          <p className="text-xs text-ink-faint">Vacant land for sale</p>
        </div>
      </header>
      {children}
      <footer className="mt-12 border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            All information is from public records and is believed accurate but is not warranted. No
            representation is made that any parcel is buildable, that legal access exists, that
            utilities are available, or that a septic system can be permitted. Boundaries shown are
            from county mapping and are not a survey. Buyers are responsible for their own due
            diligence.
          </p>
        </div>
      </footer>
    </div>
  );
}
