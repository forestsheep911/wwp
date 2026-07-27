import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { episodeNumber, episodeRange, validateSeriesSpecTitle } from "./notion-upload-series-videos.mjs";

const scriptPath = path.resolve("tools/notion-upload-series-videos.mjs");

test("series uploader documents and accepts prepare-only mode", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--prepare-only", "--help"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--prepare-only/);
  assert.match(result.stdout, /before long encode or manual upload handoff/i);
});

test("series uploader allows create-structure mode for an existing series page without title", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "wwp-series-upload-"));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--page-id",
      "39720ac1-2f0a-8029-8d47-c61f4e32437d",
      "--create",
      "--create-episodes",
      "--prepare-only"
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NOTION_WRITE_TOKEN: "", NOTION_TOKEN: "" }
    });

    assert.equal(/--create requires --title/.test(result.stderr), false, result.stderr);
    assert.match(result.stderr, /NOTION_WRITE_TOKEN or NOTION_TOKEN is required/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("episode parser accepts bracket typo but leaves recap decimals unmapped", () => {
  assert.equal(episodeNumber("【AGE】[JOJO][180253][13)][720P][CHS] AVC.mp4"), 13);
  assert.equal(episodeNumber("[JOJO][Golden Wind][13.5][720P][CHS] AVC.mp4"), undefined);
});

test("episode parser accepts a trailing episode number in ordinary filenames", () => {
  assert.equal(episodeNumber("Hokuto no Ken - 001.mp4"), 1);
  assert.equal(episodeNumber("Series_Episode_12.mkv"), 12);
  assert.equal(episodeNumber("Film 2026.mp4"), undefined);
});

test("episodeRange parses a series collection filename", () => {
  assert.deepEqual(
    episodeRange("Teach.You.a.Lesson.S01E01-E05.2026.1080p.h265.cht.mp4"),
    { start: 1, end: 5 }
  );
  assert.equal(episodeNumber("Teach.You.a.Lesson.S01E01-E05.2026.1080p.h265.cht.mp4"), 1);
});

test("series collection spec titles may use aggregate size per collection", () => {
  assert.equal(validateSeriesSpecTitle("检察官的提案 简 H.265 4.8GB/合集"), "检察官的提案 简 H.265 4.8GB/合集");
});

test("series spec sizes must explicitly describe per-episode size", () => {
  assert.doesNotThrow(() => validateSeriesSpecTitle("北斗神拳 繁 H.264 0.169-0.174GB/集"));
  assert.doesNotThrow(() => validateSeriesSpecTitle("检察官的提案 第一季 繁"));
  assert.throws(
    () => validateSeriesSpecTitle("北斗神拳 繁 24.3GB"),
    /per-episode|每集/i
  );
  assert.throws(
    () => validateSeriesSpecTitle("摩登情爱 第一季 繁 0.44GB"),
    /per-episode|每集/i
  );
});
