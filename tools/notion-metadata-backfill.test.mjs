import assert from "node:assert/strict";
import test from "node:test";

import { buildPatch, candidateYearConflict, doubanIdentityUnverified, existingImdbIdentity, fetchImdbRating, metadataGateSnapshot, metadataIdentityConflict, parseArgs, parseInfoPairs, preferredDoubanSubjectId, simplifiedChineseTitleFromDouban } from "./notion-metadata-backfill.mjs";

test("parses physical direct access and the explicit timestamp recovery switch", () => {
  const options = parseArgs(["--page-id", "page-1", "--local-address", "192.168.1.22", "--skip-metadata-updated-at", "--dry-run"]);
  assert.deepEqual(options.pageIds, ["page-1"]);
  assert.equal(options.localAddress, "192.168.1.22");
  assert.equal(options.dryRun, true);
  assert.equal(options.skipMetadataUpdatedAt, true);
});

test("metadata gate reports exact missing core fields", () => {
  const properties = pageWithProperties({
    "Simplified Chinese Title": filledRichText("测试片"),
    "Release Year": { type: "number", number: 2021 },
    "上映日期": { type: "date", date: { start: "2021-01-01" } },
    Countries: { type: "multi_select", multi_select: [{ name: "美国" }] },
    Languages: { type: "multi_select", multi_select: [{ name: "英语" }] },
    "旨趣": { type: "multi_select", multi_select: [{ name: "剧情" }] },
    "外部类型原文": filledRichText("剧情"),
    "Runtime Minutes": { type: "number", number: 100 },
    Directors: filledRichText("测试导演"),
    Cast: filledRichText("测试演员"),
    "Poster URL": { type: "url", url: "https://example.com/poster.jpg" },
    "IMDb ID": filledRichText("tt1234567"),
    "AI建议最低年龄": { type: "number", number: null },
    "AI年龄建议置信度": { type: "number", number: null },
    "内容风险标签": { type: "multi_select", multi_select: [] },
    "AI年龄建议理由": { type: "rich_text", rich_text: [] }
  }).properties;
  const gate = metadataGateSnapshot(properties, {});
  assert.deepEqual(gate.missingCoreFields, ["AI建议最低年龄", "AI年龄建议置信度", "内容风险标签", "AI年龄建议理由"]);
  assert.equal(gate.eligible, false);
});

test("derives the structured Chinese title from a verified Douban display title", () => {
  const properties = pageWithProperties({
    "English Title": filledRichText("Finch"),
    "Original Title": filledRichText("Finch")
  }).properties;
  assert.equal(simplifiedChineseTitleFromDouban(properties, {
    doubanDisplayTitle: "芬奇 Finch (2021)",
    releaseYear: 2021
  }), "芬奇");
});

test("derives the Chinese title from a Douban title even when structured foreign fields are empty", () => {
  assert.equal(simplifiedChineseTitleFromDouban(pageWithProperties().properties, {
    doubanDisplayTitle: "触不可及 Intouchables (2011)",
    releaseYear: 2011
  }), "触不可及");
});

test("buildPatch writes a valid rich-text payload for the simplified Chinese title", () => {
  const patch = buildPatch(pageWithProperties({
    "English Title": filledRichText("Finch")
  }), {
    subjectId: "1234567",
    doubanDisplayTitle: "芬奇 Finch (2021)",
    releaseYear: 2021,
    genres: []
  }, undefined, undefined, { now: "2026-08-28" });

  assert.equal(patch["Simplified Chinese Title"].rich_text[0].text.content, "芬奇");
});

test("forceDoubanFields repairs a mixed-language simplified Chinese title", () => {
  const patch = buildPatch(pageWithProperties({
    "Simplified Chinese Title": filledRichText("触不可及 Intouchables")
  }), {
    subjectId: "6786002",
    doubanDisplayTitle: "触不可及 Intouchables (2011)",
    releaseYear: 2011,
    genres: []
  }, undefined, undefined, { now: "2026-08-28", forceDoubanFields: true });

  assert.equal(patch["Simplified Chinese Title"].rich_text[0].text.content, "触不可及");
});

test("fetchImdbRating falls back to IMDb when OMDb has no rating", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("omdbapi.com")) {
      return { ok: true, text: async () => JSON.stringify({ imdbRating: "N/A" }) };
    }
    return { ok: true, text: async () => "IMDb RATING 8.2/10" };
  };
  try {
    assert.equal(await fetchImdbRating("tt43592244", 1000, { omdbApiKey: "test-key" }), 8.2);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /r\.jina\.ai\/http:\/\/www\.imdb\.com\/title\/tt43592244\/ratings/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a Douban hit that cannot prove the trusted IMDb identity", () => {
  const properties = pageWithProperties({
    "IMDb ID": filledRichText("tt31514146")
  }).properties;
  assert.equal(doubanIdentityUnverified(properties, { imdbId: "tt34361658" }), true);
  assert.equal(doubanIdentityUnverified(properties, {}), true);
  assert.equal(doubanIdentityUnverified(properties, { imdbId: "tt31514146" }), false);
});

test("allows a season Douban page whose IMDb field points to an episode", () => {
  const properties = pageWithProperties({
    "IMDb ID": filledRichText("tt4786824")
  }).properties;
  assert.equal(
    doubanIdentityUnverified(
      properties,
      { imdbId: "tt7871786" },
      { title: "王冠 第三季 The Crown Season 3 (2019)" }
    ),
    false
  );
});

function emptyProperty(type) {
  if (type === "number") return { type, number: null };
  if (type === "date") return { type, date: null };
  if (type === "multi_select") return { type, multi_select: [] };
  if (type === "select") return { type, select: null };
  if (type === "files") return { type, files: [] };
  if (type === "title") return { type, title: [{ plain_text: "【敬请期待】牡丹花下 (2017)", text: { content: "【敬请期待】牡丹花下 (2017)" } }] };
  return { type, rich_text: [] };
}

function filledRichText(value) {
  return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] };
}

function pageWithProperties(overrides = {}) {
  return {
    properties: {
      Title: emptyProperty("title"),
      "Simplified Chinese Title": emptyProperty("rich_text"),
      "English Title": emptyProperty("rich_text"),
      "Original Title": emptyProperty("rich_text"),
      "豆瓣评分": emptyProperty("number"),
      "IMDB评分": emptyProperty("number"),
      "Release Year": emptyProperty("number"),
      "上映日期": emptyProperty("date"),
      Countries: emptyProperty("multi_select"),
      Languages: emptyProperty("multi_select"),
      "Traditional Chinese Title (Taiwan)": emptyProperty("rich_text"),
      "Traditional Chinese Title (Hong Kong)": emptyProperty("rich_text"),
      "旨趣": emptyProperty("multi_select"),
      "外部类型原文": emptyProperty("rich_text"),
      "未映射类型": emptyProperty("rich_text"),
      "Runtime Minutes": emptyProperty("number"),
      Directors: emptyProperty("rich_text"),
      Writers: emptyProperty("rich_text"),
      Cast: emptyProperty("rich_text"),
      "Production Companies": emptyProperty("rich_text"),
      Distributors: emptyProperty("rich_text"),
      Studios: emptyProperty("rich_text"),
      imdb: emptyProperty("rich_text"),
      "IMDb ID": emptyProperty("rich_text"),
      "IMDb URL": { type: "url", url: null },
      "Douban Subject ID": emptyProperty("rich_text"),
      "Douban URL": { type: "url", url: null },
      "Poster URL": { type: "url", url: null },
      "简介": emptyProperty("rich_text"),
      "基本信息": emptyProperty("rich_text"),
      "海报": emptyProperty("files"),
      "Match Status": emptyProperty("select"),
      "Metadata Status": emptyProperty("select"),
      "Metadata Source": emptyProperty("multi_select"),
      "Metadata Confidence": emptyProperty("number"),
      "Needs Review": { type: "checkbox", checkbox: false },
      "Metadata Updated At": emptyProperty("date"),
      ...overrides
    }
  };
}

test("buildPatch fills structured Douban metadata fields", () => {
  const metadata = {
    subjectId: "26761325",
    subjectUrl: "https://movie.douban.com/subject/26761325/",
    posterUrl: "https://img.example/poster.jpg",
    doubanRating: 6.3,
    releaseDate: "2017-05-24",
    releaseYear: 2017,
    genres: ["剧情", "奇怪类型"],
    imdbId: "tt5592248",
    countries: ["美国"],
    languages: ["英语", "法语"],
    regionalTitles: {
      taiwan: "魅惑",
      hongKong: "牡丹花下"
    },
    runtimeMinutes: 93,
    directors: ["索菲亚·科波拉"],
    writers: ["索菲亚·科波拉", "托马斯·卡利南"],
    cast: ["科林·法瑞尔", "妮可·基德曼"],
    productionCompanies: ["American Zoetrope", "FR Productions"],
    distributors: ["Focus Features（美国院线）"],
    studios: ["American Zoetrope"],
    description: "美国内战期间的寄宿女校故事。",
    basicInfo: "导演：索菲亚·科波拉"
  };

  const patch = buildPatch(pageWithProperties(), metadata, 6.3, undefined, { now: "2026-07-07" });

  assert.equal(patch["Release Year"].number, 2017);
  assert.equal(patch["上映日期"].date.start, "2017-05-24");
  assert.deepEqual(patch.Countries.multi_select.map((item) => item.name), ["美国"]);
  assert.deepEqual(patch.Languages.multi_select.map((item) => item.name), ["英语", "法语"]);
  assert.equal(patch["Traditional Chinese Title (Taiwan)"].rich_text[0].text.content, "魅惑");
  assert.equal(patch["Traditional Chinese Title (Hong Kong)"].rich_text[0].text.content, "牡丹花下");
  assert.deepEqual(patch["旨趣"].multi_select.map((item) => item.name), ["剧情"]);
  assert.equal(patch["外部类型原文"].rich_text[0].text.content, "剧情 / 奇怪类型");
  assert.equal(patch["未映射类型"].rich_text[0].text.content, "奇怪类型");
  assert.equal(patch["Runtime Minutes"].number, 93);
  assert.equal(patch.Directors.rich_text[0].text.content, "索菲亚·科波拉");
  assert.equal(patch.Writers.rich_text[0].text.content, "索菲亚·科波拉 / 托马斯·卡利南");
  assert.equal(patch.Cast.rich_text[0].text.content, "科林·法瑞尔 / 妮可·基德曼");
  assert.equal(patch["Production Companies"].rich_text[0].text.content, "American Zoetrope / FR Productions");
  assert.equal(patch.Distributors.rich_text[0].text.content, "Focus Features（美国院线）");
  assert.equal(patch.Studios.rich_text[0].text.content, "American Zoetrope");
  assert.equal(patch["Match Status"].select.name, "candidate");
  assert.equal(patch["Metadata Status"].select.name, "partial");
  assert.deepEqual(patch["Metadata Source"].multi_select.map((item) => item.name), ["douban"]);
  assert.equal(patch["Metadata Confidence"].number, 0.9);
  assert.equal(patch["Needs Review"].checkbox, true);
  assert.equal(patch["Metadata Updated At"].date.start, "2026-07-07");
});

test("buildPatch records an AI check without changing metadata update time", () => {
  const page = { properties: {
    "Metadata Updated At": { type: "date", date: { start: "2026-06-01" } },
    "Last AI Check Time": emptyProperty("date")
  } };

  const patch = buildPatch(page, {}, undefined, undefined, { now: "2026-07-07" });

  assert.deepEqual(patch["Last AI Check Time"], { date: { start: "2026-07-07" } });
  assert.equal(Object.hasOwn(patch, "Metadata Updated At"), false);
});

test("review-only metadata changes do not advance Metadata Updated At", () => {
  const page = { properties: {
    "Metadata Updated At": { type: "date", date: { start: "2026-06-01" } },
    "Last AI Check Time": emptyProperty("date"),
    "Needs Review": { type: "checkbox", checkbox: false }
  } };

  const patch = buildPatch(page, { warnings: ["Needs manual review"] }, undefined, undefined, { now: "2026-07-07" });

  assert.equal(patch["Needs Review"].checkbox, true);
  assert.deepEqual(patch["Last AI Check Time"], { date: { start: "2026-07-07" } });
  assert.equal(Object.hasOwn(patch, "Metadata Updated At"), false);
});

test("buildPatch maps Douban documentary genre to the catalog option", () => {
  const patch = buildPatch(
    pageWithProperties(),
    { genres: ["纪录片"] },
    undefined,
    undefined,
    { now: "2026-08-28" }
  );

  assert.deepEqual(patch["旨趣"].multi_select.map((item) => item.name), ["记录"]);
  assert.equal(patch["未映射类型"], undefined);
});

test("buildPatch maps noir genre labels to the catalog black genre", () => {
  const patch = buildPatch(pageWithProperties(), {
    genres: ["悬疑", "惊悚", "黑色电影", "Film-Noir"]
  });
  assert.deepEqual(patch["旨趣"].multi_select.map((item) => item.name), ["悬疑", "惊悚", "黑色"]);
  assert.equal(patch["未映射类型"], undefined);
});

test("forceDoubanFields replaces legacy non-Douban description and basic info", () => {
  const page = pageWithProperties({
    "简介": filledRichText("Legacy OMDb English plot"),
    "基本信息": filledRichText("Legacy OMDb fields")
  });
  const metadata = {
    metadataSource: "douban",
    description: "豆瓣中文简介",
    basicInfo: "导演：豆瓣导演"
  };
  const patch = buildPatch(page, metadata, undefined, undefined, { forceDoubanFields: true });
  assert.equal(patch["简介"].rich_text[0].text.content, "豆瓣中文简介");
  assert.equal(patch["基本信息"].rich_text[0].text.content, "导演：豆瓣导演");
});

test("buildPatch uses the verified Douban display title instead of subtitle-bearing fields", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "银河英雄传说 我的征途是星辰大海 銀河英雄伝説 わが征くは星の大海 (1988)", text: { content: "银河英雄传说 我的征途是星辰大海 銀河英雄伝説 わが征くは星の大海 (1988)" } }] },
      "Simplified Chinese Title": filledRichText("银河英雄传说 我的征途是星辰大海"),
      "Original Title": filledRichText("銀河英雄伝説 わが征くは星の大海"),
      "Release Year": { type: "number", number: 1988 }
    }),
    {
      subjectId: "1684322",
      doubanDisplayTitle: "银河英雄传说 銀河英雄伝説",
      releaseYear: 1988
    },
    undefined,
    undefined,
    { now: "2026-07-13" }
  );

  assert.equal(patch.Title.title[0].text.content, "银河英雄传说 銀河英雄伝説 (1988)");
});

test("buildPatch decodes HTML entities in verified Douban display titles", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "马达加斯加3 Madagascar 3: Europe&#39;s Most Wanted (2012)", text: { content: "马达加斯加3 Madagascar 3: Europe&#39;s Most Wanted (2012)" } }] },
      "Release Year": { type: "number", number: 2012 }
    }),
    { subjectId: "3178770", doubanDisplayTitle: "马达加斯加3 Madagascar 3: Europe&#39;s Most Wanted", releaseYear: 2012 },
    undefined,
    undefined,
    { now: "2026-07-20" }
  );
  assert.equal(patch.Title.title[0].text.content, "马达加斯加3 Madagascar 3: Europe's Most Wanted (2012)");
});

test("buildPatch preserves a season page label when Douban returns the series title", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "疯狂动物城+ 第一季 Zootopia+ (2022)", text: { content: "疯狂动物城+ 第一季 Zootopia+ (2022)" } }] },
      "Simplified Chinese Title": filledRichText("疯狂动物城+"),
      "English Title": filledRichText("Zootopia+"),
      "Release Year": { type: "number", number: 2022 }
    }),
    { subjectId: "35284242", doubanDisplayTitle: "疯狂动物城+ Zootopia+", releaseYear: 2022 },
    undefined,
    undefined,
    { now: "2026-07-20" }
  );

  assert.equal(patch.Title, undefined);
});

test("buildPatch preserves a title-ending number that differs from the release year", () => {
  const patch = buildPatch(pageWithProperties({
    Title: { type: "title", title: [{ plain_text: "请回答1988 응答하라 (2015)" }] },
    "Release Year": { type: "number", number: 2015 },
    "Simplified Chinese Title": filledRichText("请回答1988"),
    "English Title": filledRichText("Reply 1988"),
    "IMDb ID": filledRichText("tt5182866")
  }), { subjectId: "26302614", doubanDisplayTitle: "请回答1988 응答하라 1988", releaseYear: "2015" }, undefined, undefined, { now: "2026-08-01" });
  assert.equal(patch.Title.title[0].text.content, "请回答1988 응答하라 1988 (2015)");
});

test("buildPatch places a preserved season label before a Japanese original title", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: {
        type: "title",
        title: [{
          plain_text: "JOJO的奇妙冒险 不灭钻石 第一季 Diamond Is Unbreakable Season 1 (2016)",
          text: { content: "JOJO的奇妙冒险 不灭钻石 第一季 Diamond Is Unbreakable Season 1 (2016)" }
        }]
      },
      "Release Year": { type: "number", number: 2016 },
      "Simplified Chinese Title": filledRichText("JOJO的奇妙冒险 不灭钻石"),
      "Original Title": filledRichText("ジョジョの奇妙な冒険 ダイヤモンドは砕けない"),
      "Douban Subject ID": filledRichText("26650051")
    }),
    {
      subjectId: "26650051",
      doubanDisplayTitle: "JOJO的奇妙冒险 不灭钻石 ジョジョの奇妙な冒険 ダイヤモンドは砕けない",
      releaseYear: 2016
    },
    undefined,
    undefined,
    { now: "2026-07-26" }
  );

  assert.equal(
    patch.Title.title[0].text.content,
    "JOJO的奇妙冒险 不灭钻石 第一季 ジョジョの奇妙な冒険 ダイヤモンドは砕けない (2016)"
  );
});

test("buildPatch does not overwrite existing human-filled structured fields", () => {
  const patch = buildPatch(
    pageWithProperties({
      Directors: filledRichText("已有导演"),
      Countries: { type: "multi_select", multi_select: [{ name: "已有国家" }] },
      "Traditional Chinese Title (Taiwan)": filledRichText("已有台译"),
      "Runtime Minutes": { type: "number", number: 101 },
      "Metadata Source": { type: "multi_select", multi_select: [{ name: "manual" }] },
      "IMDb URL": { type: "url", url: "https://www.imdb.com/title/tt0066819/" },
      "Douban URL": { type: "url", url: "https://movie.douban.com/subject/1295702/" },
      "Poster URL": { type: "url", url: "https://img.example/poster.jpg" }
    }),
    {
      subjectId: "1295702",
      subjectUrl: "https://movie.douban.com/subject/1295702/",
      posterUrl: "https://img.example/poster.jpg",
      imdbId: "tt0066819",
      releaseYear: 1971,
      releaseDate: "1971-03-31",
      genres: ["剧情"],
      countries: ["美国"],
      regionalTitles: {
        taiwan: "受骗"
      },
      runtimeMinutes: 105,
      directors: ["唐·希格尔"],
      description: "南北战争背景故事。",
      basicInfo: "导演：唐·希格尔"
    },
    undefined,
    undefined,
    { now: "2026-07-07" }
  );

  assert.equal(patch.Directors, undefined);
  assert.equal(patch.Countries, undefined);
  assert.equal(patch["Traditional Chinese Title (Taiwan)"], undefined);
  assert.equal(patch["Runtime Minutes"], undefined);
  assert.equal(patch["IMDb URL"], undefined);
  assert.equal(patch["Douban URL"], undefined);
  assert.equal(patch["Poster URL"], undefined);
  assert.deepEqual(patch["Metadata Source"].multi_select.map((item) => item.name), ["manual", "douban"]);
});

test("preferredDoubanSubjectId uses existing page identity before title search", () => {
  const pageId = "39620ac1-2f0a-81e9-8469-e319231fc1b0";
  const subjectId = preferredDoubanSubjectId(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "牡丹花下 The Beguiled (1971)", text: { content: "牡丹花下 The Beguiled (1971)" } }] },
      "Douban Subject ID": filledRichText("1295702")
    }).properties,
    pageId,
    { doubanSubjects: new Map() }
  );

  assert.equal(subjectId, "1295702");
});

test("preferredDoubanSubjectId allows explicit CLI subject override", () => {
  const pageId = "39620ac1-2f0a-81e9-8469-e319231fc1b0";
  const subjectId = preferredDoubanSubjectId(
    pageWithProperties({
      "Douban Subject ID": filledRichText("1295702")
    }).properties,
    pageId,
    { doubanSubjects: new Map([[pageId, "26761325"]]) }
  );

  assert.equal(subjectId, "26761325");
});

test("candidateYearConflict rejects same-title Douban candidates from another year", () => {
  assert.equal(candidateYearConflict("1974", [{ id: "26336757", title: "Deadly Weapons", year: "1994" }]), true);
  assert.equal(candidateYearConflict("1974", [{ id: "x", title: "Deadly Weapons", year: "1974" }]), false);
});

test("metadataIdentityConflict uses the title year when Release Year is empty", () => {
  const conflict = metadataIdentityConflict(
    {},
    { imdbId: "tt1034303", releaseYear: "2008" },
    { title: "太空堡垒卡拉狄加：反抗军 Battlestar Galactica: The Resistance (2006)" }
  );

  assert.deepEqual(conflict, { field: "Release Year", expected: "2006", actual: "2008" });
});

test("metadataIdentityConflict rejects a candidate that disagrees with an existing IMDb ID", () => {
  const conflict = metadataIdentityConflict(
    { "IMDb ID": filledRichText("tt0069952"), "Release Year": { type: "number", number: 1974 } },
    { imdbId: "tt0129027", releaseYear: "1994" }
  );
  assert.deepEqual(conflict, { field: "IMDb ID", expected: "tt0069952", actual: "tt0129027" });
});

test("existingImdbIdentity exposes conflicting structured and legacy IMDb fields", () => {
  const identity = existingImdbIdentity({
    "IMDb ID": filledRichText("tt2359704"),
    imdb: filledRichText("tt3700148")
  });

  assert.deepEqual(identity, {
    structuredImdbId: "tt2359704",
    legacyImdbId: "tt3700148",
    effectiveImdbId: "tt2359704",
    conflict: {
      field: "IMDb ID/imdb",
      expected: "tt2359704",
      actual: "tt3700148",
      reason: "existing_fields_disagree"
    }
  });
});

test("metadata backfill cannot silently build a patch across conflicting existing IMDb fields", () => {
  const page = pageWithProperties({
    "IMDb ID": filledRichText("tt2359704"),
    imdb: filledRichText("tt3700148")
  });

  assert.deepEqual(
    metadataIdentityConflict(page.properties, { imdbId: "tt2359704" }),
    {
      field: "IMDb ID/imdb",
      expected: "tt2359704",
      actual: "tt3700148",
      reason: "existing_fields_disagree"
    }
  );
  assert.throws(
    () => buildPatch(page, { imdbId: "tt2359704" }, undefined, undefined, {}),
    /IMDb ID and imdb disagree/u
  );
});

test("matching structured and legacy IMDb fields remain usable", () => {
  const identity = existingImdbIdentity({
    "IMDb ID": filledRichText("TT2359704"),
    imdb: filledRichText("tt2359704")
  });

  assert.equal(identity.conflict, null);
  assert.equal(identity.effectiveImdbId, "tt2359704");
});

test("metadataIdentityConflict preserves a verified series IMDb ID on season pages", () => {
  const conflict = metadataIdentityConflict(
    { "IMDb ID": filledRichText("tt0141842"), "Release Year": { type: "number", number: 2000 } },
    { imdbId: "tt0705250", releaseYear: 2000 },
    { title: "黑道家族 第二季 The Sopranos Season 2 (2000)" }
  );

  assert.equal(conflict, null);
});

test("metadataIdentityConflict allows regional release-year differences for the same IMDb work", () => {
  const conflict = metadataIdentityConflict(
    { "IMDb ID": filledRichText("tt0124595"), "Release Year": { type: "number", number: 1998 } },
    { imdbId: "tt0124595", releaseYear: 1999 }
  );

  assert.equal(conflict, null);
});

test("buildPatch uses the existing verified IMDb ID for a season URL", () => {
  const patch = buildPatch(
    pageWithProperties({
      "IMDb ID": filledRichText("tt0141842"),
      "IMDb URL": { type: "url", url: "https://www.imdb.com/title/tt0705250/" }
    }),
    { imdbId: "tt0705250" },
    undefined,
    undefined,
    { now: "2026-08-11" }
  );

  assert.equal(patch["IMDb URL"].url, "https://www.imdb.com/title/tt0141842/");
});

test("parseInfoPairs handles compact Douban info labels", () => {
  const pairs = parseInfoPairs("导演: 索菲亚·科波拉编剧: 索菲亚·科波拉 / 托马斯·卡利南主演: 科林·法瑞尔 / 妮可·基德曼类型: 剧情制片国家/地区: 美国语言: 英语 / 法语上映日期: 2017-05-24(戛纳电影节)片长: 93分钟IMDb: tt5592248");

  assert.equal(pairs["导演"], "索菲亚·科波拉");
  assert.equal(pairs["编剧"], "索菲亚·科波拉 / 托马斯·卡利南");
  assert.equal(pairs["主演"], "科林·法瑞尔 / 妮可·基德曼");
  assert.equal(pairs["制片国家/地区"], "美国");
  assert.equal(pairs["语言"], "英语 / 法语");
  assert.equal(pairs.IMDb, "tt5592248");
});

test("buildPatch fills regional traditional Chinese titles from source aliases", () => {
  const patch = buildPatch(
    pageWithProperties(),
    {
      subjectId: "26761325",
      subjectUrl: "https://movie.douban.com/subject/26761325/",
      genres: ["剧情"],
      regionalTitles: {
        taiwan: "魅惑"
      },
      description: "美国内战期间的寄宿女校故事。",
      basicInfo: "又名：魅惑(台) / 受骗"
    },
    undefined,
    undefined,
    { now: "2026-07-07" }
  );

  assert.equal(patch["Traditional Chinese Title (Taiwan)"].rich_text[0].text.content, "魅惑");
  assert.equal(patch["Traditional Chinese Title (Hong Kong)"], undefined);
});

test("buildPatch maps common Chinese source genres into canonical genre fields", () => {
  const patch = buildPatch(
    pageWithProperties(),
    {
      subjectId: "1294417",
      subjectUrl: "https://movie.douban.com/subject/1294417/",
      genres: ["剧情", "爱情", "武侠", "古装"],
      externalGenreText: "剧情 / 爱情 / 武侠 / 古装"
    },
    undefined,
    undefined,
    { now: "2026-07-07" }
  );

  assert.deepEqual(patch["旨趣"].multi_select.map((item) => item.name), ["剧情", "浪漫", "武侠", "古装"]);
  assert.equal(patch["外部类型原文"].rich_text[0].text.content, "剧情 / 爱情 / 武侠 / 古装");
  assert.equal(patch["未映射类型"], undefined);
  assert.equal(patch["Needs Review"], undefined);
});

test("buildPatch promotes draft metadata status after sourced Douban match", () => {
  const patch = buildPatch(
    pageWithProperties({
      "Metadata Status": { type: "select", select: { name: "draft" } },
      "Metadata Confidence": { type: "number", number: 0.3 }
    }),
    {
      subjectId: "1306564",
      subjectUrl: "https://movie.douban.com/subject/1306564/",
      genres: ["剧情"]
    },
    undefined,
    undefined,
    { now: "2026-07-07" }
  );

  assert.equal(patch["Metadata Status"].select.name, "partial");
  assert.equal(patch["Metadata Confidence"].number, 0.9);
});

test("buildPatch accepts verified year precision when the source has no exact release date", () => {
  const page = pageWithProperties({
    "Simplified Chinese Title": filledRichText("赫尔佐格吃他的鞋"),
    "Release Year": { type: "number", number: 1980 },
    "上映日期": { type: "date", date: null },
    Countries: { type: "multi_select", multi_select: [{ name: "美国" }] },
    Languages: { type: "multi_select", multi_select: [{ name: "英语" }] },
    "旨趣": { type: "multi_select", multi_select: [{ name: "记录" }, { name: "短片" }] },
    "外部类型原文": filledRichText("纪录片 / 短片"),
    "Runtime Minutes": { type: "number", number: 20 },
    Directors: filledRichText("莱斯·布兰克"),
    Cast: filledRichText("沃纳·赫尔佐格"),
    "Poster URL": { type: "url", url: "https://img.example/poster.jpg" },
    "AI建议最低年龄": { type: "number", number: 12 },
    "AI年龄建议置信度": { type: "select", select: { name: "high" } },
    "内容风险标签": { type: "multi_select", multi_select: [{ name: "儿童友好" }] },
    "AI年龄建议理由": filledRichText("需要理解行为的表演性。"),
    "IMDb ID": filledRichText("tt0081746"),
    "Douban Subject ID": filledRichText("1434233"),
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Needs Review": { type: "checkbox", checkbox: true },
    "Human Issue": filledRichText(""),
    "AI Issue": filledRichText("")
  });
  const patch = buildPatch(page, {
    subjectId: "1434233",
    releaseDate: undefined,
    genres: [],
    unmappedGenres: [],
    warnings: []
  }, undefined, undefined, { now: "2026-08-28", preserveExistingIdentity: true });
  assert.equal(patch["Metadata Status"].select.name, "verified");
  assert.equal(patch["Needs Review"].checkbox, false);
  assert.equal(patch["上映日期"], undefined);
});

test("buildPatch promotes a complete legacy partial page to verified", () => {
  const patch = buildPatch(
    pageWithProperties({
      "Simplified Chinese Title": filledRichText("示例"),
      "Release Year": { type: "number", number: 2000 },
      "上映日期": { type: "date", date: { start: "2000-01-01" } },
      Countries: { type: "multi_select", multi_select: [{ name: "美国" }] },
      Languages: { type: "multi_select", multi_select: [{ name: "英语" }] },
      "旨趣": { type: "multi_select", multi_select: [{ name: "剧情" }] },
      "外部类型原文": filledRichText("剧情"),
      "Runtime Minutes": { type: "number", number: 100 },
      Directors: filledRichText("导演"),
      Cast: filledRichText("演员"),
      "Poster URL": { type: "url", url: "https://img.example/poster.jpg" },
      "AI建议最低年龄": { type: "number", number: 12 },
      "AI年龄建议置信度": { type: "select", select: { name: "high" } },
      "内容风险标签": { type: "multi_select", multi_select: [{ name: "无" }] },
      "AI年龄建议理由": filledRichText("无明显风险"),
      "IMDb ID": filledRichText("tt0000001"),
      "Metadata Status": { type: "select", select: { name: "partial" } },
      "Needs Review": { type: "checkbox", checkbox: true },
      "Human Issue": filledRichText(""),
      "AI Issue": filledRichText("")
    }),
    {
      subjectId: "26761325",
      subjectUrl: "https://movie.douban.com/subject/26761325/",
      posterUrl: "https://img.example/poster.jpg",
      releaseYear: 2000,
      releaseDate: "2000-01-01",
      genres: ["剧情"],
      imdbId: "tt0000001",
      countries: ["美国"],
      languages: ["英语"],
      runtimeMinutes: 100,
      directors: ["导演"],
      cast: ["演员"],
      description: "简介",
      basicInfo: "基本信息"
    },
    undefined,
    { now: "2026-08-26" }
  );

  assert.equal(patch["Metadata Status"].select.name, "verified");
  assert.equal(patch["Needs Review"].checkbox, false);
});

test("buildPatch verifies metadata when the same patch fills the last core field", () => {
  const page = pageWithProperties({
    "Simplified Chinese Title": filledRichText("示例"),
    "Release Year": { type: "number", number: 2000 },
    "上映日期": { type: "date", date: { start: "2000-01-01" } },
    Countries: { type: "multi_select", multi_select: [{ name: "美国" }] },
    Languages: { type: "multi_select", multi_select: [{ name: "英语" }] },
    "旨趣": { type: "multi_select", multi_select: [{ name: "剧情" }] },
    "外部类型原文": emptyProperty("rich_text"),
    "Runtime Minutes": { type: "number", number: 100 },
    Directors: filledRichText("导演"),
    Cast: filledRichText("演员"),
    "Poster URL": { type: "url", url: "https://img.example/poster.jpg" },
    "AI建议最低年龄": { type: "number", number: 12 },
    "AI年龄建议置信度": { type: "select", select: { name: "high" } },
    "内容风险标签": { type: "multi_select", multi_select: [{ name: "无" }] },
    "AI年龄建议理由": filledRichText("无明显风险"),
    "IMDb ID": filledRichText("tt0000001"),
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Needs Review": { type: "checkbox", checkbox: false },
    "Human Issue": filledRichText(""),
    "AI Issue": filledRichText("")
  });

  const patch = buildPatch(page, {
    subjectId: "26761325",
    externalGenreText: "剧情",
    genres: ["剧情"],
    unmappedGenres: [],
    warnings: []
  }, undefined, undefined, { now: "2026-08-28" });

  assert.equal(patch["外部类型原文"].rich_text[0].text.content, "剧情");
  assert.equal(patch["Metadata Status"].select.name, "verified");
  assert.equal(patch["Needs Review"].checkbox, false);
});

test("buildPatch appends newly canonical genres and clears resolved unmapped genres", () => {
  const patch = buildPatch(
    pageWithProperties({
      "旨趣": { type: "multi_select", multi_select: [{ name: "动作" }] },
      "未映射类型": filledRichText("爱情 / 武侠 / 古装")
    }),
    {
      subjectId: "1394324",
      subjectUrl: "https://movie.douban.com/subject/1394324/",
      genres: ["动作", "爱情", "武侠", "古装"]
    },
    undefined,
    undefined,
    { now: "2026-07-07" }
  );

  assert.deepEqual(patch["旨趣"].multi_select.map((item) => item.name), ["动作", "浪漫", "武侠", "古装"]);
  assert.deepEqual(patch["未映射类型"], { rich_text: [] });
});

test("buildPatch repairs a Chinese-only work title from verified structured identity", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "走走停停 (2024)", text: { content: "走走停停 (2024)" } }] },
      "Simplified Chinese Title": filledRichText("走走停停"),
      "English Title": filledRichText("G for Gap"),
      "Release Year": { type: "number", number: 2024 }
    }),
    { subjectId: "36712987", releaseYear: 2024 },
    undefined,
    undefined,
    { now: "2026-07-12" }
  );

  assert.equal(patch.Title.title[0].text.content, "走走停停 G for Gap (2024)");
});

test("buildPatch repairs an English-only title and preserves a season identity", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "Better Call Saul Season 1 (2015)", text: { content: "Better Call Saul Season 1 (2015)" } }] },
      "Simplified Chinese Title": filledRichText("风骚律师 第一季"),
      "English Title": filledRichText("Better Call Saul Season 1"),
      "Release Year": { type: "number", number: 2015 }
    }),
    { subjectId: "26387813", releaseYear: 2015 },
    undefined,
    undefined,
    { now: "2026-07-12" }
  );

  assert.equal(patch.Title.title[0].text.content, "风骚律师 第一季 Better Call Saul Season 1 (2015)");
});

test("buildPatch does not overwrite a complete conflicting title", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: { type: "title", title: [{ plain_text: "狗镇 Dogville (2003)", text: { content: "狗镇 Dogville (2003)" } }] },
      "Simplified Chinese Title": filledRichText("狗阵"),
      "English Title": filledRichText("Black Dog"),
      "Release Year": { type: "number", number: 2024 }
    }),
    { subjectId: "35242872", releaseYear: 2024 },
    undefined,
    undefined,
    { now: "2026-07-12" }
  );

  assert.equal(patch.Title, undefined);
  assert.equal(patch["Needs Review"].checkbox, true);
});

test("OMDb supplemental metadata cannot rewrite an established canonical title", () => {
  const patch = buildPatch(
    pageWithProperties({
      Title: {
        type: "title",
        title: [{
          plain_text: "圣斗士星矢 黄金魂 -soul of gold- 聖闘士星矢 黄金魂 -soul of gold- (2015)",
          text: { content: "圣斗士星矢 黄金魂 -soul of gold- 聖闘士星矢 黄金魂 -soul of gold- (2015)" }
        }]
      },
      "Simplified Chinese Title": filledRichText("圣斗士星矢 黄金魂 -soul of gold-"),
      "English Title": filledRichText("Saint Seiya Soul of Gold"),
      "Original Title": filledRichText("聖闘士星矢 黄金魂 -soul of gold-"),
      "Release Year": { type: "number", number: 2015 }
    }),
    { metadataSource: "omdb", imdbId: "tt4670988", releaseYear: 2015 },
    undefined,
    undefined,
    { now: "2026-08-28" }
  );

  assert.equal(patch.Title, undefined);
});
