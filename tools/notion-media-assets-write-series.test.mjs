import test from "node:test";
import assert from "node:assert/strict";

import { buildAssetProperties, buildMissingProperties, parseAssetMetadata } from "./notion-media-assets-write-series.mjs";

const mediaAssetsDataSource = {
  properties: {
    Name: { type: "title" },
    Work: { type: "relation" },
    "Asset Type": { type: "select" },
    "Media Availability": { type: "select" },
    "Display Label": { type: "rich_text" },
    "Episode Number": { type: "number" },
    Resolution: { type: "select" },
    "Video Codec": { type: "select" },
    Container: { type: "select" },
    "Approx Size GB": { type: "number" },
    "Audio Languages": { type: "multi_select" },
    "Subtitle Languages": { type: "multi_select" },
    "Source Lineage": { type: "multi_select" },
    "Playback Verified": { type: "checkbox" },
    "Hide from Website": { type: "checkbox" },
    "Original File Name": { type: "rich_text" },
    "Source Page ID": { type: "rich_text" },
    "Media Block ID": { type: "rich_text" },
    "Developer Memo": { type: "rich_text" }
  }
};

test("parseAssetMetadata recognizes Korean audio tags in series filenames", () => {
  const metadata = parseAssetMetadata(
    "检察官的提案 第一季 繁 1080p Episode 02",
    "The.Prosecutors.Proposal.S01E02.1080p.h265.kor.cht.mp4",
    2
  );

  assert.deepEqual(metadata.audioLanguages, ["ko"]);
  assert.deepEqual(metadata.subtitleLanguages, ["zh-Hant"]);
  assert.equal(metadata.videoCodec, "hevc");
  assert.equal(metadata.container, "mp4");
});

test("new upload-backed series assets are marked playback verified without changing visibility", () => {
  const properties = buildAssetProperties(mediaAssetsDataSource, {
    workPageId: "work-page",
    name: "检察官的提案 / Episode 02",
    displayLabel: "检察官的提案 第一季 繁 1080p / Episode 02",
    originalFileName: "The.Prosecutors.Proposal.S01E02.1080p.h265.kor.cht.mp4",
    sourcePageId: "episode-page",
    mediaBlockId: "media-block",
    metadata: { episodeNumber: 2, resolution: "1080p", videoCodec: "hevc", container: "mp4" }
  });

  assert.equal(properties["Playback Verified"].checkbox, true);
  assert.equal(properties["Hide from Website"].checkbox, true);
});

test("buildMissingProperties fills empty existing fields without overwriting human values", () => {
  const candidate = {
    workPageId: "work-page",
    name: "检察官的提案 / Episode 02",
    displayLabel: "检察官的提案 第一季 繁 1080p / Episode 02",
    originalFileName: "The.Prosecutors.Proposal.S01E02.1080p.h265.kor.cht.mp4",
    sourcePageId: "episode-page",
    mediaBlockId: "media-block",
    metadata: {
      episodeNumber: 2,
      resolution: "1080p",
      videoCodec: "hevc",
      container: "mp4",
      approximateSizeGb: 0.09,
      audioLanguages: ["ko"],
      subtitleLanguages: ["zh-Hant"],
      sourceLineage: ["encode", "WEB-DL"]
    }
  };
  const existingPage = {
    properties: {
      Name: { type: "title", title: [{ plain_text: "检察官的提案 / Episode 02" }] },
      Work: { type: "relation", relation: [{ id: "work-page" }] },
      Resolution: { type: "select", select: { name: "720p" } },
      "Audio Languages": { type: "multi_select", multi_select: [] },
      "Approx Size GB": { type: "number", number: null },
      "Source Page ID": { type: "rich_text", rich_text: [] },
      "Media Block ID": { type: "rich_text", rich_text: [] },
      "Playback Verified": { type: "checkbox", checkbox: true },
      "Hide from Website": { type: "checkbox", checkbox: false }
    }
  };

  const patch = buildMissingProperties(mediaAssetsDataSource, existingPage, candidate);

  assert.equal(patch.Resolution, undefined);
  assert.equal(patch["Playback Verified"], undefined);
  assert.equal(patch["Hide from Website"], undefined);
  assert.deepEqual(patch["Audio Languages"], { multi_select: [{ name: "ko" }] });
  assert.deepEqual(patch["Approx Size GB"], { number: 0.09 });
  assert.equal(patch["Source Page ID"].rich_text[0].text.content, "episode-page");
  assert.equal(patch["Media Block ID"].rich_text[0].text.content, "media-block");
});
