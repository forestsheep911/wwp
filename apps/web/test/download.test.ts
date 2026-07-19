import assert from "node:assert/strict";
import test from "node:test";
import { directDownloadName } from "../src/cinema/download.ts";

test("directDownloadName removes filename characters rejected by common platforms", () => {
  assert.equal(directDownloadName('Movie: Part / One?'), "Movie Part One.mp4");
  assert.equal(directDownloadName(), "wwp-video.mp4");
});
