import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const script = fs.readFileSync(path.join(import.meta.dirname, "transcode-hevc-mp4.mjs"), "utf8");

test("bounded text-subtitle smoke tests bound subtitle extraction too", () => {
  assert.match(script, /"-i", input, \.\.\.durationArgs, "-map", `0:s:\$\{options\.subtitleStream\}`/u);
});

test("external subtitle files can declare their source character encoding", () => {
  assert.match(script, /--subtitle-charenc/u);
  assert.match(script, /charenc=\$\{options\.subtitleCharenc\}/u);
});

test("bounded external-subtitle smoke tests preserve the source subtitle timeline", () => {
  assert.match(script, /options\.subtitleFile != null && options\.start != null && options\.start > 0/u);
  assert.match(script, /setpts=PTS\+\$\{options\.start\}\/TB,\$\{rawSubtitleFileFilter\},setpts=PTS-\$\{options\.start\}\/TB/u);
});

test("scaled HDR tone mapping uses CUDA pre-scaling without changing SDR defaults", () => {
  assert.match(script, /scale_cuda=w=\$\{options\.scale\.width\}:h=\$\{options\.scale\.height\}/u);
  assert.match(script, /gpuHdrPreScale \? \["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"\]/u);
  assert.match(script, /options\.toneMapSdr && !options\.toneMapLibplacebo && !options\.cpuToneMap/u);
});

test("full encodes can place intermediate files on a separate temp volume", () => {
  assert.match(script, /--temp-dir/u);
  assert.match(script, /const tempDir = options\.tempDir/u);
  assert.match(script, /copyFileSync\(part, output\)/u);
});

test("playable outputs can retain an explicit audio language", () => {
  assert.match(script, /--audio-language/u);
  assert.match(script, /language=\$\{options\.audioLanguage\}/u);
  assert.match(script, /three-letter ISO 639-2 code/u);
});

test("sources with multiple video streams can select a compatible delivery stream", () => {
  assert.match(script, /--video-stream/u);
  assert.match(script, /options\.videoStream/u);
  assert.match(script, /\[0:v:\$\{options\.videoStream\}\]/u);
});

test("remux maps the filtered work video instead of the source video ordinal", () => {
  assert.match(script, /"-map", "0:v:0", "-map", options\.splitAudio \? "1:a:0" : "0:a:0"/u);
});

test("slow source audio can be encoded separately without truncating copied video", () => {
  assert.match(script, /--split-audio/u);
  assert.match(script, /"encode-video-mkv"/u);
  assert.match(script, /"encode-audio-m4a"/u);
  assert.match(script, /options\.splitAudio \? "1:a:0" : "0:a:0"/u);
  assert.doesNotMatch(script.match(/if \(options\.splitAudio\)[\s\S]*?\} else \{/u)?.[0] ?? "", /-shortest/u);
});

test("bitmap subtitles ending before the feature do not truncate the video", () => {
  assert.match(script, /overlay=eof_action=pass:repeatlast=0:format=auto/u);
  assert.doesNotMatch(script, /overlay=shortest=1/u);
});

test("full source encodes do not stop at the shortest mapped stream", () => {
  assert.doesNotMatch(script, /options\.duration == null \? \["-shortest"\]/u);
});
