import assert from "node:assert/strict";
import test from "node:test";

import * as browseCache from "../src/cinema/browse-cache";

const { browseCacheKey, browseCacheTtlMs, isFreshBrowseCacheEntry, readBrowseCache } = browseCache;
const testDeadlineMs = 10;
const guardDeadlineMs = 100;

type FakeRequest<T> = {
  result: T;
  onblocked: (() => void) | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};

type FakeTransaction = {
  abort: () => void;
  objectStore: () => {
    get: () => FakeRequest<unknown>;
  };
  onabort: (() => void) | null;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
};

function createRequest<T>(result?: T): FakeRequest<T> {
  return {
    result: result as T,
    onblocked: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null
  };
}

function installIndexedDb(
  t: { after: (cleanup: () => void) => void },
  open: () => FakeRequest<unknown>
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open }
  });
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, "indexedDB", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });
}

async function readBeforeGuard<T>(key: string, deadlineMs = testDeadlineMs) {
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readBrowseCache<T>(key, deadlineMs),
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error("browse cache read did not settle")), guardDeadlineMs);
      })
    ]);
  } finally {
    clearTimeout(guard);
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function installReadableDatabase(
  t: { after: (cleanup: () => void) => void },
  entry: unknown
) {
  const openRequest = createRequest<unknown>();
  const getRequest = createRequest(entry);
  let closeCalls = 0;
  const transaction: FakeTransaction = {
    abort() {},
    objectStore: () => ({ get: () => getRequest }),
    onabort: null,
    oncomplete: null,
    onerror: null
  };
  const database = {
    close: () => {
      closeCalls += 1;
    },
    objectStoreNames: { contains: () => true },
    transaction: () => {
      queueMicrotask(() => {
        getRequest.onsuccess?.();
        transaction.oncomplete?.();
      });
      return transaction;
    }
  };
  openRequest.result = database;
  installIndexedDb(t, () => {
    queueMicrotask(() => openRequest.onsuccess?.());
    return openRequest;
  });
  return { get closeCalls() { return closeCalls; } };
}

test("browse cache entries expire after the configured TTL", () => {
  const now = 1_000_000;
  assert.equal(isFreshBrowseCacheEntry({ savedAt: now - browseCacheTtlMs, value: { value: 1 } }, now), true);
  assert.equal(isFreshBrowseCacheEntry({ savedAt: now - browseCacheTtlMs - 1, value: { value: 1 } }, now), false);
});

test("browse cache keys remain isolated by member and view", () => {
  assert.notEqual(
    browseCacheKey("member:one", "movie", "recent"),
    browseCacheKey("member:two", "movie", "recent")
  );
  assert.notEqual(
    browseCacheKey("member:one", "movie", "recent"),
    browseCacheKey("member:one", "movie", "topRated")
  );
});

test("browse cache read deadline defaults to 250 milliseconds", () => {
  assert.equal(browseCache.browseCacheReadDeadlineMs, 250);
});

test("readBrowseCache uses the exported deadline when no deadline argument is provided", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  installIndexedDb(t, () => createRequest());
  let settled = false;
  let result: unknown = Symbol("unsettled");
  void readBrowseCache("default-deadline").then((value) => {
    settled = true;
    result = value;
  });

  t.mock.timers.tick(browseCache.browseCacheReadDeadlineMs - 1);
  await flushMicrotasks();
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(settled, true);
  assert.equal(result, undefined);
});

test("readBrowseCache returns a fresh cached entry", async (t) => {
  const entry = { savedAt: Date.now(), value: { results: ["cached"] } };
  const database = installReadableDatabase(t, entry);

  assert.deepEqual(await readBeforeGuard("fresh"), entry);
  assert.equal(database.closeCalls, 1);
});

test("readBrowseCache ignores an expired cached entry", async (t) => {
  const entry = { savedAt: Date.now() - browseCacheTtlMs - 1, value: { results: ["stale"] } };
  const database = installReadableDatabase(t, entry);

  assert.equal(await readBeforeGuard("expired"), undefined);
  assert.equal(database.closeCalls, 1);
});

test("readBrowseCache resolves when IndexedDB open never settles", async (t) => {
  installIndexedDb(t, () => createRequest());

  assert.equal(await readBeforeGuard("hung-open"), undefined);
});

test("readBrowseCache resolves immediately when IndexedDB open is blocked", async (t) => {
  const openRequest = createRequest();
  installIndexedDb(t, () => {
    queueMicrotask(() => openRequest.onblocked?.());
    return openRequest;
  });

  assert.equal(await readBeforeGuard("blocked-open", 1_000), undefined);
});

test("readBrowseCache closes a database that opens after its deadline", async (t) => {
  const openRequest = createRequest<unknown>();
  let closeCalls = 0;
  const database = {
    close: () => {
      closeCalls += 1;
    }
  };
  installIndexedDb(t, () => openRequest);

  assert.equal(await readBeforeGuard("late-open"), undefined);
  openRequest.result = database;
  openRequest.onsuccess?.();

  assert.equal(closeCalls, 1);
});

test("readBrowseCache aborts and closes a never-settling get transaction", async (t) => {
  const openRequest = createRequest<unknown>();
  const getRequest = createRequest<unknown>();
  let abortCalls = 0;
  let closeCalls = 0;
  const transaction: FakeTransaction = {
    abort: () => {
      abortCalls += 1;
    },
    objectStore: () => ({ get: () => getRequest }),
    onabort: null,
    oncomplete: null,
    onerror: null
  };
  const database = {
    close: () => {
      closeCalls += 1;
    },
    objectStoreNames: { contains: () => true },
    transaction: () => transaction
  };
  openRequest.result = database;
  installIndexedDb(t, () => {
    queueMicrotask(() => openRequest.onsuccess?.());
    return openRequest;
  });

  assert.equal(await readBeforeGuard("hung-get"), undefined);
  assert.equal(abortCalls, 1);
  assert.equal(closeCalls, 1);

  getRequest.result = { savedAt: Date.now(), value: { results: ["late"] } };
  getRequest.onsuccess?.();
  transaction.oncomplete?.();
  assert.equal(abortCalls, 1);
  assert.equal(closeCalls, 1);
});

test("readBrowseCache shares one deadline budget across a delayed open and hung get", async (t) => {
  const deadlineMs = 100;
  const openDelayMs = 60;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const openRequest = createRequest<unknown>();
  const getRequest = createRequest<unknown>();
  let abortCalls = 0;
  let closeCalls = 0;
  let settled = false;
  let result: unknown = Symbol("unsettled");
  const transaction: FakeTransaction = {
    abort: () => {
      abortCalls += 1;
    },
    objectStore: () => ({ get: () => getRequest }),
    onabort: null,
    oncomplete: null,
    onerror: null
  };
  const database = {
    close: () => {
      closeCalls += 1;
    },
    objectStoreNames: { contains: () => true },
    transaction: () => transaction
  };
  openRequest.result = database;
  installIndexedDb(t, () => {
    setTimeout(() => openRequest.onsuccess?.(), openDelayMs);
    return openRequest;
  });
  void readBrowseCache("shared-deadline", deadlineMs).then((value) => {
    settled = true;
    result = value;
  });

  t.mock.timers.tick(openDelayMs);
  await flushMicrotasks();
  t.mock.timers.tick(deadlineMs - openDelayMs - 1);
  await flushMicrotasks();
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(settled, true);
  assert.equal(result, undefined);
  assert.equal(abortCalls, 1);
  assert.equal(closeCalls, 1);
});
