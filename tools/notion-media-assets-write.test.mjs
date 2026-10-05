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

test("an exact media block binding uses its manifest filename instead of the Notion caption", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /mediaBlock\.id === target\.mediaBlockId \? target\.expectedFilename : ""/);
  assert.match(source, /appendPlayableCandidate\(mediaBlock, specPage\.id, "", filenameOverride\)/);
});

test("an exact episode media block binding accepts an opaque Notion video URL", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /explicitlyBoundEpisodeMedia = episodeChildren\.filter/);
  assert.match(source, /block\.id === target\.mediaBlockId/);
  assert.match(source, /appendPlayableCandidate\(mediaBlock, episodePage\.id, blockTitle\(episodePage\), target\.expectedFilename\)/);
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

test("explicit asset page corrections support historical empty titles without creating duplicates", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /if \(candidate\.assetPageId\)/);
  assert.match(source, /is archived; preserve it as history/);
  assert.match(source, /if \(page\.archived \|\| page\.in_trash\) return false/);
  assert.match(source, /Explicit Media Asset .* does not relate to work/);
  assert.match(source, /Source Page ID.*candidate\.sourcePageId/);
  assert.match(source, /Media Block ID.*candidate\.mediaBlockId/);
  assert.match(source, /Original File Name.*candidate\.originalFileName/);
  assert.match(source, /if \(replaceField && replaceFields\.includes\(replaceField\)\) continue;/);
});

test("new source-only rows do not become visibility blockers by default", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /A source-only row is not exposed as a playable website variant/u);
  assert.match(source, /visibilityHideReasonIsConcrete\(candidate\.visibilityReason\)/u);
});

test("an inherited hide flag cannot hide an asset without a concrete reason", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /stale\/over-conservative manifest/u);
  assert.match(source, /candidate\.hideFromWebsite === true[\s\S]*visibilityHideReasonIsConcrete/u);
});
