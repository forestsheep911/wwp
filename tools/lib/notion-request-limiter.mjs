import { setTimeout as sleep } from "node:timers/promises";

export function createPacedFetch(fetchImpl, { minIntervalMs = 1000, now = () => Date.now(), wait = sleep } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new TypeError("minIntervalMs must be non-negative");

  let tail = Promise.resolve();
  let lastStartedAt = null;
  return (...args) => {
    const run = async () => {
      if (lastStartedAt !== null) {
        const delay = Math.max(0, minIntervalMs - (now() - lastStartedAt));
        if (delay > 0) await wait(delay);
      }
      lastStartedAt = now();
      return fetchImpl(...args);
    };
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
