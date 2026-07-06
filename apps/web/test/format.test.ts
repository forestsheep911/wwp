import assert from "node:assert/strict";
import test from "node:test";

import type { MediaVariant, SearchResult } from "@wwpdw/shared";
import {
  bestDetailSummary,
  bestSummary,
  variantHasSizeMetadata,
  variantSpecLabels,
  variantSpecText
} from "../src/cinema/format";

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
    "1080P",
    "HEVC",
    "MP4",
    "1.72GB",
    "字幕 简中 / 英语",
    "压制版"
  ]);
  assert.equal(variantSpecText("地球特派员 Elio (2025)", variant), "1080P / HEVC / MP4 / 1.72GB / 字幕 简中 / 英语 / 压制版");
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
