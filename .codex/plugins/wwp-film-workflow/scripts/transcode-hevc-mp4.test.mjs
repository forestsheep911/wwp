import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const script = fs.readFileSync(path.join(import.meta.dirname, "transcode-hevc-mp4.mjs"), "utf8");

test("bounded text-subtitle smoke tests bound subtitle extraction too", () => {
  assert.match(script, /"-i", input, \.\.\.durationArgs, "-map", `0:s:\$\{options\.subtitleStream\}`/u);
});
