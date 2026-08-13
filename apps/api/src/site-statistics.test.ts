import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteStatistics } from "./site-statistics.js";

function result(assetKey: string, metadata: Record<string, unknown>, variants = [{ assetKey: `${assetKey}-1080p` }]) {
  return {
    assetKey,
    title: assetKey,
    source: "test",
    sourceUrl: "",
    durationLabel: "",
    updatedAt: "2026-01-01",
    summary: "",
    metadata,
    variants
  } as never;
}

test("counts animation within movie or television instead of as a separate content type", () => {
  const statistics = buildSiteStatistics([
    result("movie", { workId: "movie-work", kind: "movie", year: "1998", genres: ["剧情", "犯罪"], productionCompanies: ["Studio A", "Studio B"], release: { countries: ["法国"] } }),
    result("movie-duplicate", { workId: "movie-work", kind: "movie", year: "1998", genres: ["剧情", "犯罪"], productionCompanies: ["Studio A", "Studio B"], release: { countries: ["法国"] } }, [{ assetKey: "movie-4k" }]),
    result("series", { kind: "series", year: "2021", genres: ["剧情"], release: { countries: ["美国"] } }),
    result("anime", { kind: "movie", year: "1988", genres: ["动画", "科幻"], release: { countries: ["日本"] } }),
    result("anime-series", { kind: "series", year: "2024", genres: ["动画"], info: "类型：动画 制片国家/地区：韩国 / 中国大陆 语言：韩语" }),
    result("hidden", { kind: "movie", year: "2020", hideFromWebsite: true })
  ], {
    readyAssetKeys: new Set(["movie-1080p"]),
    people: 42,
    latestIndexedAt: "2026-08-10T00:00:00.000Z",
    generatedAt: "2026-08-10T01:00:00.000Z"
  });

  assert.deepEqual(statistics.totals, {
    titles: 4,
    movies: 2,
    series: 2,
    variants: 5,
    instantPlay: 1,
    people: 42,
    genreCount: 4,
    countryCount: 5,
    companyCount: 2,
    companyCoveredTitles: 1
  });
  assert.equal(statistics.totals.movies + statistics.totals.series, statistics.totals.titles);
  assert.equal(statistics.genres.find((item) => item.label === "剧情")?.count, 2);
  assert.equal(statistics.genres.find((item) => item.label === "动画")?.count, 2);
  assert.equal(statistics.decades.find((item) => item.label === "1990 年代")?.count, 1);
  assert.deepEqual(statistics.decades.map((item) => item.label), [
    "未知",
    "1949 年以前",
    "1950 年代",
    "1960 年代",
    "1970 年代",
    "1980 年代",
    "1990 年代",
    "2000 年代",
    "2010 年代",
    "2020 年代"
  ]);
  assert.equal(statistics.countries.length, 5);
  assert.deepEqual(statistics.companies, [
    { label: "Studio A", count: 1 },
    { label: "Studio B", count: 1 }
  ]);
});

test("returns every indexed genre instead of truncating the distribution", () => {
  const genres = Array.from({ length: 16 }, (_, index) => `题材 ${index + 1}`);
  const statistics = buildSiteStatistics([
    result("genre-catalog", { kind: "movie", genres })
  ]);

  assert.equal(statistics.totals.genreCount, 16);
  assert.equal(statistics.genres.length, 16);
  assert.equal(statistics.companies.length, 0);
  assert.deepEqual(new Set(statistics.genres.map((item) => item.label)), new Set(genres));
});
