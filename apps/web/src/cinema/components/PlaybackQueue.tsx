import { useEffect, useRef } from "react";
import { CircleStop, Clock3, UsersRound } from "lucide-react";
import type { PlaybackAdmissionResponse } from "@wwpdw/shared";
import { Button } from "../../components/ui/button";
import { requestPlaybackAdmission } from "../../api";

export function PlaybackQueue({
  admission,
  onAdmitted,
  onCancel,
  onUpdate
}: {
  admission: PlaybackAdmissionResponse;
  onAdmitted: (admission: PlaybackAdmissionResponse) => void;
  onCancel: () => void;
  onUpdate: (admission: PlaybackAdmissionResponse) => void;
}) {
  const completedRef = useRef(false);
  const onAdmittedRef = useRef(onAdmitted);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onAdmittedRef.current = onAdmitted;
    onUpdateRef.current = onUpdate;
  }, [onAdmitted, onUpdate]);

  useEffect(() => {
    if (!admission.ticketId) return;
    let disposed = false;

    const poll = async () => {
      try {
        const next = await requestPlaybackAdmission(admission.assetKey, admission.ticketId);
        if (disposed || completedRef.current) return;
        onUpdateRef.current(next);
        if (next.status === "admitted") {
          completedRef.current = true;
          onAdmittedRef.current(next);
        }
      } catch {
        // A transient network interruption should not silently remove a viewer from the queue.
      }
    };

    const timer = window.setInterval(poll, 2_000);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [admission.assetKey, admission.ticketId]);

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <section className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-950/95 px-6 py-9 text-center shadow-2xl shadow-black/50 sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-amber-300" />
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-amber-300/35 bg-amber-300/10 text-amber-200">
          <Clock3 className="h-9 w-9 animate-pulse" />
        </div>
        <p className="mt-7 text-xs font-black tracking-[0.28em] text-amber-300">家庭影院候场区</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-50 sm:text-3xl">正在排队中</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
          前面的观众结束播放或离开后，你会自动进入播放器。保持此页面打开即可。
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <UsersRound className="h-4 w-4" /> 当前顺位
            </span>
            <strong className="mt-2 block text-2xl text-slate-50">第 {admission.position ?? "—"} 位</strong>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <span className="text-xs font-semibold text-slate-400">播放席位</span>
            <strong className="mt-2 block text-2xl text-slate-50">
              {admission.capacity.active}/{admission.capacity.maximum}
            </strong>
          </div>
        </div>

        <p className="mt-5 truncate text-sm font-semibold text-slate-300" title={admission.title}>
          《{admission.title}》
        </p>
        <Button className="mt-7 w-full sm:w-auto" type="button" variant="outline" onClick={onCancel}>
          <CircleStop className="h-4 w-4" />
          取消排队，稍后再看
        </Button>
      </section>
    </main>
  );
}
