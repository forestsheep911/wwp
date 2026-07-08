import test from "node:test";
import assert from "node:assert/strict";

import { suggestedSpecTitle } from "./notion-manual-upload-organizer.mjs";

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
