import test from "node:test";
import assert from "node:assert/strict";
import { assertPlayableUploadProbe } from "./playable-upload-qc.mjs";

function probe(codecName, codecTag) {
  return {
    streams: [{ codec_type: "video", codec_name: codecName, codec_tag_string: codecTag }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" }
  };
}

test("accepts hvc1 HEVC MP4 uploads", () => {
  assert.deepEqual(
    assertPlayableUploadProbe(probe("hevc", "hvc1"), "episode.mp4"),
    { videoCodec: "hevc", codecTag: "hvc1", container: "mov,mp4,m4a,3gp,3g2,mj2" }
  );
});

test("rejects hev1 HEVC MP4 uploads before transfer", () => {
  assert.throws(
    () => assertPlayableUploadProbe(probe("hevc", "hev1"), "episode.mp4"),
    /requires codec_tag_string=hvc1, found hev1/
  );
});

test("does not impose the HEVC MP4 tag rule on H.264 or MKV", () => {
  assert.doesNotThrow(() => assertPlayableUploadProbe(probe("h264", "avc1"), "movie.mp4"));
  assert.doesNotThrow(() => assertPlayableUploadProbe(probe("hevc", "hev1"), "source.mkv"));
});

test("rejects files without a video stream", () => {
  assert.throws(
    () => assertPlayableUploadProbe({ streams: [{ codec_type: "audio", codec_name: "aac" }] }, "audio.mp4"),
    /no video stream/
  );
});
