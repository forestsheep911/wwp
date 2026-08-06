import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { filesByName, releaseItemFromAction, roundedDecimalGb } from "./notion-media-assets-release-manifest.mjs";

test("movie release manifests explicitly expect no episode", () => {
  const item = releaseItemFromAction({
    pageId: "asset-movie",
    candidate: {
      originalFileName: "movie.mp4",
      workPageId: "work-movie",
      sourcePageId: "spec-movie",
      mediaBlockId: "block-movie",
      metadata: {
        resolution: "1080p",
        videoCodec: "hevc",
        container: "mp4",
        approximateSizeGb: 1.6
      }
    }
  });

  assert.equal(item.expectedEpisodeNumber, null);
});

test("series release manifests preserve a positive episode number", () => {
  const item = releaseItemFromAction({
    pageId: "asset-episode",
    candidate: {
      originalFileName: "episode.mp4",
      workPageId: "work-series",
      sourcePageId: "episode-page",
      mediaBlockId: "block-episode",
      metadata: {
        episodeNumber: 2,
        resolution: "1080p",
        videoCodec: "hevc",
        container: "mp4",
        approximateSizeGb: 0.4
      }
    }
  });

  assert.equal(item.expectedEpisodeNumber, 2);
});

test("local release evidence uses decimal GB like Media Assets", () => {
  const filePath = path.join(os.tmpdir(), `wwp-release-manifest-${process.pid}.bin`);
  fs.writeFileSync(filePath, Buffer.alloc(16_000_000));
  try {
    assert.equal(roundedDecimalGb(filePath), 0.02);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("local release evidence matches Notion filenames case-insensitively", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-release-manifest-case-"));
  const filename = "Michael.Jacksons.This.Is.It.2009.mp4";
  const filePath = path.join(root, filename);
  fs.writeFileSync(filePath, "video");
  try {
    const found = filesByName(root, new Set([filename.toLowerCase()]));
    assert.equal(found.get(filename.toLowerCase()), filePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
