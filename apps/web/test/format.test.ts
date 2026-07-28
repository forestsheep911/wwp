import assert from "node:assert/strict";
import test from "node:test";

import type { CacheJob, MediaVariant, SearchResult } from "@wwpdw/shared";
import {
  basicInfoLine,
  bestDetailSummary,
  bestSummary,
  groupEpisodeVariantsBySpec,
  jobMessageLabel,
  variantHasSizeMetadata,
  variantSpecLabels,
  variantSpecText
} from "../src/cinema/format";

test("queued preparation jobs show their live queue position", () => {
  const job: CacheJob = {
    id: "job-2",
    assetKey: "film-2",
    title: "第二部影片",
    source: "Notion",
    status: "queued",
    progress: 0,
    message: "Waiting for a cache worker.",
    queuePosition: 2,
    queueLength: 4,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };

  assert.equal(jobMessageLabel(job), "准备排队中 · 第 2 位，共 4 项");
});

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    assetKey: "test-movie",
    title: "测试影片",
    source: "Notion collection",
    sourceUrl: "https://example.local/movie",
    durationLabel: "",
    updatedAt: "2026-07-06T00:00:00.000Z",
    summary: "",
    ...overrides
  };
}

test("bestSummary keeps real metadata descriptions", () => {
  assert.equal(
    bestSummary(result({
      summary: "已整理 3 个可播放规格，可直接选择版本观看。",
      metadata: {
        description: "这是一段真正的影片简介。"
      }
    })),
    "这是一段真正的影片简介。"
  );
});

test("bestSummary hides generated playable-spec summaries when movie metadata is missing", () => {
  assert.equal(
    bestSummary(result({
      summary: "3 playable specs found in this movie entry"
    })),
    "暂无影片简介"
  );

  assert.equal(
    bestDetailSummary(result({
      summary: "已整理 3 个可播放规格，可直接选择版本观看。"
    })),
    "暂无影片简介"
  );
});

test("bestSummary ignores metadata status labels and falls back to a real plot", () => {
  assert.equal(
    bestSummary(result({
      summary: "已整理 3 个可播放规格，可直接选择版本观看。",
      metadata: {
        info: "partial",
        external: {
          omdb: {
            source: "omdb",
            fetchedAt: "2026-07-06T00:00:00.000Z",
            plot: "A real plot from a metadata provider."
          }
        }
      }
    })),
    "A real plot from a metadata provider."
  );
});

test("basicInfoLine hides long slash-separated cast dumps", () => {
  assert.equal(
    basicInfoLine(result({
      metadata: {
        description: "一段真正的影片简介。",
        info: "安德鲁·加菲尔德 / 克莱尔·芙伊 / 妮可拉·考夫兰 / 杰西卡·古宁 / 朗可卡·莎格蕾 / 依莱·阿诺斯 / 珍妮弗·穆德 / 菲尼克斯·拉罗什 / 马克·希普 / 达斯汀·德姆瑞·伯恩斯"
      }
    })),
    ""
  );
});

test("variantSpecLabels formats Media Assets metadata as structured tags", () => {
  const variant: MediaVariant = {
    assetKey: "media-assets-elio-1080p",
    label: "地球特派员 简英 1.72GB",
    sourceUrl: "https://example.local/elio.mp4",
    kind: "file",
    summary: "Structured Media Assets row.",
    metadata: {
      structuredSource: "media_assets",
      resolution: "1080p",
      videoCodec: "HEVC",
      container: "mp4",
      approximateSizeGb: 1.72,
      subtitleLanguages: ["zh-Hans", "en"],
      sourceLineage: ["encode"]
    }
  };

  assert.deepEqual(variantSpecLabels(variant), [
    "简英",
    "1.72G"
  ]);
  assert.equal(variantSpecText("地球特派员 Elio (2025)", variant), "简英 / 1.72G");
  assert.equal(variantHasSizeMetadata(variant), true);
});

test("variantSpecText falls back to cleaned labels without structured metadata", () => {
  const variant: MediaVariant = {
    assetKey: "legacy-elio",
    label: "地球特派员 简英 1.72GB",
    sourceUrl: "https://example.local/elio.mp4",
    kind: "file",
    summary: "Legacy page variant."
  };

  assert.deepEqual(variantSpecLabels(variant), []);
  assert.equal(variantSpecText("地球特派员 Elio (2025)", variant), "简英 1.72GB");
  assert.equal(variantHasSizeMetadata(variant), false);
});

test("variantSpecText shows a collection episode range", () => {
  const variant: MediaVariant = {
    assetKey: "collection-01-05",
    label: "剧集合集 / Episode 01-05",
    sourceUrl: "https://example.local/collection-01-05.mp4",
    kind: "file",
    summary: "Structured Media Assets row.",
    metadata: {
      structuredSource: "media_assets",
      episodeNumber: 1,
      episodeEndNumber: 5,
      subtitleLanguages: ["zh-Hans"],
      approximateSizeGb: 4.82
    }
  };

  assert.equal(variantSpecText("剧集", variant), "第1-5集 / 简 / 4.82G");
});

test("groupEpisodeVariantsBySpec keeps each spec together and orders its episodes", () => {
  const variants: MediaVariant[] = [
    {
      assetKey: "small-episode-2",
      label: "检察官的提案 第一季 繁 0.35GB / Episode 02",
      sourceUrl: "https://example.local/small-2.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["检察官的提案 第一季", "检察官的提案 第一季 繁 0.35GB"],
      metadata: { structuredSource: "media_assets", episodeNumber: 2, resolution: "1080p", subtitleLanguages: ["zh-Hant"], approximateSizeGb: 0.35 }
    },
    {
      assetKey: "full-episode-1",
      label: "检察官的提案 第一季 繁 1080p / Episode 01",
      sourceUrl: "https://example.local/full-1.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["检察官的提案 第一季", "检察官的提案 第一季 繁 1080p"],
      metadata: { structuredSource: "media_assets", episodeNumber: 1, resolution: "1080p", subtitleLanguages: ["zh-Hant"], approximateSizeGb: 1.04 }
    },
    {
      assetKey: "small-episode-1",
      label: "检察官的提案 第一季 繁 0.35GB / Episode 01",
      sourceUrl: "https://example.local/small-1.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["检察官的提案 第一季", "检察官的提案 第一季 繁 0.35GB"],
      metadata: { structuredSource: "media_assets", episodeNumber: 1, resolution: "1080p", subtitleLanguages: ["zh-Hant"], approximateSizeGb: 0.35 }
    },
    {
      assetKey: "full-episode-2",
      label: "检察官的提案 第一季 繁 1080p / Episode 02",
      sourceUrl: "https://example.local/full-2.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["检察官的提案 第一季", "检察官的提案 第一季 繁 1080p"],
      metadata: { structuredSource: "media_assets", episodeNumber: 2, resolution: "1080p", subtitleLanguages: ["zh-Hant"], approximateSizeGb: 1.08 }
    }
  ];

  assert.deepEqual(
    groupEpisodeVariantsBySpec("检察官的提案 第一季", variants).map((group) => ({
      labels: group.labels,
      episodes: group.variants.map((variant) => variant.metadata?.episodeNumber)
    })),
    [
      { labels: ["繁", "1080p"], episodes: [1, 2] },
      { labels: ["繁", "0.35G"], episodes: [1, 2] }
    ]
  );
});

test("groupEpisodeVariantsBySpec counts and labels collection coverage", () => {
  const variants: MediaVariant[] = [
    {
      assetKey: "collection-1",
      label: "剧集 简 4.8GB/合集 / Episode 01-05",
      sourceUrl: "https://example.local/1.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["剧集", "剧集 简 4.8GB/合集"],
      metadata: { episodeNumber: 1, episodeEndNumber: 5, subtitleLanguages: ["zh-Hans"] }
    },
    {
      assetKey: "collection-2",
      label: "剧集 简 4.7GB/合集 / Episode 06-10",
      sourceUrl: "https://example.local/2.mp4",
      kind: "file",
      summary: "Structured Media Assets row.",
      sourceBreadcrumb: ["剧集", "剧集 简 4.8GB/合集"],
      metadata: { episodeNumber: 6, episodeEndNumber: 10, subtitleLanguages: ["zh-Hans"] }
    }
  ];

  const [group] = groupEpisodeVariantsBySpec("剧集", variants);
  assert.equal(group.episodeCount, 10);
  assert.equal(group.rangeLabel, "第1-10集");
});
