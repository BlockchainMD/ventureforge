'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  ClipboardCheck,
  Database,
  Eye,
  Gauge,
  LayoutGrid,
  type LucideIcon,
  Map,
  Settings,
  SlidersHorizontal,
  Target,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Minimum role. Items above the user's role are not rendered at all. */
  minRole?: 'VIEWER' | 'ANALYST' | 'ADMIN';
}

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Sourcing',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Gauge },
      { href: '/opportunities', label: 'Opportunities', icon: LayoutGrid },
      { href: '/map', label: 'Map', icon: Map },
      { href: '/watchlists', label: 'Watchlists', icon: Eye },
    ],
  },
  {
    heading: 'Acquisition',
    items: [
      { href: '/deals', label: 'Deal rooms', icon: ClipboardCheck, minRole: 'ANALYST' },
      { href: '/portfolio', label: 'Portfolio', icon: Wallet, minRole: 'ANALYST' },
      { href: '/leads', label: 'Leads', icon: Users, minRole: 'ANALYST' },
    ],
  },
  {
    heading: 'Data',
    items: [
      { href: '/sources', label: 'Sources', icon: Database },
      { href: '/ingestion', label: 'Ingestion', icon: Activity },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { href: '/admin/scoring', label: 'Scoring model', icon: SlidersHorizontal, minRole: 'ADMIN' },
      { href: '/admin/calibration', label: 'Calibration', icon: Target, minRole: 'ADMIN' },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const ROLE_RANK: Record<string, number> = { VIEWER: 1, ANALYST: 2, ADMIN: 3 };

export function Nav({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 px-2 py-3">
      {SECTIONS.map((section) => {
        const visible = section.items.filter(
          (item) => !item.minRole || ROLE_RANK[role]! >= ROLE_RANK[item.minRole]!,
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.heading}>
            <p className="rule-label px-2 pb-1">{section.heading}</p>
            <ul className="space-y-px">
              {visible.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors',
                        active
                          ? 'bg-raised text-alpha'
                          : 'text-ink-muted hover:bg-raised hover:text-ink',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="mt-auto px-2 pt-4">
        <Link
          href="/properties"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-ink-faint hover:text-ink"
        >
          <Building2 className="size-3.5" />
          Public listings
        </Link>
      </div>
    </nav>
  );
}
