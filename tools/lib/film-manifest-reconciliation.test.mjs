import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverRecentProductionManifests } from "./film-manifest-reconciliation.mjs";

test("recent manifest discovery keeps the newest file for each Notion target", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-manifests-"));
  try {
    const older = path.join(dir, "old-production.json");
    const newer = path.join(dir, "new-production.json");
    const other = path.join(dir, "other-production.json");
    const base = { workPageId: "work", targetSpecPageId: "spec", output: "old.mp4" };
    writeFileSync(older, JSON.stringify(base));
    writeFileSync(newer, JSON.stringify({ ...base, output: "new.mp4" }));
    writeFileSync(other, JSON.stringify({ ...base, targetSpecPageId: "other-spec", output: "other.mp4" }));
    const now = Date.now() / 1000;
    utimesSync(older, now - 20, now - 20);
    utimesSync(newer, now, now);
    utimesSync(other, now - 10, now - 10);

    const result = discoverRecentProductionManifests(dir, { limit: 5 });
    assert.deepEqual(result.map(item => item.manifest.output), ["new.mp4", "other.mp4"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
