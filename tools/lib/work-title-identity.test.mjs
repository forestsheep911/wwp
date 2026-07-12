import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalWorkTitle,
  collectWorkAliases,
  findExistingWorkMatches,
  normalizeWorkAlias,
  workSeason
} from "./work-title-identity.mjs";

test("canonical titles prefer the sourced display title", () => {
  assert.equal(buildCanonicalWorkTitle({ sourceDisplayTitle: "与狼共舞 Dances with Wolves (1990)" }), "与狼共舞 Dances with Wolves (1990)");
  assert.equal(buildCanonicalWorkTitle({ chineseTitle: "拜访者Q", secondaryTitle: "Visitor Q", year: 2001 }), "拜访者Q Visitor Q (2001)");
});

test("temporary and season title forms normalize into duplicate-search aliases", () => {
  assert.equal(normalizeWorkAlias("Fallout Season 2"), normalizeWorkAlias("Fallout S02"));
  assert.equal(normalizeWorkAlias("【敬请期待】辐射 第二季"), normalizeWorkAlias("辐射 第2季"));
  assert.ok(collectWorkAliases({ title: "Visitor Q (2001)", chineseTitle: "拜访者Q" }).includes("拜访者q"));
});

test("external IDs or alias plus year block duplicate creation", () => {
  const works = [
    { pageId: "old", title: "辐射 第二季", chineseTitle: "辐射 第二季", englishTitle: "Fallout Season 2", year: 2025, imdbId: "tt32158505" },
    { pageId: "movie", title: "与狼共舞", englishTitle: "Dances with Wolves", year: 1990, imdbId: "tt0099348" }
  ];
  assert.equal(findExistingWorkMatches({ title: "Fallout S02 (2025)", year: 2025 }, works)[0].existing.pageId, "old");
  assert.equal(findExistingWorkMatches({ title: "临时名字", imdbId: "tt0099348" }, works)[0].evidence.strength, "exact_id");
  assert.deepEqual(findExistingWorkMatches({ title: "与狼共舞", year: 2012 }, works), []);
});

test("a series-level IMDb ID reused across different seasons does not merge the seasons", () => {
  assert.equal(workSeason({ title: "辐射 第二季 Fallout Season 2" }), 2);
  const works = [{ pageId: "s1", title: "辐射 第一季 Fallout Season 1 (2024)", imdbId: "tt12637874" }];
  assert.deepEqual(findExistingWorkMatches({ title: "辐射 第二季", imdbId: "tt12637874" }, works), []);
});
