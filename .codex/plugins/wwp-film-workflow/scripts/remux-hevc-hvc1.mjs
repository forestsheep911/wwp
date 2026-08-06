#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function usage() {
  console.log(`Usage:
  node scripts/remux-hevc-hvc1.mjs --input <hev1-mp4> --output <hvc1-mp4>
    [--max-bytes <bytes>] [--ffmpeg <path>] [--ffprobe <path>]

Copies every stream without re-encoding, changes an HEVC MP4 video sample entry
from hev1 to hvc1, and writes atomically. The source is never modified.`);
}

function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", maxBytes: 5_000_000_000 };
  const valueOptions = new Set(["--input", "--output", "--max-bytes", "--ffmpeg", "--ffprobe"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (valueOptions.has(arg)) {
      const value = argv[++index];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.input || !options.output) throw new Error("--input and --output are required");
  options.maxBytes = Number(options.max_bytes ?? options.maxBytes);
  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) {
    throw new Error("--max-bytes must be a positive number");
  }
  return options;
}

function run(command, args, label) {
  console.log(`${label}: ${command} ${args.map(value => JSON.stringify(value)).join(" ")}`);
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}: ${result.stderr.trim()}`);
  return result.stdout;
}

function availableBytes(directory) {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function probe(ffprobe, input) {
  return JSON.parse(run(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_name,codec_tag_string,codec_type",
    "-of", "json", input
  ], "probe"));
}

export function assertHev1Mp4Probe(result, input) {
  const video = (result.streams ?? []).find(stream => stream.codec_type === "video");
  if (video?.codec_name !== "hevc") throw new Error(`input video is not HEVC: ${input}`);
  if (video.codec_tag_string !== "hev1") {
    throw new Error(`input HEVC MP4 must have codec_tag_string=hev1, found ${video.codec_tag_string || "missing"}: ${input}`);
  }
}

export function buildFfmpegArgs(input, part) {
  return [
    "-hide_banner", "-y", "-i", input,
    "-map", "0", "-c", "copy", "-tag:v", "hvc1", "-movflags", "+faststart", part
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);
  if (path.extname(input).toLowerCase() !== ".mp4" || path.extname(output).toLowerCase() !== ".mp4") {
    throw new Error("input and output must be .mp4 files");
  }
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("output must differ from input");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (availableBytes(path.dirname(output)) < fs.statSync(input).size + 512 * 1024 * 1024) {
    throw new Error("insufficient output disk space for lossless remux");
  }
  assertHev1Mp4Probe(probe(options.ffprobe, input), input);
  const part = `${output.slice(0, -4)}.part.mp4`;
  fs.rmSync(part, { force: true });
  run(options.ffmpeg, buildFfmpegArgs(input, part), "remux-hvc1");
  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  const outputProbe = probe(options.ffprobe, part);
  const outputVideo = (outputProbe.streams ?? []).find(stream => stream.codec_type === "video");
  if (outputVideo?.codec_name !== "hevc" || outputVideo.codec_tag_string !== "hvc1") {
    fs.rmSync(part, { force: true });
    throw new Error(`remux did not produce HEVC hvc1 output: ${output}`);
  }
  fs.renameSync(part, output);
  console.log(JSON.stringify({ input, output, bytes: size, maxBytes: options.maxBytes, videoCodec: outputVideo.codec_name, codecTag: outputVideo.codec_tag_string }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
