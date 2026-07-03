import { Clapperboard, Film, Projector } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { copy } from "../i18n";

export const serviceWakeDelayMs = 1600;

export function ServiceWakeDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,460px)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Projector className="h-5 w-5 text-emerald-300" />
            {copy.access.wake.title}
          </DialogTitle>
          <DialogDescription>{copy.access.wake.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="relative overflow-hidden rounded-md border border-slate-800 bg-slate-950 p-3">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <Clapperboard className="h-8 w-8 text-emerald-300" />
              <div className="grid gap-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-300" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {copy.access.wake.frames.map((frame) => (
                    <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-center text-[11px] font-semibold text-slate-300" key={frame}>
                      {frame}
                    </span>
                  ))}
                </div>
              </div>
              <Film className="h-8 w-8 animate-spin text-slate-400 [animation-duration:2.4s]" />
            </div>
          </div>
          <p className="text-sm leading-6 text-slate-300">{copy.access.wake.status}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
