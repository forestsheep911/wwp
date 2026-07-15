import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browseAppendPageLimit,
  browseFullCatalogRequest,
  browseInitialVisibleCount,
  browseRequestDefaults,
  browseTspdtCatalogLimit,
  resolveBrowseRequest
} from "../src/cinema/browse-load-policy";

test("ordinary browse routes request only the visible first shelf", () => {
  assert.equal(browseInitialVisibleCount, 12);
  for (const view of ["newGood", "recent", "popular", "topRated", "mostWatched", "doubanRank", "imdbRank", "rottenRank"] as const) {
    assert.deepEqual(browseRequestDefaults(view, false), { mode: "paged", limit: 12 });
  }
});

test("append requests retain the larger background page", () => {
  assert.equal(browseAppendPageLimit, 100);
  assert.deepEqual(browseRequestDefaults("newGood", true), { mode: "paged", limit: 100 });
  assert.deepEqual(browseRequestDefaults("popular", true), { mode: "paged", limit: 100 });
});

test("lucky and TSPDT retain their special initial request sizes", () => {
  assert.equal(browseTspdtCatalogLimit, 2_000);
  assert.deepEqual(browseRequestDefaults("lucky", false), { mode: "random", limit: 48 });
  assert.deepEqual(browseRequestDefaults("tspdtRank", false), { mode: "paged", limit: 2_000 });
});

test("automatic login and channel or view changes resolve through the initial-shelf policy", () => {
  assert.deepEqual(resolveBrowseRequest("newGood"), {
    append: false,
    view: "newGood",
    mode: "paged",
    limit: 12
  });
  assert.deepEqual(resolveBrowseRequest("newGood", { view: "popular" }), {
    append: false,
    view: "popular",
    mode: "paged",
    limit: 12
  });
  assert.deepEqual(resolveBrowseRequest("popular", { view: "lucky" }), {
    append: false,
    view: "lucky",
    mode: "random",
    limit: 48
  });
});

test("LibraryTab full-catalog requests keep ordinary append and TSPDT limits", () => {
  assert.deepEqual(browseFullCatalogRequest("popular"), { mode: "paged", limit: 100 });
  assert.deepEqual(browseFullCatalogRequest("mostWatched"), { mode: "paged", limit: 100 });
  assert.deepEqual(browseFullCatalogRequest("tspdtRank"), { mode: "paged", limit: 2_000 });
  assert.deepEqual(resolveBrowseRequest("popular", { append: true }), {
    append: true,
    view: "popular",
    mode: "paged",
    limit: 100
  });
});

test("CinemaApp and LibraryTab consume the shared request policies", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const librarySource = readFileSync(new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url), "utf8");

  assert.match(appSource, /const resolvedRequest = resolveBrowseRequest\(browseView, options\);/);
  assert.match(appSource, /refreshBrowseAssets\(\{ channel: nextChannel, view: nextBrowseView \}\)/);
  assert.match(appSource, /refreshBrowseAssets\(\{ view: browseView \}\)/);
  assert.match(librarySource, /const fullCatalogRequest = browseFullCatalogRequest\(activeSortView\);/);
  assert.match(librarySource, /append: true, mode: fullCatalogRequest\.mode, limit: browseRequestLimit/);
});

test("LibraryTab defers its scroll observer until the initial request finishes", () => {
  const librarySource = readFileSync(new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url), "utf8");
  const observerIndex = librarySource.indexOf("const observer = new IntersectionObserver");
  const effectStart = librarySource.lastIndexOf("useEffect(() =>", observerIndex);
  const effectEnd = librarySource.indexOf("\n\n  return (", observerIndex);
  const observerEffect = librarySource.slice(effectStart, effectEnd);

  assert.match(observerEffect, /if \(browseLoading \|\|/);
  assert.match(observerEffect, /\}, \[browseLoading, browseLoadingMore,/);
});
