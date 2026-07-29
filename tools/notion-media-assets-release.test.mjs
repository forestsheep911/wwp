import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseCandidate } from "./notion-media-assets-release.mjs";

function property(type, value) {
  if (type === "select") return { type, select: { name: value } };
  if (type === "rich_text") return { type, rich_text: [{ plain_text: value }] };
  if (type === "number") return { type, number: value };
  if (type === "checkbox") return { type, checkbox: value };
  if (type === "relation") return { type, relation: value.map((id) => ({ id })) };
  throw new Error(`Unsupported property type: ${type}`);
}

const item = {
  pageId: "asset-7",
  expectedWorkPageId: "work-1",
  expectedSourcePageId: "episode-7",
  expectedMediaBlockId: "block-7",
  expectedEpisodeNumber: 7,
  expectedResolution: "720p",
  expectedVideoCodec: "h264",
  expectedContainer: "mp4",
  expectedApproxSizeGb: 0.263
};

function page(hidden = true) {
  return {
    id: "asset-7",
    archived: false,
    in_trash: false,
    properties: {
      Work: property("relation", ["work-1"]),
      "Asset Type": property("select", "playable_video"),
      "Media Availability": property("select", "playable"),
      "Playback Verified": property("checkbox", true),
      "Hide from Website": property("checkbox", hidden),
      "Source Page ID": property("rich_text", "episode-7"),
      "Media Block ID": property("rich_text", "block-7"),
      "Episode Number": property("number", 7),
      Resolution: property("select", "720p"),
      "Video Codec": property("select", "h264"),
      Container: property("select", "mp4"),
      "Approx Size GB": property("number", 0.263)
    }
  };
}

test("releases only an exact hidden playable asset", () => {
  const result = validateReleaseCandidate(page(true), item);
  assert.equal(result.ok, true);
  assert.equal(result.action, "release");
});

test("is idempotent for an already released asset", () => {
  const result = validateReleaseCandidate(page(false), item);
  assert.equal(result.ok, true);
  assert.equal(result.action, "already_released");
});

test("blocks release when technical evidence does not match", () => {
  const changed = page(true);
  changed.properties["Media Block ID"] = property("rich_text", "wrong-block");
  changed.properties["Approx Size GB"] = property("number", 0.5);
  const result = validateReleaseCandidate(changed, item);
  assert.equal(result.ok, false);
  assert.equal(result.action, "blocked");
  assert.deepEqual(result.failures, ["Media Block ID mismatch", "Approx Size GB mismatch"]);
});

test("releases a movie only when the manifest explicitly expects no episode", () => {
  const movieItem = {
    ...item,
    expectedSourcePageId: "spec-1",
    expectedMediaBlockId: "movie-block",
    expectedEpisodeNumber: null
  };
  const moviePage = page(true);
  moviePage.properties["Source Page ID"] = property("rich_text", "spec-1");
  moviePage.properties["Media Block ID"] = property("rich_text", "movie-block");
  moviePage.properties["Episode Number"] = property("number", null);

  const result = validateReleaseCandidate(moviePage, movieItem);
  assert.equal(result.ok, true);
  assert.equal(result.action, "release");
  assert.equal(result.expected.episodeNumber, null);
});

test("blocks a movie release when the asset unexpectedly has an episode", () => {
  const movieItem = { ...item, expectedEpisodeNumber: null };
  const moviePage = page(true);

  const result = validateReleaseCandidate(moviePage, movieItem);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["Episode Number mismatch"]);
});

test("requires the manifest to state the movie or series episode expectation", () => {
  const incomplete = { ...item };
  delete incomplete.expectedEpisodeNumber;

  assert.throws(
    () => validateReleaseCandidate(page(true), incomplete),
    /requires expectedEpisodeNumber/
  );
});
