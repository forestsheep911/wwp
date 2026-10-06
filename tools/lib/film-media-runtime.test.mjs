import assert from "node:assert/strict";
import test from "node:test";
import { defaultOutputRoot, assertStoragePath, videoEncodingArgs, selectVideoEncoder } from "./film-media-runtime.mjs";
import { comparablePath, pathIsWithin, sourceIsDescendant } from "./film-paths.mjs";

test("Mac storage never invents a Windows output directory", () => {
  assert.equal(defaultOutputRoot("darwin", {}), null);
  assert.equal(defaultOutputRoot("win32", {}), "E:\\video_made");
  assert.equal(defaultOutputRoot("darwin", { WWP_OUTPUT_ROOT: "/Volumes/Media/outputs" }), "/Volumes/Media/outputs");
  assert.throws(() => assertStoragePath("E:\\video_made", "darwin"), /Windows drive path/u);
  if (process.platform === "darwin") assert.throws(() => assertStoragePath("/Volumes/WWP-NOT-A-MOUNT/outputs"), /not mounted/u);
});

test("Apple quality uses independent options and bitrate mode never receives CRF or NVENC presets", () => {
  const quality = videoEncodingArgs("hevc_videotoolbox", { vtQuality: 70 });
  assert.deepEqual(quality.slice(-2), ["-q:v", "70"]);
  const bitrate = videoEncodingArgs("hevc_videotoolbox", { videoBitrate: "4M" });
  assert.deepEqual(bitrate.slice(-2), ["-b:v", "4M"]);
  for (const args of [quality, bitrate]) for (const forbidden of ["-crf", "-cq", "-preset"]) assert.ok(!args.includes(forbidden));
  assert.deepEqual(videoEncodingArgs("libx265", { cq: 28 }).slice(-2), ["-crf", "28"]);
  assert.deepEqual(videoEncodingArgs("hevc_nvenc", { cq: 28 }).slice(-2), ["-cq", "28"]);
});

test("Explicit unavailable hardware fails rather than silently changing the plan", () => {
  assert.throws(() => selectVideoEncoder({ hasEncoder: () => false }, "hevc_nvenc", "darwin"), /absent/u);
});

test("POSIX source hierarchy is case-sensitive; Windows hierarchy accepts case and slash differences", () => {
  assert.equal(pathIsWithin("/Volumes/Media/Film/part.mkv", "/Volumes/Media/Film"), true);
  assert.equal(pathIsWithin("/Volumes/media/Film/part.mkv", "/Volumes/Media/Film"), false);
  assert.equal(pathIsWithin("/Media/Film2/part.mkv", "/Media/Film"), false);
  assert.equal(pathIsWithin("E:/Film/part.mkv", "e:\\FILM"), true);
  assert.equal(comparablePath("/Media/Upper"), "/Media/Upper");
  assert.equal(sourceIsDescendant({ id: 2, relative_path: "Collection\\Member\\part.mkv", absolute_path: "/Media/Collection/Member/part.mkv" },
    { id: 1, relative_path: "Member", absolute_path: "/Media/Collection/Member" }), true);
});
