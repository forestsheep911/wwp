import assert from "node:assert/strict";
import test from "node:test";

import { routeFromUrl, routeUrl } from "../src/cinema/routing.js";

const baseRoute = {
  tab: "library" as const,
  browseChannel: "recommended" as const,
  browseView: "newGood" as const,
  query: ""
};

test("person routes use one canonical path and do not leak the originating search", () => {
  assert.equal(routeUrl({ ...baseRoute, query: "步履", personId: "person_123" }, "https://example.test/?q=old"), "/people/person_123");
  assert.equal(routeUrl({ ...baseRoute, personId: "person id/特殊" }, "https://example.test/"), "/people/person%20id%2F%E7%89%B9%E6%AE%8A");
});

test("direct person paths open the people tab", () => {
  const route = routeFromUrl(new URL("https://example.test/people/person_123"));
  assert.equal(route.tab, "people");
  assert.equal(route.personId, "person_123");
  assert.equal(route.query, "");
});

test("legacy query links remain readable and canonicalize through routeUrl", () => {
  const route = routeFromUrl(new URL("https://example.test/?q=%E6%AD%A5%E5%B1%A5&person=person_123"));
  assert.equal(route.personId, "person_123");
  assert.equal(route.query, "步履");
  assert.equal(routeUrl(route, "https://example.test/?q=%E6%AD%A5%E5%B1%A5&person=person_123"), "/people/person_123");
});

test("library searches keep their query when no person is open", () => {
  assert.equal(routeUrl({ ...baseRoute, query: "步履" }, "https://example.test/people/old"), "/?q=%E6%AD%A5%E5%B1%A5");
});

test("movie details use a canonical path while retaining an optional search context", () => {
  assert.equal(
    routeUrl({ ...baseRoute, query: "十二罗汉", detailAssetKey: "notion-page/特殊" }, "https://example.test/?detail=old"),
    "/movie/notion-page%2F%E7%89%B9%E6%AE%8A?q=%E5%8D%81%E4%BA%8C%E7%BD%97%E6%B1%89"
  );

  const route = routeFromUrl(new URL("https://example.test/movie/notion-page%2F%E7%89%B9%E6%AE%8A?q=%E5%8D%81%E4%BA%8C%E7%BD%97%E6%B1%89"));
  assert.equal(route.detailAssetKey, "notion-page/特殊");
  assert.equal(route.query, "十二罗汉");
});

test("legacy detail links remain readable and canonicalize to a movie path", () => {
  const route = routeFromUrl(new URL("https://example.test/?q=%E5%8D%81%E4%BA%8C&detail=asset_123"));
  assert.equal(route.detailAssetKey, "asset_123");
  assert.equal(routeUrl(route, "https://example.test/?q=%E5%8D%81%E4%BA%8C&detail=asset_123"), "/movie/asset_123?q=%E5%8D%81%E4%BA%8C");
});
