import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = path.resolve(".codex/plugins/wwp-film-workflow/scripts/scan-input-directory.mjs");

test("scan-input-directory summarizes top-level media candidates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-scan-"));
  try {
    const movieDir = path.join(root, "Example.Movie.2025.1080p");
    mkdirSync(movieDir, { recursive: true });
    writeFileSync(path.join(movieDir, "Example.Movie.2025.mkv"), Buffer.alloc(1024));
    writeFileSync(path.join(movieDir, "Example.Movie.2025.chseng.ass"), "test");
    writeFileSync(path.join(movieDir, "Example.Movie.2025.nfo"), "nfo");

    const output = path.join(root, "scan.json");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--root",
      root,
      "--output",
      output,
      "--max-samples",
      "2"
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(payload.root, root);
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].mediaCount, 1);
    assert.equal(payload.entries[0].subtitleCount, 1);
    assert.equal(payload.entries[0].nfoCount, 1);
    assert.equal(payload.entries[0].subtitleHints.includes("chseng"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
