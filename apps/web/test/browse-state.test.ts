import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browseResponseIsCurrent,
  finishBrowseRequest,
  shouldLoadBrowseRoute,
  startBrowseRequest
} from "../src/cinema/browse-state";

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

  const hangingAppend = startBrowseRequest(initial.state, {
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

  const nextAppend = startBrowseRequest(switched.state, {
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
    loadingMore: false
  };
  const noMore = startBrowseRequest(noMoreState, {
    append: true,
    hasMore: false,
    key: "tv:recent"
  });
  assert.deepEqual(noMore, { started: false, state: noMoreState });
});

test("CinemaApp starts browse requests through the shared state transition", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /startBrowseRequest[\s\S]{0,200}from "\.\/cinema\/browse-state";/);
  assert.match(appSource, /startBrowseRequest\(\s*browseRequestStateRef\.current,/);
});
