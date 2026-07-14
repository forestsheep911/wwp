import type { BrowseChannel, BrowseViewId } from "./types";

const browseCacheDatabaseName = "wwpdw-browse-cache";
const browseCacheStoreName = "views";
const browseCacheDatabaseVersion = 1;

export const browseCacheTtlMs = 10 * 60 * 1000;
export const browseCacheReadDeadlineMs = 250;

export type BrowseCacheEntry<T> = {
  savedAt: number;
  value: T;
};

export function browseCacheKey(scope: string, channel: BrowseChannel, view: BrowseViewId) {
  return `${scope}:${channel}:${view}`;
}

export function isFreshBrowseCacheEntry<T>(entry: BrowseCacheEntry<T>, nowMs = Date.now()) {
  return entry.savedAt <= nowMs && nowMs - entry.savedAt <= browseCacheTtlMs;
}

function openBrowseCacheDatabase(deadlineMs?: number) {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve<IDBDatabase | undefined>(undefined);
  }

  return new Promise<IDBDatabase | undefined>((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let request: IDBOpenDBRequest;
    const finish = (database?: IDBDatabase) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolve(database);
    };
    try {
      request = indexedDB.open(browseCacheDatabaseName, browseCacheDatabaseVersion);
    } catch {
      finish();
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(browseCacheStoreName)) {
        request.result.createObjectStore(browseCacheStoreName);
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish();
    request.onblocked = () => finish();
    if (deadlineMs !== undefined) {
      deadline = setTimeout(() => finish(), deadlineMs);
    }
  });
}

export async function readBrowseCache<T>(
  key: string,
  deadlineMs = browseCacheReadDeadlineMs
): Promise<BrowseCacheEntry<T> | undefined> {
  const startedAt = Date.now();
  const database = await openBrowseCacheDatabase(deadlineMs);
  if (!database) {
    return undefined;
  }
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    database.close();
    return undefined;
  }

  return new Promise<BrowseCacheEntry<T> | undefined>((resolve) => {
    let settled = false;
    let closed = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let transaction: IDBTransaction;
    let request: IDBRequest;
    const closeDatabase = () => {
      if (!closed) {
        closed = true;
        database.close();
      }
    };
    const finish = (entry?: BrowseCacheEntry<T>, abort = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (abort) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed while the deadline fired.
        }
      }
      closeDatabase();
      resolve(entry);
    };
    try {
      transaction = database.transaction(browseCacheStoreName, "readonly");
      request = transaction.objectStore(browseCacheStoreName).get(key);
    } catch {
      closeDatabase();
      resolve(undefined);
      return;
    }
    request.onsuccess = () => {
      const entry = request.result as BrowseCacheEntry<T> | undefined;
      finish(entry && isFreshBrowseCacheEntry(entry) ? entry : undefined);
    };
    request.onerror = () => finish();
    transaction.oncomplete = closeDatabase;
    transaction.onerror = () => finish();
    transaction.onabort = () => finish();
    deadline = setTimeout(() => finish(undefined, true), remainingMs);
  });
}

export async function writeBrowseCache<T>(key: string, value: T) {
  const database = await openBrowseCacheDatabase();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(browseCacheStoreName, "readwrite");
    transaction.objectStore(browseCacheStoreName).put({ savedAt: Date.now(), value } satisfies BrowseCacheEntry<T>, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}
