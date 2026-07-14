import type { BrowseChannel, BrowseViewId } from "./types";

const browseCacheDatabaseName = "wwpdw-browse-cache";
const browseCacheStoreName = "views";
const browseCacheDatabaseVersion = 1;

export const browseCacheTtlMs = 10 * 60 * 1000;

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

function openBrowseCacheDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve<IDBDatabase | undefined>(undefined);
  }

  return new Promise<IDBDatabase | undefined>((resolve) => {
    const request = indexedDB.open(browseCacheDatabaseName, browseCacheDatabaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(browseCacheStoreName)) {
        request.result.createObjectStore(browseCacheStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

export async function readBrowseCache<T>(key: string): Promise<BrowseCacheEntry<T> | undefined> {
  const database = await openBrowseCacheDatabase();
  if (!database) {
    return undefined;
  }

  return new Promise<BrowseCacheEntry<T> | undefined>((resolve) => {
    const transaction = database.transaction(browseCacheStoreName, "readonly");
    const request = transaction.objectStore(browseCacheStoreName).get(key);
    request.onsuccess = () => {
      const entry = request.result as BrowseCacheEntry<T> | undefined;
      resolve(entry && isFreshBrowseCacheEntry(entry) ? entry : undefined);
    };
    request.onerror = () => resolve(undefined);
    transaction.oncomplete = () => database.close();
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
