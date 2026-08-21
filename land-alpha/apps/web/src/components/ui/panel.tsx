import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The primary layout container. Named `Panel` rather than `Card` because it is
 * a terminal panel: square corners, hairline border, no shadow, no padding
 * inside the header rule.
 */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('panel rounded-sm', className)} {...props} />;
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-3 border-b border-line px-3 py-2',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="rule-label">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3', className)} {...props} />;
}
