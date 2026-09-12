// Schedule after completion, so slow requests cannot overlap. Returning false
// permanently stops this poller; rejection backs off until a successful refresh.
export function startVisiblePoll(
  refresh: (isActive: () => boolean) => Promise<boolean | void>,
  intervalMs: number,
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document
) {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const stop = () => {
    stopped = true;
    clear();
    visibility.removeEventListener("visibilitychange", onVisibility);
  };
  const run = async () => {
    clear();
    if (stopped || running || visibility.hidden) return;
    running = true;
    try {
      if (await refresh(() => !stopped) === false) { stop(); return; }
      failures = 0;
    } catch {
      failures = Math.min(failures + 1, 6);
    } finally {
      running = false;
      if (!stopped && !visibility.hidden) {
        timer = setTimeout(run, Math.min(intervalMs * 2 ** failures, 60_000));
      }
    }
  };
  function onVisibility() {
    clear();
    if (!visibility.hidden) void run();
  }
  visibility.addEventListener("visibilitychange", onVisibility);
  void run();
  return stop;
}
