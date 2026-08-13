import type { FetchLike } from "./types.js";

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

export class ProviderRateLimiter {
  private tail = Promise.resolve();
  private lastStartedAt = 0;

  constructor(
    private readonly minimumIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}

  schedule<T>(operation: () => Promise<T>) {
    const run = this.tail.then(async () => {
      const waitMs = Math.max(0, this.lastStartedAt + this.minimumIntervalMs - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastStartedAt = this.now();
      return operation();
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export async function fetchProviderJson<T>(input: {
  url: string;
  provider: string;
  fetchImpl: FetchLike;
  limiter: ProviderRateLimiter;
  headers?: Record<string, string>;
}) {
  return input.limiter.schedule(async () => {
    const response = await input.fetchImpl(input.url, { headers: input.headers });
    if (!response.ok) {
      throw new ProviderHttpError(
        `${input.provider} request failed with HTTP ${response.status}.`,
        response.status,
        retryAfterMilliseconds(response.headers.get("retry-after"))
      );
    }
    return response.json() as Promise<T>;
  });
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
