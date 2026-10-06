#!/usr/bin/env node

import { assertStoragePath, resolveMediaTools } from "../../../../tools/lib/film-media-runtime.mjs";
import fs from "node:fs";
import { claimEncodeJob, runMedia, publishEncodedFile } from "../../../../tools/lib/film-encode-job.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function usage() {
  console.log(`Usage:
  node scripts/remux-audio-variant.mjs --video-source <qc-passed-mp4> --audio-source <media>
    --audio-stream <ordinal> --output <mp4> [--audio-channels <count>] [--audio-loudnorm]
    [--audio-bitrate <rate>] [--restart-work] [--recover-lock] [--max-bytes <bytes>] [--ffmpeg <path>] [--ffprobe <path>]

The video stream is copied without re-encoding and tagged hvc1. The selected audio
ordinal is relative to audio streams in --audio-source (1:a:0, 1:a:1, ...), then
encoded to AAC. Use this only when picture and hard subtitles are identical across
variants. Different hard-subtitle variants require separate video encodes.
`);
}

function parseArgs(argv) {
  const options = {
    ffmpeg: null,
    audioChannels: null,
    audioLoudnorm: false,
    audioBitrate: "256k",
    maxBytes: 5_000_000_000
  };
  const values = new Set([
    "--video-source",
    "--audio-source",
    "--audio-stream",
    "--output",
    "--audio-channels",
    "--audio-bitrate",
    "--max-bytes",
    "--ffmpeg",
    "--ffprobe"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--audio-loudnorm") options.audioLoudnorm = true;
    else if (arg === "--restart-work") options.restart = true;
    else if (arg === "--recover-lock") options.recoverLock = true;
    else if (values.has(arg)) {
      const value = argv[++index];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.help) return options;
  for (const [key, flag] of [
    ["video_source", "--video-source"],
    ["audio_source", "--audio-source"],
    ["audio_stream", "--audio-stream"],
    ["output", "--output"]
  ]) {
    if (options[key] == null) throw new Error(`${flag} is required`);
  }
  options.audioStream = Number(options.audio_stream);
  options.audioChannels = options.audio_channels == null ? null : Number(options.audio_channels);
  options.maxBytes = Number(options.max_bytes ?? options.maxBytes);
  options.audioBitrate = String(options.audio_bitrate ?? options.audioBitrate);
  if (!Number.isInteger(options.audioStream) || options.audioStream < 0) {
    throw new Error("--audio-stream must be a non-negative integer");
  }
  if (options.audioChannels !== null
    && (!Number.isInteger(options.audioChannels) || options.audioChannels < 1 || options.audioChannels > 8)) {
    throw new Error("--audio-channels must be an integer between 1 and 8");
  }
  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) {
    throw new Error("--max-bytes must be a positive number");
  }
  if (!/^\d+(?:\.\d+)?[kKmM]$/u.test(options.audioBitrate)) {
    throw new Error("--audio-bitrate must be a value such as 256k");
  }
  return options;
}

function assertBrowserPlayableMp4(output, ffprobe) {
  const result = spawnSync(ffprobe, [
    "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,codec_tag_string,channels,channel_layout,duration",
    "-of", "json", output
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe final output failed with exit code ${result.status}`);
  const streams = JSON.parse(result.stdout).streams ?? [];
  const unexpected = streams.filter((stream) => !["video", "audio"].includes(stream.codec_type));
  if (unexpected.length > 0) {
    throw new Error(`final MP4 contains unexpected stream types: ${unexpected.map((stream) => stream.codec_type).join(", ")}`);
  }
  const video = streams.find((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter(stream => stream.codec_type === "audio");
  if (video?.codec_name !== "hevc" || audioStreams.length !== 1 || audioStreams[0].codec_name !== "aac") {
    throw new Error("audio variant must contain HEVC video and one AAC audio stream");
  }
  if (!Number.isFinite(Number(video.duration)) || !Number.isFinite(Number(audioStreams[0].duration))
    || Math.abs(Number(video.duration) - Number(audioStreams[0].duration)) > 2) {
    throw new Error("audio variant video/audio durations differ or are unavailable; verify matching source timelines");
  }
  if (video?.codec_name === "hevc" && video.codec_tag_string !== "hvc1") {
    throw new Error("final HEVC MP4 is missing the required hvc1 sample entry");
  }
  for (const audio of streams.filter((stream) => stream.codec_type === "audio" && stream.codec_name === "aac")) {
    if ((audio.channels ?? 0) > 2 && !audio.channel_layout) {
      throw new Error("final multichannel AAC track is missing channel_layout; browser playback is not safe");
    }
  }
}

function availableBytes(directory) {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function buildFfmpegArgs(options, videoSource, audioSource, part) {
  const audioChannels = [
    ...(options.audioChannels == null ? [] : ["-ac", String(options.audioChannels)]),
    ...(options.audioLoudnorm ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : [])
  ];
  return [
    "-hide_banner",
    "-y",
    "-i", videoSource,
    "-i", audioSource,
    "-map", "0:v:0",
    "-map", `1:a:${options.audioStream}`,
    "-map_chapters", "-1",
    "-c:v", "copy",
    "-tag:v", "hvc1",
    "-c:a", "aac",
    "-b:a", options.audioBitrate,
    ...audioChannels,
    "-movflags", "+faststart",
    part
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  Object.assign(options, resolveMediaTools(options));
  const videoSource = assertStoragePath(options.video_source);
  const audioSource = assertStoragePath(options.audio_source);
  const output = assertStoragePath(options.output);
  if (!fs.existsSync(videoSource)) throw new Error(`video source not found: ${videoSource}`);
  if (!fs.existsSync(audioSource)) throw new Error(`audio source not found: ${audioSource}`);
  if (path.extname(videoSource).toLowerCase() !== ".mp4") throw new Error("--video-source must be an .mp4 file");
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("--output must be an .mp4 file");
  if (videoSource.toLowerCase() === output.toLowerCase()) throw new Error("--output must differ from --video-source");

  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (availableBytes(path.dirname(output)) < 2 * options.maxBytes + 512 * 1024 * 1024) {
    throw new Error("insufficient output disk space for the remuxed audio variant");
  }
  const job = claimEncodeJob(output, path.dirname(output), { sources: [videoSource, audioSource].map(file => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs })), options: Object.fromEntries(Object.entries(options).filter(([key]) => !["restart", "recoverLock"].includes(key))) }, options);
  try {
  const part = path.join(job.directory, "delivery.part.mp4");
  await runMedia(options.ffmpeg, ["-progress", "pipe:1", ...buildFfmpegArgs(options, videoSource, audioSource, part)], "remux-audio-variant", job);
  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  assertBrowserPlayableMp4(part, options.ffprobe);
  await publishEncodedFile(part, output, size);
  job.save("published");
  console.log(JSON.stringify({
    output,
    bytes: size,
    maxBytes: options.maxBytes,
    videoSource,
    audioSource,
    audioStream: options.audioStream,
    audioChannels: options.audioChannels,
    audioLoudnorm: options.audioLoudnorm,
    audioBitrate: options.audioBitrate
  }));
  } finally { job.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
