import test from "node:test";
import assert from "node:assert/strict";

import { buildFfmpegArgs } from "./remux-audio-variant.mjs";

test("audio variant remux preserves the complete copied video stream", () => {
  const args = buildFfmpegArgs({
    audioStream: 12,
    audioChannels: 6,
    audioBitrate: "256k"
  }, "video.mp4", "source.m2ts", "output.part.mp4");

  assert.equal(args.includes("-shortest"), false);
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-c:v")), [
    "-map", "0:v:0",
    "-map", "1:a:12"
  ]);
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.equal(args[args.indexOf("-tag:v") + 1], "hvc1");
});
