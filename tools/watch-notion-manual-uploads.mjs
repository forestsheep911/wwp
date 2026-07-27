// Shared backoff and bounded-scan policy for explicit manual-upload checks.
// This module intentionally has no background loop; callers must supply a
// bounded page set and invoke the scan explicitly.

export const DEFAULT_ROOT_DELAY_MS = 250;
export const DEFAULT_SCAN_TIMEOUT_SEC = 600;
export const DEFAULT_MAX_DELAY_SEC = 7200;

export function chooseScanMode(now, lastFullScan, fullInterval) {
  return Number(now) - Number(lastFullScan) >= Number(fullInterval) ? "full" : "recent";
}

export function scanConcurrency(rootSweep) {
  return rootSweep ? 1 : 1;
}

export function effectiveScanDelayMs(rootSweep, delayMs = DEFAULT_ROOT_DELAY_MS) {
  return rootSweep ? Math.max(0, Number(delayMs) || 0) : 0;
}

export function scanSucceeded(exitCode, stderr = "") {
  void stderr;
  return Number(exitCode) === 0;
}

export function nextDelaySec(minDelaySec, currentDelaySec, failed, maxDelaySec = DEFAULT_MAX_DELAY_SEC) {
  const minimum = Math.max(1, Number(minDelaySec) || 1);
  const maximum = Math.max(minimum, Number(maxDelaySec) || DEFAULT_MAX_DELAY_SEC);
  if (failed) return minimum;
  return Math.min(maximum, Math.max(minimum, Number(currentDelaySec) || minimum) * 2);
}
