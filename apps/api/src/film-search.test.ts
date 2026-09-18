import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { SearchResult } from "@wwpdw/shared";
import { searchFilms } from "./film-search.js";

function film(title: string, metadata = {}, key = title): SearchResult {
  return { assetKey: key, title, metadata, source: "notion", sourceUrl: "", summary: "", durationLabel: "", updatedAt: "2026-09-17",
    variants: [{ assetKey: `${key}-video`, sourceUrl: "https://example.test/movie.mp4" }] } as SearchResult;
}

test("partial and English film titles match, plot mentions do not", () => {
  const inception = film("盗梦空间 Inception (2010)");
  const hobbit = film("霍比特人3", {description: "索要本族国宝", external: {omdb: {plot: "国宝"}}});
  for (const query of ["盗梦", "盗梦空间", "INCEPTION"])
    assert.deepEqual(searchFilms([inception, hobbit], query).map(r => r.title), [inception.title]);
  assert.deepEqual(searchFilms([inception, hobbit], "国宝"), []);
});

test("aliases, synchronized cast and legacy basic info find films", () => {
  const row = film("盗梦空间", {titles: [{title: "Inception"}], directors: ["克里斯托弗·诺兰"],
    credits: [{department: "acting", name: "莱昂纳多", originalName: "Leonardo DiCaprio"}],
    info: "主演：约瑟夫·高登-莱维特 / 渡边谦"});
  for (const query of ["Inception", "诺兰", "莱昂纳多", "Leonardo", "渡边谦"])
    assert.equal(searchFilms([row], query).length, 1, query);
});

test("title matches lead cast matches; hidden works and leaf specs are excluded", () => {
  const title = film("国宝", {workId: "one"});
  const duplicate = film("国宝", {workId: "one"}, "other-spec");
  const cast = film("另一部影片", {people: ["国宝"]});
  const leaf = {...film("国宝 / 1080p"), variants: undefined};
  const hidden = film("国宝 hidden", {hideFromWebsite: true});
  const result = searchFilms([cast, leaf, title, duplicate, hidden], "国宝");
  assert.deepEqual(result.map(r => r.title), ["国宝", "另一部影片"]);
  assert.equal(result[0].variants?.length, 2);
});

test("film dialog does not request the independent People catalog", () => {
  const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
  const effect = app.slice(app.indexOf("if (!searchOpen || !submittedSearch)"), app.indexOf("}, [submittedSearch, searchOpen])"));
  assert.ok(effect.length > 0);
  assert.doesNotMatch(effect, /searchPeople\(/);
  assert.match(effect, /searchAssets\(normalizedQuery\)/);
});
