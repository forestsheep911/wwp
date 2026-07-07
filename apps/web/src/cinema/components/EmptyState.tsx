import type { ReactNode } from "react";
import { Card, CardContent } from "../../components/ui/card";

export function EmptyState({ description, icon, title }: { description?: string; icon: ReactNode; title: string }) {
  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardContent className="grid place-items-center gap-3 p-6 text-center text-slate-500 sm:p-10">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-slate-800 bg-slate-950 sm:h-10 sm:w-10 sm:rounded-lg">
          {icon}
        </div>
        <div className="grid gap-1">
          <p className="font-semibold">{title}</p>
          {description ? <p className="text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
