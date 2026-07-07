import * as React from "react";
import { cn } from "../../lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-base text-slate-100 shadow-inner shadow-black/20 outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-md sm:px-3 sm:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";
