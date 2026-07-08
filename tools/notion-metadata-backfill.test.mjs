import assert from "node:assert/strict";
import test from "node:test";

import { buildPatch, parseInfoPairs, preferredDoubanSubjectId } from "./notion-metadata-backfill.mjs";

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
