type Snapshot<T> = {
  expiresAt: number;
  value: T[];
};

export class BrowseSnapshotCache<T> {
  private readonly entries = new Map<string, Snapshot<T>>();

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
}
