import test from "node:test";
import assert from "node:assert/strict";
import { assertHev1Mp4Probe, buildFfmpegArgs } from "./remux-hevc-hvc1.mjs";

test("hvc1 remux copies all streams and retags the video", () => {
  const args = buildFfmpegArgs("input.mp4", "output.part.mp4");
  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-y", "-i", "input.mp4", "-map", "0"]);
  assert.equal(args[args.indexOf("-c") + 1], "copy");
  assert.equal(args[args.indexOf("-tag:v") + 1], "hvc1");
  assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
});

test("hvc1 remux only accepts HEVC hev1 inputs", () => {
  assert.doesNotThrow(() => assertHev1Mp4Probe({
    streams: [{ codec_type: "video", codec_name: "hevc", codec_tag_string: "hev1" }]
  }, "input.mp4"));
  assert.throws(() => assertHev1Mp4Probe({
    streams: [{ codec_type: "video", codec_name: "hevc", codec_tag_string: "hvc1" }]
  }, "input.mp4"), /must have codec_tag_string=hev1/);
  assert.throws(() => assertHev1Mp4Probe({
    streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1" }]
  }, "input.mp4"), /not HEVC/);
});
