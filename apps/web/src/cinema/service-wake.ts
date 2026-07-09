export const serviceWakeWarmTtlMs = 10 * 60 * 1000;
export const serviceWakeWarmStorageKey = "wwpdw-service-wake-warm-until";

let sharedWakeProbe: Promise<boolean> | undefined;
let memoryWarmUntilMs = 0;

function readWarmUntilFromStorage() {
  if (typeof sessionStorage === "undefined") {
    return 0;
  }

  const parsed = Number(sessionStorage.getItem(serviceWakeWarmStorageKey));
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeWarmUntilToStorage(warmUntilMs: number) {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.setItem(serviceWakeWarmStorageKey, String(warmUntilMs));
}

export function serviceWakeWarmUntil(nowMs: number, ttlMs = serviceWakeWarmTtlMs) {
  return nowMs + ttlMs;
}

export function serviceWakeIsWarm(warmUntilMs: number, nowMs: number) {
  return warmUntilMs > nowMs;
}

export function currentServiceWakeWarmUntil() {
  return Math.max(memoryWarmUntilMs, readWarmUntilFromStorage());
}

export function markServiceWakeWarm(nowMs = Date.now()) {
  const warmUntilMs = serviceWakeWarmUntil(nowMs);
  memoryWarmUntilMs = warmUntilMs;
  writeWarmUntilToStorage(warmUntilMs);
  return warmUntilMs;
}

export function serviceWakeShouldShowQuiz({
  delayMs,
  nowMs,
  probeStartedAtMs,
  warmUntilMs
}: {
  delayMs: number;
  nowMs: number;
  probeStartedAtMs?: number;
  warmUntilMs: number;
}) {
  return Boolean(
    probeStartedAtMs !== undefined &&
    !serviceWakeIsWarm(warmUntilMs, nowMs) &&
    nowMs - probeStartedAtMs >= delayMs
  );
}

export function startSharedServiceWakeProbe(runProbe: () => Promise<boolean>, nowMs = Date.now()) {
  if (serviceWakeIsWarm(currentServiceWakeWarmUntil(), nowMs)) {
    return undefined;
  }

  sharedWakeProbe ??= runProbe()
    .then((ok) => {
      if (ok) {
        markServiceWakeWarm();
      }
      return ok;
    })
    .finally(() => {
      sharedWakeProbe = undefined;
    });

  return sharedWakeProbe;
}
