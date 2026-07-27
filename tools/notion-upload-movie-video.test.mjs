import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { assertPreparedMovieTargetIsEmpty, notionVideoName } from "./lib/notion-movie-target.mjs";

const scriptPath = path.resolve("tools/notion-upload-movie-video.mjs");

test("movie uploader documents prepare-only mode", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--prepare-only", "--help"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--prepare-only/);
  assert.match(result.stdout, /before long encode or manual upload handoff/i);
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

test("movie uploader refuses the historical default page id", () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--file",
    "E:\\video_made\\movie.mp4",
    "--target-page-id",
    "39720ac1-2f0a-81e1-ad8b-ecbd139c1a8f"
  ], {
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--page-id is required/);
});

test("movie uploader installs Notion DNS override before client work", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "wwp-movie-upload-"));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--page-id",
      "39720ac1-2f0a-8029-8d47-c61f4e32437d",
      "--target-title",
      "罪人 繁英 1.6GB",
      "--prepare-only"
    ], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        NOTION_WRITE_TOKEN: "",
        NOTION_TOKEN: "",
        NOTION_API_RESOLVE_IP: "203.0.113.10"
      }
    });

    assert.match(result.stdout, /dns override: api\.notion\.com -> 203\.0\.113\.10/);
    assert.match(result.stderr, /NOTION_WRITE_TOKEN or NOTION_TOKEN is required/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("movie prepare-only preflight rejects a target that already contains video", () => {
  assert.throws(
    () => assertPreparedMovieTargetIsEmpty({
      id: "spec-page",
      videoNames: ["Sinners.2025.1080p.h265.eng.chteng.4.8GB.mp4"]
    }),
    /already contains 1 video block.*Stop before encoding/i
  );
});

test("movie prepare-only preflight accepts an empty target", () => {
  assert.doesNotThrow(() => assertPreparedMovieTargetIsEmpty({
    id: "spec-page",
    videoNames: []
  }));
});

test("movie target preflight reports a hosted video filename instead of its signed URL", () => {
  assert.equal(
    notionVideoName({
      type: "file",
      file: {
        url: "https://example.invalid/path/Sinners.2025.1080p.h265.eng.chteng.4.8GB.mp4?signature=secret"
      }
    }),
    "Sinners.2025.1080p.h265.eng.chteng.4.8GB.mp4"
  );
});
