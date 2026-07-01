import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type ToastVariant = "info" | "success" | "error";

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends Required<Pick<ToastInput, "title" | "variant">> {
  id: string;
  description?: string;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const toastLimit = 4;

function toastIcon(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-rose-300" />;
    default:
      return <Info className="h-4 w-4 text-sky-300" />;
  }
}

function toastClassName(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return "border-emerald-400/30 bg-emerald-950/95";
    case "error":
      return "border-rose-400/30 bg-rose-950/95";
    default:
      return "border-slate-700 bg-slate-950/95";
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    setToasts((currentToasts) => [
      {
        id,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? "info"
      },
      ...currentToasts
    ].slice(0, toastLimit));

    window.setTimeout(() => dismissToast(id), 3600);
  }, [dismissToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-3 bottom-4 z-[220] grid gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-[22rem]"
      >
        {toasts.map((toast) => (
          <div
            className={cn(
              "pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-3 text-sm text-slate-100 shadow-2xl shadow-black/40 backdrop-blur",
              toastClassName(toast.variant)
            )}
            key={toast.id}
          >
            <div className="mt-0.5">{toastIcon(toast.variant)}</div>
            <div className="min-w-0">
              <p className="font-semibold leading-5">{toast.title}</p>
              {toast.description ? (
                <p className="mt-1 text-xs leading-5 text-slate-300">{toast.description}</p>
              ) : null}
            </div>
            <Button
              className="h-7 w-7 border-slate-700/70"
              type="button"
              variant="outline"
              size="icon"
              onClick={() => dismissToast(toast.id)}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return context;
}
