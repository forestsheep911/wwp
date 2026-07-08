import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = path.resolve("tools/notion-upload-movie-video.mjs");

test("movie uploader documents prepare-only mode", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--prepare-only", "--help"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--prepare-only/);
});

test("movie uploader accepts prepare-only target page creation without local file", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "wwp-movie-upload-"));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--page-id",
      "39720ac1-2f0a-8029-8d47-c61f4e32437d",
      "--target-title",
      "碟中谍8：最终清算 繁英 1.6GB",
      "--prepare-only"
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NOTION_WRITE_TOKEN: "", NOTION_TOKEN: "" }
    });

    assert.equal(/--file is required/.test(result.stderr), false, result.stderr);
    assert.match(result.stderr, /NOTION_WRITE_TOKEN or NOTION_TOKEN is required/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
