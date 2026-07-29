import assert from "node:assert/strict";
import test from "node:test";
import type { CacheAsset } from "@wwpdw/shared";
import { mergePreparedLineAssets } from "./playback-lines";

function asset(assetKey: string, line: "domestic" | "international", status: CacheAsset["status"]): CacheAsset {
  return {
    assetKey,
    title: assetKey,
    source: "test",
    status,
    lastRequestedAt: "2026-07-29T00:00:00.000Z",
    line
  };
}

test("prepared assets from both lines collapse into one entry", () => {
  const merged = mergePreparedLineAssets(
    asset("movie", "domestic", "ready"),
    asset("movie", "international", "ready")
  );

  assert.equal(merged?.assetKey, "movie");
  assert.deepEqual(merged?.preparedLines, ["domestic", "international"]);
});

test("a domestic-only prepared asset remains playable in the unified list", () => {
  const merged = mergePreparedLineAssets(asset("movie", "domestic", "ready"));

  assert.equal(merged?.line, "domestic");
  assert.deepEqual(merged?.preparedLines, ["domestic"]);
});

test("an active preparation can be shown without claiming a playable line", () => {
  const merged = mergePreparedLineAssets(
    asset("movie", "domestic", "downloading"),
    asset("movie", "international", "queued")
  );

  assert.deepEqual(merged?.preparedLines, []);
});
