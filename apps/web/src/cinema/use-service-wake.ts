import { useCallback, useEffect, useRef, useState } from "react";
import { wakeBackend } from "../api";
import { serviceWakeDelayMs } from "./components/ServiceWakeDialog";
import {
  currentServiceWakeWarmUntil,
  serviceWakeShouldShowQuiz,
  startSharedServiceWakeProbe
} from "./service-wake";

export function useColdStartWakeDialog({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const probeRunRef = useRef(0);

  const startProbe = useCallback(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }

    const startedAtMs = Date.now();
    const probe = startSharedServiceWakeProbe(wakeBackend, startedAtMs);
    if (!probe) {
      setOpen(false);
      return;
    }

    const probeRun = probeRunRef.current + 1;
    probeRunRef.current = probeRun;
    const timer = window.setTimeout(() => {
      if (probeRunRef.current !== probeRun) {
        return;
      }

      if (serviceWakeShouldShowQuiz({
        delayMs: serviceWakeDelayMs,
        nowMs: Date.now(),
        probeStartedAtMs: startedAtMs,
        warmUntilMs: currentServiceWakeWarmUntil()
      })) {
        setOpen(true);
      }
    }, serviceWakeDelayMs);

    void probe.finally(() => {
      window.clearTimeout(timer);
      if (probeRunRef.current === probeRun) {
        setOpen(false);
      }
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      probeRunRef.current += 1;
      setOpen(false);
      return;
    }

    startProbe();
  }, [enabled, startProbe]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function probeWhenVisible() {
      if (document.visibilityState === "visible") {
        startProbe();
      }
    }

    window.addEventListener("focus", startProbe);
    document.addEventListener("visibilitychange", probeWhenVisible);
    return () => {
      window.removeEventListener("focus", startProbe);
      document.removeEventListener("visibilitychange", probeWhenVisible);
    };
  }, [enabled, startProbe]);

  return {
    open,
    setOpen
  };
}
