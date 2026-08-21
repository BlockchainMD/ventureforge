import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider',
  {
    variants: {
      tone: {
        neutral: 'border-line-strong bg-raised text-ink-muted',
        good: 'border-good/30 bg-good/10 text-good',
        warn: 'border-warn/30 bg-warn/10 text-warn',
        bad: 'border-bad/30 bg-bad/10 text-bad',
        alpha: 'border-alpha/40 bg-alpha/10 text-alpha',
        info: 'border-info/30 bg-info/10 text-info',
        muted: 'border-line bg-transparent text-ink-faint',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Map a domain status onto a tone so status colouring is consistent everywhere. */
export function statusTone(
  status: string,
): NonNullable<VariantProps<typeof badgeVariants>['tone']> {
  switch (status) {
    case 'ACQUIRED':
    case 'SOLD':
    case 'WON':
    case 'ACTIVE':
    case 'SUCCEEDED':
      return 'good';
    case 'REJECTED':
    case 'LOST':
    case 'FAILED':
    case 'BROKEN':
      return 'bad';
    case 'DUE_DILIGENCE':
    case 'READY_TO_BID':
    case 'APPROVED':
    case 'BID_PLACED':
    case 'PARTIAL':
    case 'DEGRADED':
      return 'warn';
    case 'WATCHLIST':
    case 'LISTED':
    case 'UNDER_CONTRACT':
      return 'info';
    case 'SCORED':
      return 'alpha';
    default:
      return 'neutral';
  }
}
