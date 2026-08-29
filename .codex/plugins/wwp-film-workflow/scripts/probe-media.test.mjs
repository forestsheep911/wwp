import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferredClipInfoPath, parseClipInfoPgsTracks } from "./probe-media.mjs";

test("parses PGS language descriptors from Blu-ray CLPI", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wwp-clpi-"));
  try {
    const clip = path.join(root, "00005.clpi");
    const bytes = Buffer.alloc(128);
    Buffer.from([0x12, 0xa0, 0x15, 0x90]).copy(bytes, 20);
    bytes.write("eng", 24, "ascii");
    Buffer.from([0x12, 0xa1, 0x15, 0x90]).copy(bytes, 44);
    bytes.write("zho", 48, "ascii");
    Buffer.from([0x11, 0x00, 0x15, 0x83, 0x61]).copy(bytes, 68);
    bytes.write("eng", 73, "ascii");
    Buffer.from([0x11, 0x01, 0x15, 0x81, 0x61]).copy(bytes, 92);
    bytes.write("zho", 97, "ascii");
    writeFileSync(clip, bytes);
    assert.deepEqual(parseClipInfoPgsTracks(clip).pgsTracks, [
      { pid: "0x12a0", language: "eng" },
      { pid: "0x12a1", language: "zho" }
    ]);
    assert.deepEqual(parseClipInfoPgsTracks(clip).audioTracks, [
      { pid: "0x1100", codec: "truehd", language: "eng" },
      { pid: "0x1101", codec: "ac3", language: "zho" }
    ]);
    assert.equal(parseClipInfoPgsTracks(clip).hasChineseSubtitle, true);
    assert.equal(parseClipInfoPgsTracks(clip).hasEnglishAudio, true);
    assert.equal(parseClipInfoPgsTracks(clip).hasChineseAudio, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("infers the matching CLIPINF path from a BDMV stream", () => {
  assert.match(
    inferredClipInfoPath("D:/disc/BDMV/STREAM/00005.m2ts").replaceAll("\\", "/"),
    /BDMV\/CLIPINF\/00005\.clpi$/u
  );
  assert.equal(inferredClipInfoPath("D:/video/movie.mkv"), undefined);
});
