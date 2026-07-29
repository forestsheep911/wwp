import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssetProperties,
  buildMissingProperties,
  buildReplacementProperties,
  candidatesFromOrganizerPage,
  comparableUploadFileName,
  metadataOverrideMatches,
  parseAssetMetadata,
  playablePlacementIssue,
  selectablePages
} from "./notion-media-assets-write-series.mjs";

test("metadata overrides survive Notion filename punctuation cleanup on the exact episode page", () => {
  const localName = "【AGE】[JOJO&UHA-WING&Kamigami][180253][01][720P][CHS] AVC.mp4";
  const notionName = "【AGE】JOJOUHA-WINGKamigami18025301720PCHS_AVC.mp4";

  assert.equal(comparableUploadFileName(localName), comparableUploadFileName(notionName));
  assert.equal(metadataOverrideMatches({
    sourcePageId: "episode-01",
    mediaBlockId: "media-01",
    originalFileName: notionName
  }, {
    sourcePageId: "episode-01",
    originalFileName: localName
  }), true);
  assert.equal(metadataOverrideMatches({
    sourcePageId: "episode-02",
    mediaBlockId: "media-02",
    originalFileName: notionName
  }, {
    sourcePageId: "episode-01",
    originalFileName: localName
  }), false);
});

const mediaAssetsDataSource = {
  properties: {
    Name: { type: "title" },
    Work: { type: "relation" },
    "Asset Type": { type: "select" },
    "Media Availability": { type: "select" },
    "Display Label": { type: "rich_text" },
    "Episode Number": { type: "number" },
    "Episode End": { type: "number" },
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

test("series collection metadata preserves the inclusive episode range", () => {
  const metadata = parseAssetMetadata(
    "检察官的提案 第一季 简 1080p Episode 01-05",
    "The.Prosecutors.Proposal.S01E01-E05.1080p.h265.chs.mp4",
    1,
    5
  );

  assert.equal(metadata.episodeNumber, 1);
  assert.equal(metadata.episodeEndNumber, 5);
  const properties = buildAssetProperties(mediaAssetsDataSource, {
    workPageId: "work-page",
    name: "检察官的提案 / Episode 01-05",
    displayLabel: "检察官的提案 第一季 简 1080p / Episode 01-05",
    originalFileName: "The.Prosecutors.Proposal.S01E01-E05.1080p.h265.chs.mp4",
    sourcePageId: "collection-page",
    mediaBlockId: "media-block",
    metadata
  });
  assert.equal(properties["Episode Number"].number, 1);
  assert.equal(properties["Episode End"].number, 5);
});

test("series writer rejects playable files under source specs", () => {
  assert.equal(
    playablePlacementIssue("银河英雄传说 日语中字 原盘 0.08-0.44GB/集", "Galaxy.Heroes.1988.E001.h265.cht.low.mp4")?.kind,
    "playable_media_in_source_spec"
  );
  assert.equal(playablePlacementIssue("银河英雄传说 繁 H.265 0.06-0.23GB/集", "Galaxy.Heroes.1988.E001.h265.cht.low.mp4"), null);
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

test("buildReplacementProperties changes only explicitly allowed technical fields", () => {
  const candidate = {
    workPageId: "work-page",
    name: "银河英雄传说 / Episode 01",
    displayLabel: "银河英雄传说 简 H.265 0.08-0.44GB/集 / Episode 01",
    originalFileName: "Galaxy.Heroes.1988.E001.mp4",
    sourcePageId: "episode-page",
    mediaBlockId: "media-block",
    replaceExistingFields: ["Display Label", "Subtitle Languages"],
    metadata: { episodeNumber: 1, subtitleLanguages: ["zh-Hans"] }
  };
  const existingPage = {
    properties: {
      Name: { type: "title", title: [{ plain_text: "银河英雄传说 / Episode 01" }] },
      Work: { type: "relation", relation: [{ id: "work-page" }] },
      "Subtitle Languages": { type: "multi_select", multi_select: [{ name: "zh-Hant" }] },
      "Playback Verified": { type: "checkbox", checkbox: true },
      "Hide from Website": { type: "checkbox", checkbox: false }
    }
  };

  const patch = buildReplacementProperties(mediaAssetsDataSource, existingPage, candidate);

  assert.deepEqual(patch, {
    "Display Label": {
      rich_text: [{ text: { content: "银河英雄传说 简 H.265 0.08-0.44GB/集 / Episode 01" } }]
    },
    "Subtitle Languages": { multi_select: [{ name: "zh-Hans" }] }
  });
  assert.equal(patch.Name, undefined);
  assert.equal(patch.Work, undefined);
  assert.equal(patch["Playback Verified"], undefined);
  assert.equal(patch["Hide from Website"], undefined);
});

test("buildReplacementProperties rejects protected fields", () => {
  assert.throws(
    () => buildReplacementProperties(mediaAssetsDataSource, { properties: {} }, {
      name: "unsafe",
      replaceExistingFields: ["Hide from Website"],
      metadata: {}
    }),
    /protected or unknown fields/
  );
});

test("buildReplacementProperties is idempotent after the correction is present", () => {
  const displayLabel = "银河英雄传说 简 H.265 0.08-0.44GB/集 / Episode 01";
  const patch = buildReplacementProperties(mediaAssetsDataSource, {
    properties: {
      "Display Label": { type: "rich_text", rich_text: [{ plain_text: displayLabel }] },
      "Subtitle Languages": { type: "multi_select", multi_select: [{ name: "zh-Hans" }] }
    }
  }, {
    name: "银河英雄传说 / Episode 01",
    displayLabel,
    replaceExistingFields: ["Display Label", "Subtitle Languages"],
    metadata: { subtitleLanguages: ["zh-Hans"] }
  });

  assert.deepEqual(patch, {});
});

test("series writer consumes a bounded manual organizer report without another episode scan", () => {
  const organizerPage = {
    pageId: "work-page",
    title: "银河英雄传说 銀河英雄伝説 (1988)",
    specPages: [{
      pageId: "spec-page",
      title: "银河英雄传说 繁 H.265 0.08-0.44GB/集",
      episodePages: [
        { pageId: "episode-1", title: "Episode 01-05", episodeNumber: 1, episodeEndNumber: 5 },
        { pageId: "episode-2", title: "Episode 06", episodeNumber: 6 }
      ]
    }],
    specMedia: [
      {
        blockId: "media-1",
        name: "Galaxy.Heroes.1988.E001-E005.832x624.h265.cht.low.mp4",
        playable: true,
        structuralStatus: "valid_episode_media",
        path: [
          "银河英雄传说 銀河英雄伝説 (1988)",
          "child_page:银河英雄传说 繁 H.265 0.08-0.44GB/集",
          "child_page:Episode 01-05",
          "video"
        ]
      },
      {
        blockId: "media-2",
        name: "Galaxy.Heroes.1988.E006.832x624.h265.cht.low.mp4",
        playable: true,
        structuralStatus: "valid_episode_media",
        path: [
          "银河英雄传说 銀河英雄伝説 (1988)",
          "child_page:银河英雄传说 繁 H.265 0.08-0.44GB/集",
          "child_page:Episode 06",
          "video"
        ]
      }
    ]
  };

  assert.equal(selectablePages({ pages: [organizerPage] }, 0, 1, false, false).length, 1);
  const result = candidatesFromOrganizerPage(organizerPage);
  assert.equal(result.issues.length, 0);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].sourcePageId, "episode-1");
  assert.equal(result.candidates[0].mediaBlockId, "media-1");
  assert.equal(result.candidates[0].metadata.episodeNumber, 1);
  assert.equal(result.candidates[0].metadata.episodeEndNumber, 5);
});
