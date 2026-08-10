#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function usage() {
  console.log(`Usage:
  node scripts/remux-audio-variant.mjs --video-source <qc-passed-mp4> --audio-source <media>
    --audio-stream <ordinal> --output <mp4> [--audio-channels <count>] [--audio-loudnorm]
    [--audio-bitrate <rate>] [--max-bytes <bytes>] [--ffmpeg <path>]

The video stream is copied without re-encoding and tagged hvc1. The selected audio
ordinal is relative to audio streams in --audio-source (1:a:0, 1:a:1, ...), then
encoded to AAC. Use this only when picture and hard subtitles are identical across
variants. Different hard-subtitle variants require separate video encodes.
`);
}

function parseArgs(argv) {
  const options = {
    ffmpeg: "ffmpeg",
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
    "--ffmpeg"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--audio-loudnorm") options.audioLoudnorm = true;
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

function run(ffmpeg, args) {
  console.log(`remux-audio-variant: ${ffmpeg} ${args.map(value => JSON.stringify(value)).join(" ")}`);
  const result = spawnSync(ffmpeg, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed with exit code ${result.status}`);
}

function assertBrowserPlayableMp4(output) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,codec_tag_string,channels,channel_layout",
    "-of", "json", output
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe final output failed with exit code ${result.status}`);
  const streams = JSON.parse(result.stdout).streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
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
    "-c:v", "copy",
    "-tag:v", "hvc1",
    "-c:a", "aac",
    "-b:a", options.audioBitrate,
    ...audioChannels,
    "-movflags", "+faststart",
    part
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const videoSource = path.resolve(options.video_source);
  const audioSource = path.resolve(options.audio_source);
  const output = path.resolve(options.output);
  if (!fs.existsSync(videoSource)) throw new Error(`video source not found: ${videoSource}`);
  if (!fs.existsSync(audioSource)) throw new Error(`audio source not found: ${audioSource}`);
  if (path.extname(videoSource).toLowerCase() !== ".mp4") throw new Error("--video-source must be an .mp4 file");
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("--output must be an .mp4 file");
  if (videoSource.toLowerCase() === output.toLowerCase()) throw new Error("--output must differ from --video-source");

  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (availableBytes(path.dirname(output)) < options.maxBytes + 512 * 1024 * 1024) {
    throw new Error("insufficient output disk space for the remuxed audio variant");
  }
  const part = `${output.slice(0, -4)}.part.mp4`;
  fs.rmSync(part, { force: true });
  run(options.ffmpeg, buildFfmpegArgs(options, videoSource, audioSource, part));
  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  fs.renameSync(part, output);
  assertBrowserPlayableMp4(output);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
