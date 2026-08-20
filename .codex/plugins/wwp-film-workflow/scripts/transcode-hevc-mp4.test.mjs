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

test("scaled HDR tone mapping uses CUDA pre-scaling without changing SDR defaults", () => {
  assert.match(script, /scale_cuda=w=\$\{options\.scale\.width\}:h=\$\{options\.scale\.height\}/u);
  assert.match(script, /gpuHdrPreScale \? \["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"\]/u);
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

test("slow source audio can be encoded separately without truncating copied video", () => {
  assert.match(script, /--split-audio/u);
  assert.match(script, /"encode-video-mkv"/u);
  assert.match(script, /"encode-audio-m4a"/u);
  assert.match(script, /options\.splitAudio \? "1:a:0" : "0:a:0"/u);
  assert.doesNotMatch(script.match(/if \(options\.splitAudio\)[\s\S]*?\} else \{/u)?.[0] ?? "", /-shortest/u);
});
