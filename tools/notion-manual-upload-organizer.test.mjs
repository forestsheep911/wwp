import test from "node:test";
import assert from "node:assert/strict";

import { assignSuggestedTargets, DEFAULT_RECENT_PAGE_LIMIT, effectiveScanDelayMs, markNewMedia, scanConcurrency, specMediaPlacementIssue, suggestedSpecTitle, summarizeEpisodeMedia } from "./notion-manual-upload-organizer.mjs";
import { DEFAULT_ROOT_DELAY_MS, DEFAULT_SCAN_TIMEOUT_SEC, nextDelaySec, chooseScanMode, scanSucceeded } from "./watch-notion-manual-uploads.mjs";

test("suggestedSpecTitle keeps distinct Chinese audio variants", () => {
  const title = "坏蛋联盟2 The Bad Guys 2 (2025)";

  assert.equal(
    suggestedSpecTitle(title, "The.Bad.Guys.2.2025.1080p.h265.zh-mandarin.4.9GB.mp4"),
    "坏蛋联盟2 国配 4.9GB"
  );
  assert.equal(
    suggestedSpecTitle(title, "The.Bad.Guys.2.2025.1080p.h265.zh-cantonese.4.9GB.mp4"),
    "坏蛋联盟2 粤配 4.9GB"
  );
  assert.equal(
    suggestedSpecTitle(title, "The.Bad.Guys.2.2025.1080p.h265.zh-taiwan.4.9GB.mp4"),
    "坏蛋联盟2 台配 4.9GB"
  );
});

test("manual upload organizer keeps the routine recent scan bounded", () => {
  assert.equal(DEFAULT_RECENT_PAGE_LIMIT, 3);
});

test("suggestedSpecTitle keeps ambiguous Chinese track markers", () => {
  const title = "疯狂动物城 Zootopia (2016)";

  assert.equal(
    suggestedSpecTitle(title, "Zootopia.2016.1080p.h265.zh-track2.4.8GB.mp4"),
    "疯狂动物城 中文 track2 4.8GB"
  );
  assert.equal(
    suggestedSpecTitle(title, "Zootopia.2016.1080p.h265.zh-track3.4.8GB.mp4"),
    "疯狂动物城 中文 track3 4.8GB"
  );
});

test("assignSuggestedTargets maps movie root media to matching spec page", () => {
  const [media] = assignSuggestedTargets(
    [
      {
        playable: true,
        name: "Sinners.2025.1080p.h265.eng.chteng.4.8GB.mp4",
        suggestedSpecTitle: "罪人 繁英 4.8GB"
      }
    ],
    [
      {
        pageId: "spec-page",
        title: "罪人 繁英 4.8GB",
        path: ["罪人", "child_page:罪人 繁英 4.8GB"],
        episodePages: []
      }
    ]
  );

  assert.deepEqual(media.suggestedTarget, {
    kind: "spec_page",
    pageId: "spec-page",
    title: "罪人 繁英 4.8GB",
    status: "ready"
  });
});

test("assignSuggestedTargets maps series root media to matching episode page", () => {
  const [media] = assignSuggestedTargets(
    [
      {
        playable: true,
        name: "Fallout.S02E07.The.Handoff.1080p.h265.chteng.cq26.mp4",
        suggestedSpecTitle: "辐射 第二季 繁英"
      }
    ],
    [
      {
        pageId: "spec-page",
        title: "辐射 第二季 繁英",
        path: ["辐射 第二季", "child_page:辐射 第二季 繁英"],
        episodePages: [
          { pageId: "episode-07", title: "Episode 07", episodeNumber: 7 }
        ]
      }
    ]
  );

  assert.deepEqual(media.suggestedTarget, {
    kind: "episode_page",
    pageId: "episode-07",
    title: "Episode 07",
    episodeNumber: 7,
    specPageId: "spec-page",
    specTitle: "辐射 第二季 繁英",
    status: "ready"
  });
});

test("summarizeEpisodeMedia detects playable media uploaded inside an episode page", () => {
  const media = summarizeEpisodeMedia(
    { type: "child_page", id: "episode-01", child_page: { title: "Episode 01" } },
    [{
      id: "media-01",
      type: "video",
      created_time: "2026-07-12T03:00:00.000Z",
      last_edited_time: "2026-07-12T03:01:00.000Z",
      video: {
        type: "file",
        file: { url: "https://example.invalid/Episode.01.mp4", expiry_time: "2026-07-13T03:01:00.000Z" }
      }
    }],
    ["Example", "Spec"]
  );

  assert.equal(media.length, 1);
  assert.equal(media[0].name, "Episode.01.mp4");
  assert.equal(media[0].playable, true);
  assert.equal(media[0].structuralStatus, "valid_episode_media");
  assert.deepEqual(media[0].path, ["Example", "Spec", "child_page:Episode 01", "video"]);
});

test("source specs flag playable videos as misplaced instead of final structured media", () => {
  const issue = specMediaPlacementIssue(
    "银河英雄传说 日语中字 原盘 0.08-0.44GB/集",
    "Galaxy.Heroes.1988.E001.832x624.h265.cht.low.mp4"
  );
  assert.equal(issue?.code, "playable_media_in_source_spec");

  const media = summarizeEpisodeMedia(
    { type: "child_page", id: "episode-01", child_page: { title: "Episode 01" } },
    [{
      id: "media-01",
      type: "video",
      created_time: "2026-07-12T03:00:00.000Z",
      last_edited_time: "2026-07-12T03:01:00.000Z",
      video: {
        type: "file",
        file: { url: "https://example.invalid/Galaxy.Heroes.1988.E001.h265.cht.low.mp4" }
      }
    }],
    ["银河英雄传说", "银河英雄传说 日语中字 原盘"],
    "银河英雄传说 日语中字 原盘",
    "银河英雄传说 銀河英雄伝説 (1988)"
  );

  assert.equal(media[0].playable, true);
  assert.equal(media[0].placementIssue, "playable_media_in_source_spec");
  assert.equal(media[0].recommendedAction, "reupload_to_playable_spec");
});

test("markNewMedia uses media-block timestamps instead of parent page timestamps", () => {
  const scans = [{
    pageId: "work-page",
    title: "Example",
    lastEditedTime: "2026-07-01T00:00:00.000Z",
    rootLandingMedia: [],
    specMedia: [{
      blockId: "media-1",
      blockCreatedTime: "2026-07-12T02:00:00.000Z",
      blockLastEditedTime: "2026-07-12T02:01:00.000Z",
      name: "Example.mp4",
      path: ["Example", "Spec", "video"],
      playable: true
    }],
    status: "has_structured_playable_media"
  }];

  const first = markNewMedia(scans, { version: 1, blocks: {} });
  assert.equal(first.newBlockIds.length, 1);
  assert.equal(first.scans[0].specMedia[0].isNewSinceLastScan, true);

  const second = markNewMedia(scans, first.state);
  assert.equal(second.newBlockIds.length, 0);
  assert.equal(second.scans[0].specMedia[0].isNewSinceLastScan, false);

  const edited = markNewMedia([
    { ...scans[0], specMedia: [{ ...scans[0].specMedia[0], blockLastEditedTime: "2026-07-12T02:02:00.000Z" }] }
  ], first.state);
  assert.deepEqual(edited.newBlockIds, ["media-1"]);
});

test("targeted scans preserve media seen on other pages", () => {
  const first = markNewMedia([
    {
      pageId: "page-a",
      title: "A",
      rootLandingMedia: [],
      specMedia: [{
        blockId: "media-a",
        blockCreatedTime: "2026-07-12T01:00:00.000Z",
        blockLastEditedTime: "2026-07-12T01:01:00.000Z",
        name: "a.mp4",
        playable: true
      }]
    }
  ], { version: 1, blocks: {} });

  const targeted = markNewMedia([
    {
      pageId: "page-b",
      title: "B",
      rootLandingMedia: [],
      specMedia: [{
        blockId: "media-b",
        blockCreatedTime: "2026-07-12T02:00:00.000Z",
        blockLastEditedTime: "2026-07-12T02:01:00.000Z",
        name: "b.mp4",
        playable: true
      }]
    }
  ], first.state);

  assert.deepEqual(targeted.newBlockIds, ["media-b"]);
  assert.ok(targeted.state.blocks["media-a"]);
  assert.ok(targeted.state.blocks["media-b"]);
});

test("watcher uses a recent-page scan between nested full scans", () => {
  assert.equal(chooseScanMode(1_000, 900, 7200), "recent");
  assert.equal(chooseScanMode(8_200_000, 900, 7200), "full");
});

test("root sweeps use bounded page-read concurrency", () => {
  assert.equal(scanConcurrency(true), 1);
  assert.equal(scanConcurrency(false), 1);
});

test("scan delay applies only to root sweeps", () => {
  assert.equal(effectiveScanDelayMs(true, 350), 350);
  assert.equal(effectiveScanDelayMs(false, 350), 0);
});

test("watcher uses a gentle default delay between root page reads", () => {
  assert.equal(DEFAULT_ROOT_DELAY_MS, 250);
});

test("watcher has a finite default organizer timeout", () => {
  assert.equal(DEFAULT_SCAN_TIMEOUT_SEC, 600);
});

test("watcher trusts a successful organizer report despite SDK retry warnings", () => {
  assert.equal(scanSucceeded(0, "rate_limited retry warning"), true);
  assert.equal(scanSucceeded(1, "rate_limited retry warning"), false);
});

test("notion watcher backs off after a failed scan and resets after success", () => {
  assert.equal(nextDelaySec(900, 900, false), 1800);
  assert.equal(nextDelaySec(900, 3600, false), 7200);
  assert.equal(nextDelaySec(900, 7200, false), 7200);
  assert.equal(nextDelaySec(900, 7200, true), 900);
});
