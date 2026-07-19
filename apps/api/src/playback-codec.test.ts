import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";

import { inferVideoCodec, videoCodecForAsset } from "./playback-codec.js";

const result = {
  assetKey: "movie",
  title: "Movie",
  source: "Notion",
  sourceUrl: "https://example.test/movie.mp4",
  durationLabel: "--",
  updatedAt: "2026-07-20T00:00:00.000Z",
  summary: "",
  variants: [{
    assetKey: "movie-hevc",
    label: "720p HEVC",
    sourceUrl: "https://example.test/movie-hevc.mp4",
    kind: "file",
    summary: "",
    metadata: { videoCodec: "hevc" }
  }]
} satisfies SearchResult;

test("videoCodecForAsset resolves a nested variant codec", () => {
  assert.equal(videoCodecForAsset([result], "movie-hevc"), "hevc");
});

test("videoCodecForAsset resolves the only variant for a variant-shaped result", () => {
  assert.equal(
    videoCodecForAsset([{ ...result, assetKey: "movie-hevc" }], "movie-hevc"),
    "hevc"
  );
});

test("videoCodecForAsset returns undefined when metadata has no codec", () => {
  assert.equal(videoCodecForAsset([{ ...result, variants: undefined }], "movie"), undefined);
});

test("inferVideoCodec recovers codecs from historical job filenames and URLs", () => {
  assert.equal(inferVideoCodec("Movie.2026.720p.h265.chseng.mp4"), "hevc");
  assert.equal(inferVideoCodec("https://example.test/Movie%201080p%20AVC.mp4"), "h264");
  assert.equal(inferVideoCodec("ordinary-movie.mp4"), undefined);
});
