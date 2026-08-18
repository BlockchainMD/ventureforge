import * as React from 'react';
import { cn } from '@/lib/utils';

/** Dense data table primitives. Row height is 30px; that is deliberate. */

export function DataTable({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-xs', className)} {...props} />
    </div>
  );
}

export function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('sticky top-0 z-10 bg-surface [&_th]:border-b [&_th]:border-line', className)}
      {...props}
    />
  );
}

export function Th({
  className,
  align = 'left',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-2 py-1.5',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('data-row border-b border-line/60', className)} {...props} />;
}

export function Td({
  className,
  align = 'left',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'whitespace-nowrap px-2 py-1.5',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-xs text-ink-faint">
        {children}
      </td>
    </tr>
  );
}
