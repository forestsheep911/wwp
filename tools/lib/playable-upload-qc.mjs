import { spawnSync } from "node:child_process";
import path from "node:path";

export function assertPlayableUploadProbe(probe, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const video = (probe?.streams ?? []).find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`Playable upload has no video stream: ${filePath}`);
  if (extension === ".mp4" && video.codec_name === "hevc" && video.codec_tag_string !== "hvc1") {
    throw new Error(
      `HEVC MP4 upload requires codec_tag_string=hvc1, found ${video.codec_tag_string || "missing"}: ${filePath}. `
      + "Losslessly remux with -map 0 -c copy -tag:v hvc1 -movflags +faststart, then probe again."
    );
  }
  return {
    videoCodec: video.codec_name,
    codecTag: video.codec_tag_string,
    container: probe?.format?.format_name
  };
}

export function probePlayableUpload(filePath, ffprobe = "ffprobe") {
  const result = spawnSync(ffprobe, [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,codec_tag_string:format=format_name",
    "-of", "json",
    filePath
  ], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error) throw new Error(`Unable to run ffprobe for playable upload: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ffprobe failed for playable upload ${filePath}: ${result.stderr.trim()}`);
  return assertPlayableUploadProbe(JSON.parse(result.stdout), filePath);
}
