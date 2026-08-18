import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-7 w-full rounded-sm border border-line-strong bg-surface px-2 text-xs text-ink placeholder:text-ink-faint focus-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus-ring',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-7 w-full rounded-sm border border-line-strong bg-surface px-1.5 text-xs text-ink focus-ring',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="rule-label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[10px] text-ink-faint">{hint}</p> : null}
    </label>
  );
}
