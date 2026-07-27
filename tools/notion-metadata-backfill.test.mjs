import assert from "node:assert/strict";
import test from "node:test";

import { buildPatch, fetchImdbRating, parseInfoPairs, preferredDoubanSubjectId } from "./notion-metadata-backfill.mjs";

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
  assert.equal(patch["Match Status"].select.name, "candidate");
  assert.equal(patch["Metadata Status"].select.name, "partial");
  assert.deepEqual(patch["Metadata Source"].multi_select.map((item) => item.name), ["douban"]);
  assert.equal(patch["Metadata Confidence"].number, 0.9);
  assert.equal(patch["Needs Review"].checkbox, true);
  assert.equal(patch["Metadata Updated At"].date.start, "2026-07-07");
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
