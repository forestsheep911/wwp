import assert from "node:assert/strict";
import test from "node:test";

import type { MediaVariant } from "@wwpdw/shared";
import {
  completeStructuredMediaAssetVariants,
  doubanSubjectIdFromProperties,
  creditsFromProperties,
  postersFromProperties,
  sortMediaAssetVariants
} from "./notion-source.js";

test("website takes Douban identity only from the maintained field, regardless of prose links", () => {
  const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
  const properties = { "基本信息": rich("https://www.douban.com/personage/27233188/ https://movie.douban.com/subject/35801819/") };
  assert.equal(doubanSubjectIdFromProperties(properties), undefined);
  assert.equal(doubanSubjectIdFromProperties({ ...properties, "Douban Subject ID": rich("35801819") }), "35801819");
  assert.equal(doubanSubjectIdFromProperties({ ...properties, "Douban Subject ID": rich("35801819"), "Douban URL": { type: "url", url: "https://movie.douban.com/subject/1234567/" } }), undefined);
});

function episodeVariant(episodeNumber: number): MediaVariant {
  return {
    assetKey: `episode-${episodeNumber}`,
    label: `Episode ${episodeNumber}`,
    sourceUrl: `https://example.com/${episodeNumber}.mp4`,
    kind: "video",
    summary: "",
    metadata: {
      episodeNumber,
      sourceLabel: "1080p 繁 0.44G"
    }
  };
}

test("Media Assets variants are ordered by episode before applying a display limit", () => {
  const variants = [103, 110, 1, 102, 2].map(episodeVariant);

  assert.deepEqual(
    sortMediaAssetVariants(variants)
      .slice(0, 3)
      .map((variant) => variant.metadata?.episodeNumber),
    [1, 2, 102]
  );
});

test("structured Media Assets keep every episode and specification for large series", () => {
  const variants = Array.from({ length: 456 }, (_, index) => episodeVariant((index % 114) + 1));

  const completed = completeStructuredMediaAssetVariants(variants);

  assert.equal(completed.length, 456);
  assert.equal(completed[0]?.metadata?.episodeNumber, 1);
  assert.equal(completed.at(-1)?.metadata?.episodeNumber, 114);
});

test("only the maintained poster files are read, never Poster URL or page cover", () => {
  const posters = postersFromProperties(
    { cover: { type: "external", external: { url: "https://example.com/wrong-cover.jpg" } } },
    {
      "海报": {
        type: "files",
        files: [{ type: "external", external: { url: "https://example.com/correct-poster.jpg" } }]
      },
      "Poster URL": { type: "url", url: "https://example.com/correct-poster-source.jpg" }
    }
  );

  assert.deepEqual(posters.map((poster) => poster.url), [
    "https://example.com/correct-poster.jpg"
  ]);
  assert.equal(posters[0].origin, "notion-files");
});

test("an absent or empty Notion poster field remains empty despite legacy image sources", () => {
  const page = { cover: { type: "external", external: { url: "https://example.com/cover.jpg" } } };
  const properties = {
    "Poster URL": { type: "url", url: "https://example.com/fallback.jpg" },
    "图片": { type: "files", files: [{ type: "external", external: { url: "https://example.com/still.jpg" } }] },
    "Poster": { type: "rich_text", rich_text: [{ plain_text: "https://example.com/text.jpg" }] }
  };
  assert.deepEqual(postersFromProperties(page, properties), []);
  assert.deepEqual(postersFromProperties(page, { ...properties, 海报: { type: "files", files: [] } }), []);
});

test("OMDb comma-separated directors, writers, and cast become distinct structured credits", () => {
  const richText = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
  const parsed = creditsFromProperties({
    Directors: richText("Ron Howard"),
    Writers: richText("Jim Lovell, Jeffrey Kluger, William Broyles Jr."),
    Cast: richText("Tom Hanks, Bill Paxton, Kevin Bacon")
  });

  assert.deepEqual(parsed.credits.map((credit) => [credit.name, credit.department]), [
    ["Ron Howard", "directing"],
    ["Jim Lovell", "writing"],
    ["Jeffrey Kluger", "writing"],
    ["William Broyles Jr.", "writing"],
    ["Tom Hanks", "acting"],
    ["Bill Paxton", "acting"],
    ["Kevin Bacon", "acting"]
  ]);
});

test("writer role suffixes preserve source authors instead of calling them screenwriters", () => {
  const richText = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
  const parsed = creditsFromProperties({
    Writers: richText("Jane Austen (novel), Emma Thompson (screenplay), Original Name (unknown note)")
  });

  assert.deepEqual(parsed.credits.map((credit) => [credit.name, credit.job]), [
    ["Jane Austen", "Source Author"],
    ["Emma Thompson", "Screenwriter"],
    ["Original Name (unknown note)", "Screenwriter"]
  ]);
});

test("legacy basic info credits seed structured credits when dedicated fields are empty", () => {
  const richText = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
  const parsed = creditsFromProperties({
    "基本信息": richText("导演: 蒂姆·米勒 / 罗伯特·瓦利 编剧: 约翰·斯卡尔齐 / 肉食部门 主演: 诺兰·诺斯 / 艾米丽·奥布莱恩 类型: 动画")
  });

  assert.deepEqual(parsed.credits.map((credit) => [credit.name, credit.department]), [
    ["蒂姆·米勒", "directing"],
    ["罗伯特·瓦利", "directing"],
    ["约翰·斯卡尔齐", "writing"],
    ["肉食部门", "writing"],
    ["诺兰·诺斯", "acting"],
    ["艾米丽·奥布莱恩", "acting"]
  ]);
});
