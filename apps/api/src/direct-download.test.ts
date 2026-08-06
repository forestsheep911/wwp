import assert from "node:assert/strict";
import test from "node:test";

import { isDirectMediaDownloadUrl, notionPublicPageUrl } from "./direct-download.js";

test("notionPublicPageUrl creates the canonical public handoff page", () => {
  assert.equal(
    notionPublicPageUrl(
      "39220ac1-2f0a-8183-95e0-d05d40c1d90a",
      "https://wwpdw.notion.site/library?old=1"
    ),
    "https://wwpdw.notion.site/39220ac12f0a818395e0d05d40c1d90a"
  );
});

test("notionPublicPageUrl rejects malformed page ids and non-HTTPS sites", () => {
  assert.equal(notionPublicPageUrl("page-1"), undefined);
  assert.equal(
    notionPublicPageUrl("39220ac1-2f0a-8183-95e0-d05d40c1d90a", "http://wwpdw.notion.site"),
    undefined
  );
});

test("direct downloads reject Notion pages but allow signed media URLs", () => {
  assert.equal(
    isDirectMediaDownloadUrl("https://wwpdw.notion.site/39220ac12f0a818395e0d05d40c1d90a"),
    false
  );
  assert.equal(
    isDirectMediaDownloadUrl("https://www.notion.so/39220ac12f0a818395e0d05d40c1d90a"),
    false
  );
  assert.equal(
    isDirectMediaDownloadUrl("https://file.notion.so/f/example/video.mp4?table=block&id=media"),
    true
  );
  assert.equal(
    isDirectMediaDownloadUrl("https://wwpdw.notion.site/signed/video.mp4?name=video"),
    true
  );
  assert.equal(
    isDirectMediaDownloadUrl("https://media.example.com/video.mp4"),
    true
  );
});
