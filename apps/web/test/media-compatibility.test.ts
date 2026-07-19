import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import {
  normalizeVideoCodec,
  variantVideoCodec,
  videoCompatibility
} from "../src/cinema/media-compatibility.ts";

test("normalizes the codec families used by Media Assets", () => {
  assert.equal(normalizeVideoCodec("H.265"), "hevc");
  assert.equal(normalizeVideoCodec("x265"), "hevc");
  assert.equal(normalizeVideoCodec("AVC"), "h264");
});

test("finds the selected variant codec", () => {
  const result = {
    assetKey: "work",
    title: "Example",
    source: "test",
    sourceUrl: "https://example.test",
    durationLabel: "1:00",
    updatedAt: "2026-07-19",
    summary: "",
    variants: [{
      assetKey: "work-hevc",
      label: "HEVC",
      sourceUrl: "https://example.test/video.mp4",
      kind: "file",
      summary: "",
      metadata: { videoCodec: "hevc" }
    }]
  } satisfies SearchResult;

  assert.equal(variantVideoCodec(result, "work-hevc"), "hevc");
});

test("blocks HEVC only when the browser explicitly reports no matching decoder", () => {
  assert.equal(videoCompatibility("hevc", () => "").status, "unsupported");
  assert.equal(videoCompatibility("hevc", (mimeType) => mimeType.includes("hvc1") ? "probably" : "").status, "supported");
  assert.equal(videoCompatibility(undefined, () => "").status, "unknown");
});
