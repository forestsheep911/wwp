import test from "node:test";
import assert from "node:assert/strict";

import { assignSuggestedTargets, suggestedSpecTitle } from "./notion-manual-upload-organizer.mjs";

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
