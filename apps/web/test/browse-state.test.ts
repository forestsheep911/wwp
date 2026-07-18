import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browseResponseIsCurrent,
  finishBrowseRequest,
  shouldLoadBrowseRoute,
  startBrowseRequest
} from "../src/cinema/browse-state";
import { browseRequestDefaults } from "../src/cinema/browse-load-policy";

test("shouldLoadBrowseRoute does not repeat a route that is already loading", () => {
  assert.equal(shouldLoadBrowseRoute("movie:recent", "movie:recent"), false);
  assert.equal(shouldLoadBrowseRoute("movie:recent", "tv:recent"), true);
});

test("browseResponseIsCurrent rejects an older response for the same route", () => {
  assert.equal(browseResponseIsCurrent({ id: 2, key: "movie:recent" }, { id: 1, key: "movie:recent" }), false);
  assert.equal(browseResponseIsCurrent({ id: 2, key: "movie:recent" }, { id: 2, key: "movie:recent" }), true);
  assert.equal(browseResponseIsCurrent({ id: 2, key: "tv:recent" }, { id: 2, key: "movie:recent" }), false);
});

test("switching views resets a hanging append without letting its stale finish clear the next append", () => {
  const initial = startBrowseRequest({
    active: { id: 0, key: "" },
    loadingInitial: false,
    loadingMore: false
  }, {
    append: false,
    hasMore: false,
    key: "movie:popular"
  });
  assert.equal(initial.started, true);
  if (!initial.started) {
    return;
  }

  const finishedInitial = finishBrowseRequest(initial.state, initial.request);
  const hangingAppend = startBrowseRequest(finishedInitial, {
    append: true,
    hasMore: true,
    key: "movie:popular"
  });
  assert.equal(hangingAppend.started, true);
  if (!hangingAppend.started) {
    return;
  }
  assert.equal(hangingAppend.state.loadingMore, true);

  const switched = startBrowseRequest(hangingAppend.state, {
    append: false,
    hasMore: true,
    key: "tv:recent"
  });
  assert.equal(switched.started, true);
  if (!switched.started) {
    return;
  }
  assert.equal(switched.state.loadingMore, false);
  assert.equal(switched.state.loadingInitial, true);

  const finishedSwitch = finishBrowseRequest(switched.state, switched.request);
  const nextAppend = startBrowseRequest(finishedSwitch, {
    append: true,
    hasMore: true,
    key: "tv:recent"
  });
  assert.equal(nextAppend.started, true);
  if (!nextAppend.started) {
    return;
  }
  assert.equal(nextAppend.state.loadingMore, true);

  const staleFinish = finishBrowseRequest(nextAppend.state, hangingAppend.request);
  assert.deepEqual(staleFinish, nextAppend.state);
  assert.equal(staleFinish.loadingMore, true);

  const nextFinish = finishBrowseRequest(staleFinish, nextAppend.request);
  assert.equal(nextFinish.loadingMore, false);
});

test("blocked append requests do not replace the active request", () => {
  const activeState = {
    active: { id: 7, key: "movie:popular" },
    loadingInitial: false,
    loadingMore: true
  };

  const duplicate = startBrowseRequest(activeState, {
    append: true,
    hasMore: true,
    key: "movie:popular"
  });
  assert.deepEqual(duplicate, { started: false, state: activeState });

  const noMoreState = {
    active: { id: 8, key: "tv:recent" },
    loadingInitial: false,
    loadingMore: false
  };
  const noMore = startBrowseRequest(noMoreState, {
    append: true,
    hasMore: false,
    key: "tv:recent"
  });
  assert.deepEqual(noMore, { started: false, state: noMoreState });
});

test("a deferred initial cache read cannot be replaced by same-route auto-load requests", async () => {
  let releaseCacheRead!: () => void;
  const cacheRead = new Promise<void>((resolve) => {
    releaseCacheRead = resolve;
  });
  let state = {
    active: { id: 0, key: "" },
    loadingInitial: false,
    loadingMore: false
  };
  const networkRequests: Array<{ limit: number; offset: number }> = [];

  const loadInitialShelf = async () => {
    const started = startBrowseRequest(state, {
      append: false,
      hasMore: true,
      key: "movie:popular"
    });
    assert.equal(started.started, true);
    if (!started.started) {
      return;
    }
    state = started.state;
    await cacheRead;
    const defaults = browseRequestDefaults("popular", false);
    networkRequests.push({ limit: defaults.limit, offset: 0 });
    state = finishBrowseRequest(state, started.request);
  };

  const initialLoad = loadInitialShelf();
  await Promise.resolve();
  assert.equal(Reflect.get(state, "loadingInitial"), true);

  const appendDefaults = browseRequestDefaults("popular", true);
  const append = startBrowseRequest(state, {
    append: true,
    hasMore: true,
    key: "movie:popular"
  });
  if (append.started) {
    networkRequests.push({ limit: appendDefaults.limit, offset: 12 });
  }
  assert.equal(append.started, false);

  const reset = startBrowseRequest(state, {
    append: false,
    hasMore: true,
    key: "movie:popular"
  });
  if (reset.started) {
    networkRequests.push({ limit: appendDefaults.limit, offset: 0 });
  }
  assert.equal(reset.started, false);

  releaseCacheRead();
  await initialLoad;
  assert.equal(Reflect.get(state, "loadingInitial"), false);

  const retry = startBrowseRequest(state, {
    append: true,
    hasMore: true,
    key: "movie:popular"
  });
  assert.equal(retry.started, true);
  if (retry.started) {
    networkRequests.push({ limit: appendDefaults.limit, offset: 12 });
  }
  assert.deepEqual(networkRequests, [
    { limit: 12, offset: 0 },
    { limit: 100, offset: 12 }
  ]);
});

test("CinemaApp starts browse requests through the shared state transition", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const refreshStart = appSource.indexOf("function refreshBrowseAssets");
  const refreshEnd = appSource.indexOf("async function recacheHistoryEntry", refreshStart);
  const refreshSource = appSource.slice(refreshStart, refreshEnd);

  assert.match(appSource, /startBrowseRequest[\s\S]{0,200}from "\.\/cinema\/browse-state";/);
  assert.match(refreshSource, /function refreshBrowseAssets[\s\S]{0,200}\): boolean/);
  assert.match(refreshSource, /startBrowseRequest\(\s*browseRequestStateRef\.current,/);
  assert.ok(refreshSource.indexOf("startBrowseRequest") < refreshSource.indexOf("await readBrowseCache"));
  assert.notEqual(refreshSource.indexOf("setBrowseLoading(true)"), -1);
  assert.ok(refreshSource.indexOf("setBrowseLoading(true)") < refreshSource.indexOf("await readBrowseCache"));
  assert.equal(refreshSource.match(/setBrowseLoading\(false\)/g)?.length, 1);
});

test("CinemaApp resets route admission on lock and schedules browse after auth handoff", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const lockStart = appSource.indexOf("function lockCinema()");
  const lockEnd = appSource.indexOf("\n  useEffect(() =>", lockStart);
  const lockSource = appSource.slice(lockStart, lockEnd);
  const errorStart = appSource.indexOf("function handleRequestError");
  const errorEnd = appSource.indexOf("\n  async function refreshResults", errorStart);
  const errorSource = appSource.slice(errorStart, errorEnd);
  const handoffStart = appSource.indexOf("if (!unlocked || !role || authHandoffVersion === 0)");
  const handoffEnd = appSource.indexOf("\n  useEffect(() =>", handoffStart);
  const handoffSource = appSource.slice(handoffStart, handoffEnd);

  assert.match(lockSource, /browseRouteLoadRef\.current = "";/);
  assert.match(lockSource, /cancelBrowseRetry\(\);/);
  assert.match(errorSource, /browseRouteLoadRef\.current = "";/);
  assert.match(errorSource, /cancelBrowseRetry\(\);/);
  assert.match(appSource, /function completeAuth\(/);
  assert.match(appSource, /onUnlock=\{[^]*completeAuth\(auth\)/);
  assert.match(appSource, /checkAccess\(\)[^]*completeAuth\(auth\)/);
  assert.match(handoffSource, /scheduleCurrentBrowseRoute\(routeForCurrentView\(\)\)/);
  assert.match(appSource, /const scheduled = scheduleBrowseRoute\(/);
});

test("CinemaApp automatically retries a failed initial browse route", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const refreshStart = appSource.indexOf("function refreshBrowseAssets");
  const refreshEnd = appSource.indexOf("async function recacheHistoryEntry", refreshStart);
  const refreshSource = appSource.slice(refreshStart, refreshEnd);

  assert.match(refreshSource, /releaseFailedBrowseRoute\(/);
  assert.match(refreshSource, /scheduleBrowseRetry\(request\.key\)/);
  assert.match(appSource, /browseRetryVersion/);
  assert.match(
    appSource,
    /\[activeTab, browseChannel, browseResults\.length, browseRetryVersion, browseView, query, role, unlocked\]/
  );
});
