import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = path.resolve("tools/notion-media-assets-write.mjs");

test("media assets writer documents physical-interface direct binding", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--local-address <lan-ip>/);
});
