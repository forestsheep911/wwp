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
    assert.equal(payload.entries[0].subtitleScope, "external_files_only");
    assert.equal(payload.entries[0].internalSubtitleProbe, "not_run");
    assert.equal(payload.entries[0].nfoCount, 1);
    assert.equal(payload.entries[0].subtitleHints.includes("chseng"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan-input-directory includes media files placed directly under the input root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-scan-root-file-"));
  try {
    writeFileSync(path.join(root, "The.Match.2025.1080p.WEB-DL.mkv"), Buffer.alloc(2048));
    writeFileSync(path.join(root, "The.Match.2025.cht.srt"), "test");

    const output = path.join(root, "scan.json");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--root",
      root,
      "--output",
      output
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].name, "The.Match.2025.1080p.WEB-DL");
    assert.equal(payload.entries[0].mediaCount, 1);
    assert.equal(payload.entries[0].subtitleCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan-input-directory keeps five fingerprint samples regardless of display sample count", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-scan-fingerprint-"));
  try {
    const seriesDir = path.join(root, "Example.Series.S01");
    mkdirSync(seriesDir, { recursive: true });
    for (let episode = 1; episode <= 7; episode += 1) {
      writeFileSync(path.join(seriesDir, `Example.Series.S01E0${episode}.mkv`), Buffer.alloc(1000 + episode));
    }

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
    assert.equal(payload.entries[0].largestMedia.length, 2);
    assert.equal(payload.entries[0].fingerprintMedia.length, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
