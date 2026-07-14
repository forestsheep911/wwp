type Snapshot<T> = {
  expiresAt: number;
  value: T[];
};

export const defaultBrowseSnapshotTtlMs = 10 * 60 * 1000;

export class BrowseSnapshotCache<T> {
  private readonly entries = new Map<string, Snapshot<T>>();
  private readonly pending = new Map<string, Promise<T[]>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, nowMs = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < nowMs) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T[], nowMs = Date.now()) {
    this.entries.set(key, {
      expiresAt: nowMs + this.ttlMs,
      value
    });
  }

  async getOrLoad(key: string, loader: () => Promise<T[]>, nowMs = Date.now()) {
    const cached = this.get(key, nowMs);
    if (cached) return cached;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = loader().then((value) => {
      this.set(key, value, nowMs);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }
}
