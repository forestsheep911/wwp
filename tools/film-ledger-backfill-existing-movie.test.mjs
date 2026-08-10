import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { movieCandidate } from "./film-ledger-backfill-existing-movie.mjs";

test("movieCandidate accepts only an exact released local media asset", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-movie-backfill-"));
  try {
    writeFileSync(path.join(root, "movie.mp4"), Buffer.alloc(12));
    const asset = { id: "asset", properties: { "Source Page ID": { rich_text: [{ plain_text: "spec" }] }, "Media Block ID": { rich_text: [{ plain_text: "block" }] }, "Original File Name": { rich_text: [{ plain_text: "movie.mp4" }] }, "Display Label": { rich_text: [{ plain_text: "Movie 1GB" }] }, "Playback Verified": { checkbox: true }, "Hide from Website": { checkbox: false }, "Media Availability": { select: { name: "playable" } }, "Asset Type": { select: { name: "playable_video" } } } };
    const item = movieCandidate(asset, new Set(["spec"]), root);
    assert.deepEqual(item.issues, []); assert.equal(item.outputBytes, 12);
    asset.properties["Hide from Website"].checkbox = true;
    assert.deepEqual(movieCandidate(asset, new Set(["spec"]), root).issues, ["asset_not_released"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
