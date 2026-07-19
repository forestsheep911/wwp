import assert from "node:assert/strict";
import test from "node:test";
import {
  directDownloadName,
  requiresConfirmedDownload
} from "../src/cinema/download.ts";

test("directDownloadName removes filename characters rejected by common platforms", () => {
  assert.equal(directDownloadName('Movie: Part / One?'), "Movie Part One.mp4");
  assert.equal(directDownloadName(), "wwp-video.mp4");
});

test("Android and coarse-pointer browsers require a second explicit download click", () => {
  assert.equal(requiresConfirmedDownload({ userAgent: "Mozilla/5.0 (Linux; Android 15)", coarsePointer: false }), true);
  assert.equal(requiresConfirmedDownload({ userAgent: "Desktop Chrome", coarsePointer: true }), true);
  assert.equal(requiresConfirmedDownload({ userAgent: "Desktop Chrome", coarsePointer: false }), false);
});
