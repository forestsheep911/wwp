import assert from "node:assert/strict";
import test from "node:test";

import type { SearchResult } from "@wwpdw/shared";
import { bestDetailSummary, bestSummary } from "../src/cinema/format";

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
