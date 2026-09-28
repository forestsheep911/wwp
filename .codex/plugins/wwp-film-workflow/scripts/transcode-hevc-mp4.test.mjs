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

test("CPU tone-map mode also enables the HDR-to-SDR filter", () => {
  assert.match(script, /arg === "--cpu-tone-map"\) \{\s*options\.cpuToneMap = true;\s*options\.toneMapSdr = true;/u);
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

test("bounded smoke samples fail closed on decoder errors", () => {
  assert.match(script, /function smokeFailureArgs\(duration(?:, allowDecoderRecovery = false)?\)/u);
  assert.match(script, /duration == null \|\| allowDecoderRecovery \? \[\] : \["-xerror"\]/u);
  assert.match(script, /\.\.\.smokeFailureArgs\(options\.duration, options\.allowDecoderRecovery\)/gu);
  assert.match(script, /Could not find ref with POC/u);
  assert.match(script, /strict smoke failed on decoder error/u);
});

test("full encodes rebuild timestamps at the selected source frame rate", () => {
  assert.match(script, /"-fps_mode", "cfr"/u);
  assert.match(script, /non-monotonic.*PTS|duplicate DTS|monotonic.*timeline/iu);
  assert.match(script, /function probeVideoFrameRate\(/u);
  assert.match(script, /const sourceFrameRate = probeVideoFrameRate\(input, options\.videoStream\)/u);
  assert.match(script, /setpts=N\/\(\$\{sourceFrameRate\}\*TB\)/u);
  assert.doesNotMatch(script, /setpts=N\/\(24000\/1001\*TB\)/u);
  assert.match(script, /\[0:s:\$\{options\.subtitleStream\}\]scale=/u);
});

test("final output must preserve source duration and audio/video synchronization", () => {
  assert.match(script, /function assertDeliveryDurations\(/u);
  assert.match(script, /output video duration mismatch/u);
  assert.match(script, /output audio\/video duration mismatch/u);
  assert.match(script, /assertDeliveryDurations\(input, part, options\.videoStream, options\.start, options\.duration\)/u);
});

test("encoding can explicitly fall back from NVENC to CPU libx265", () => {
  assert.match(script, /--video-encoder <hevc_nvenc\|libx265>/u);
  assert.match(script, /options\.videoEncoder === "libx265"/u);
  assert.match(script, /\["-c:v", "libx265", "-preset", "medium"\]/u);
  assert.match(script, /options\.videoEncoder === "hevc_nvenc"/u);
});

test("decoder recovery is explicit and does not weaken the default smoke gate", () => {
  assert.match(script, /--allow-decoder-recovery/u);
  assert.match(script, /duration == null \|\| allowDecoderRecovery \? \[\] : \["-xerror"\]/u);
  assert.match(script, /\["-err_detect", "ignore_err"\]/u);
});
