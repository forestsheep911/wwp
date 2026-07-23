import assert from "node:assert/strict";
import test from "node:test";
import { directDownloadName, directDownloadUrl, directPlaybackUrl } from "../src/cinema/download.ts";

test("directDownloadName removes filename characters rejected by common platforms", () => {
  assert.equal(directDownloadName('Movie: Part / One?'), "Movie Part One.mp4");
  assert.equal(directDownloadName(), "wwp-video.mp4");
});

test("directDownloadUrl asks Notion file links to download with a filename", () => {
  const url = new URL(directDownloadUrl(
    "https://file.notion.so/f/f/space/file/movie.mp4?expirationTimestamp=1784541600000&signature=abc",
    "Movie: Part / One?"
  ));

  assert.equal(url.searchParams.get("download"), "true");
  assert.equal(url.searchParams.get("downloadName"), "Movie Part One.mp4");
  assert.equal(url.searchParams.get("signature"), "abc");
});

test("directDownloadUrl asks Notion signed page links to download", () => {
  const url = new URL(directDownloadUrl(
    "https://wwpdw.notion.site/signed/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2Fspace%2Ffile%2Fmovie.mp4%3FX-Amz-Date%3D20260723T010000Z%26X-Amz-Expires%3D3600?table=block&id=abc&spaceId=space",
    "Movie: Part / One?"
  ));

  assert.equal(url.searchParams.get("download"), "true");
  assert.equal(url.searchParams.get("name"), "Movie Part One.mp4");
  assert.equal(url.searchParams.get("id"), "abc");
});

test("directDownloadUrl replaces generic Notion signed page filenames", () => {
  const url = new URL(directDownloadUrl(
    "https://wwpdw.notion.site/signed/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2Fspace%2Ffile%2Fmovie.mp4%3FX-Amz-Date%3D20260723T010000Z%26X-Amz-Expires%3D3600?table=block&id=abc&download=true&name=video",
    "Fallout S02E07"
  ));

  assert.equal(url.searchParams.get("name"), "Fallout S02E07.mp4");
});

test("directDownloadUrl leaves non-Notion signed URLs unchanged", () => {
  const sourceUrl = "https://example.blob.core.windows.net/video/movie.mp4?sp=r&sig=abc";
  assert.equal(directDownloadUrl(sourceUrl, "Movie"), sourceUrl);
});

test("directPlaybackUrl removes Notion download hints", () => {
  const url = new URL(directPlaybackUrl(
    "https://file.notion.so/f/f/space/file/movie.mp4?download=true&downloadName=Movie.mp4&signature=abc"
  ));

  assert.equal(url.searchParams.get("download"), null);
  assert.equal(url.searchParams.get("downloadName"), null);
  assert.equal(url.searchParams.get("signature"), "abc");
});

test("directPlaybackUrl removes Notion signed page download hints", () => {
  const url = new URL(directPlaybackUrl(
    "https://wwpdw.notion.site/signed/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2Fspace%2Ffile%2Fmovie.mp4%3FX-Amz-Date%3D20260723T010000Z%26X-Amz-Expires%3D3600?table=block&id=abc&download=true&name=Movie.mp4"
  ));

  assert.equal(url.searchParams.get("download"), null);
  assert.equal(url.searchParams.get("name"), "Movie.mp4");
  assert.equal(url.searchParams.get("id"), "abc");
});
