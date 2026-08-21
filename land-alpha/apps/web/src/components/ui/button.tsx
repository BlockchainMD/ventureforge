import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-alpha text-ground hover:bg-alpha/90',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-raised',
        ghost: 'text-ink-muted hover:bg-raised hover:text-ink',
        danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
        good: 'border border-good/40 bg-good/10 text-good hover:bg-good/20',
        subtle: 'bg-raised text-ink hover:bg-line',
      },
      size: {
        sm: 'h-6 px-2 text-[11px] rounded-sm',
        default: 'h-8 px-3 text-xs rounded-sm',
        lg: 'h-9 px-4 text-sm rounded-sm',
        icon: 'h-7 w-7 rounded-sm',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
