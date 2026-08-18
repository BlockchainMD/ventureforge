import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * `Value` is the workhorse of this UI.
 *
 * Every figure an analyst reads passes through it, and its whole job is to make
 * an unknown look unmistakably different from a known. A missing number renders
 * as a dotted-underlined placeholder, never as a blank cell or a zero — the
 * failure mode this product cannot afford is an analyst reading "no wetlands"
 * where the truth is "we never checked".
 */
export function Value({
  children,
  unknownLabel = 'unknown',
  className,
  mono = true,
}: {
  children: React.ReactNode;
  unknownLabel?: string;
  className?: string;
  mono?: boolean;
}) {
  const isUnknown =
    children == null || children === '' || children === '—' || children === 'unknown';
  if (isUnknown) {
    return (
      <span className={cn('unknown text-xs', className)} title="No value has been established">
        {unknownLabel}
      </span>
    );
  }
  return <span className={cn(mono && 'num', className)}>{children}</span>;
}

/** A labelled figure in a definition grid. */
export function Metric({
  label,
  children,
  hint,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="rule-label truncate" title={hint ?? label}>
        {label}
      </dt>
      <dd className={cn('num mt-0.5 truncate text-sm', tone)}>{children}</dd>
    </div>
  );
}

export function MetricGrid({
  columns = 4,
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement> & { columns?: number }) {
  return (
    <dl
      className={cn('grid gap-x-4 gap-y-3', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      {...props}
    />
  );
}
