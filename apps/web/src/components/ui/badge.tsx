import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-normal",
  {
    variants: {
      variant: {
        default: "border-emerald-400/30 bg-emerald-400/15 text-emerald-200",
        secondary: "border-slate-700 bg-slate-900 text-slate-300",
        warning: "border-amber-400/30 bg-amber-400/15 text-amber-200",
        danger: "border-rose-400/30 bg-rose-400/15 text-rose-200",
        muted: "border-slate-800 bg-slate-950 text-slate-500"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
