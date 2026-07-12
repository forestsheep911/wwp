import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("preflight blocks a legacy-title duplicate from a local snapshot", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-work-preflight-"));
  try {
    const snapshot = path.join(directory, "works.json");
    fs.writeFileSync(snapshot, JSON.stringify({ rows: [{ pageId: "old", title: "辐射 第二季", releaseYear: 2025, englishTitle: "Fallout Season 2" }] }));
    const result = spawnSync(process.execPath, [
      path.resolve("tools/notion-work-identity-preflight.mjs"),
      "--title", "Fallout S02 (2025)",
      "--year", "2025",
      "--snapshot", snapshot
    ], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.safeToCreate, false);
    assert.equal(output.matches[0].pageId, "old");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
