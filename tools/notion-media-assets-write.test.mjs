import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = path.resolve("tools/notion-media-assets-write.mjs");

test("media assets writer documents physical-interface direct binding", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--local-address <lan-ip>/);
});

test("target-only spec pages retain their title when direct media is audited", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /auditPlayableSpecPage\(\{ id: page\.id, type: "child_page", child_page: \{ title \} \}\)/);
});

test("media assets writer serializes Notion requests at one-second intervals", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /let requestQueue = Promise\.resolve\(\)/);
  assert.match(source, /1000 - \(Date\.now\(\) - lastRequestStartedAt\)/);
});

test("explicit corrections can repair the Media Assets title and verify readback", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /SAFE_REPLACE_EXISTING_FIELDS = new Set\(\[\s*"Name"/);
  assert.match(source, /existingProperty\.type === "title"/);
  assert.match(source, /item\.plain_text \?\? item\.text\?\.content/);
  assert.match(source, /Media Assets correction readback failed/);
});
