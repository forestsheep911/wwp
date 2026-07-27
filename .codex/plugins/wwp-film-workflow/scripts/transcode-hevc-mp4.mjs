#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage:
  node scripts/transcode-hevc-mp4.mjs --input <media> --output <mp4> --subtitle-stream <ordinal|none>
    [--subtitle-file <ass|ssa>] [--audio-stream <ordinal>] [--audio-channels <count>]
    [--duration <seconds>] [--cq <value>] [--video-bitrate <rate>]
    [--max-bytes <bytes>] [--scale <width>x<height>] [--tone-map-sdr]

The subtitle ordinal is relative to subtitle streams (0:s:0, 0:s:1, ...), not the
absolute ffprobe stream index. Use "none" when subtitles are already burned into
the source video. Use --subtitle-file for ASS/SSA subtitles; this routes through
libass instead of the bitmap-subtitle overlay path. The encoder writes an MKV work
file first, then stream-copy remuxes it to MP4 with hvc1 after the encode succeeds.
Use --tone-map-sdr only for a source confirmed to be HDR or Dolby Vision. It converts
the video to BT.709 before NVENC encoding; ordinary SDR sources must not use it.
`);
}

function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", subtitleStream: null, subtitleFile: null, audioStream: 0, audioChannels: null, cq: 26, videoBitrate: null, maxBytes: 5_000_000_000, scale: null, toneMapSdr: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--tone-map-sdr") options.toneMapSdr = true;
    else if (["--input", "--output", "--subtitle-stream", "--subtitle-file", "--audio-stream", "--audio-channels", "--duration", "--cq", "--video-bitrate", "--max-bytes", "--scale", "--ffmpeg"].includes(arg)) {
      const value = argv[++i];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replaceAll("-", "_");
      options[key] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.input || !options.output || (options.subtitle_stream == null && options.subtitle_file == null)) {
    throw new Error("--input, --output, and either --subtitle-stream or --subtitle-file are required");
  }
  options.subtitleStream = options.subtitle_stream == null || options.subtitle_stream.toLowerCase() === "none"
    ? null
    : Number(options.subtitle_stream);
  options.subtitleFile = options.subtitle_file == null ? null : path.resolve(options.subtitle_file);
  options.audioStream = options.audio_stream == null ? 0 : Number(options.audio_stream);
  options.audioChannels = options.audio_channels == null ? null : Number(options.audio_channels);
  options.duration = options.duration == null ? null : Number(options.duration);
  options.cq = options.cq == null ? 26 : Number(options.cq);
  options.videoBitrate = options.video_bitrate == null ? null : String(options.video_bitrate);
  options.maxBytes = options.max_bytes == null ? 5_000_000_000 : Number(options.max_bytes);
  if (options.scale != null) {
    const match = String(options.scale).match(/^(\d+)x(\d+)$/i);
    if (!match || Number(match[1]) < 2 || Number(match[2]) < 2) throw new Error("--scale must be WIDTHxHEIGHT");
    options.scale = { width: Number(match[1]), height: Number(match[2]) };
  }
  if ((options.subtitleStream !== null && !Number.isFinite(options.subtitleStream))
    || ![options.audioStream, options.cq, options.maxBytes].every(Number.isFinite)
    || (options.audioChannels !== null && (!Number.isInteger(options.audioChannels) || options.audioChannels < 1 || options.audioChannels > 8))) {
    throw new Error("stream ordinals, audio-channels, cq, and max-bytes must be valid numbers");
  }
  if (options.videoBitrate != null && !/^\d+(?:\.\d+)?[kKmMgG]$/.test(options.videoBitrate)) {
    throw new Error("--video-bitrate must be a value such as 3700k or 4M");
  }
  if (options.duration != null && (!Number.isFinite(options.duration) || options.duration <= 0)) {
    throw new Error("--duration must be a positive number");
  }
  return options;
}

function run(ffmpeg, args, label) {
  console.log(`${label}: ${ffmpeg} ${args.map(value => JSON.stringify(value)).join(" ")}`);
  const result = spawnSync(ffmpeg, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

function availableBytes(directory) {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function assertOutputSpace(output, maxBytes, duration) {
  // A full encode keeps the MKV work file and MP4 remux beside the final file.
  // Bounded samples are exempt because their actual size is duration-limited.
  if (duration != null) return;
  const required = maxBytes * 2 + 512 * 1024 * 1024;
  const available = availableBytes(path.dirname(output));
  if (available < required) {
    throw new Error(`insufficient output disk space: available=${available} required=${required}; choose another output path or free space`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  if (options.subtitleFile != null && !fs.existsSync(options.subtitleFile)) {
    throw new Error(`subtitle file not found: ${options.subtitleFile}`);
  }
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("output must be an .mp4 file");

  const base = output.slice(0, -4);
  const work = `${base}.work.mkv`;
  const part = `${base}.part.mp4`;
  for (const file of [work, part]) fs.rmSync(file, { force: true });
  assertOutputSpace(output, options.maxBytes, options.duration);

  const durationArgs = options.duration == null ? [] : ["-t", String(options.duration)];
  const scaleFilter = options.scale == null
    ? null
    : `scale=${options.scale.width}:${options.scale.height}:force_original_aspect_ratio=decrease,pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const baseVideo = options.toneMapSdr
    ? `[0:v:0]zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=primaries=bt709:transfer=bt709:matrix=bt709,${scaleFilter ?? "null"},format=yuv420p[base]`
    : `[0:v:0]${scaleFilter ?? "null"}[base]`;
  const subtitleFilePath = options.subtitleFile == null ? null
    : options.subtitleFile.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
  const subtitleFileFilter = subtitleFilePath == null ? null : `subtitles='${subtitleFilePath}'`;
  const videoArgs = subtitleFileFilter != null && !options.toneMapSdr && scaleFilter === null
    ? ["-vf", subtitleFileFilter, "-map", "0:v:0"]
    : subtitleFileFilter != null
      ? ["-filter_complex", `${baseVideo};[base]${subtitleFileFilter}[video]`, "-map", "[video]"]
      : options.subtitleStream === null && !options.toneMapSdr && scaleFilter === null
    ? ["-map", "0:v:0"]
    : options.subtitleStream === null
      ? ["-filter_complex", `${baseVideo};[base]null[video]`, "-map", "[video]"]
      : [
          "-filter_complex",
          `${baseVideo};[0:s:${options.subtitleStream}][base]scale2ref=w=iw:h=ih[subs][vid];[vid][subs]overlay=shortest=1:format=auto[v]`,
          "-map", "[v]"
        ];
  const rateArgs = options.videoBitrate == null
    ? ["-cq", String(options.cq)]
    : ["-b:v", options.videoBitrate, "-maxrate", options.videoBitrate, "-bufsize", options.videoBitrate];
  const audioArgs = options.audioChannels == null ? [] : ["-ac", String(options.audioChannels)];
  run(options.ffmpeg, [
    "-hide_banner", "-y", "-i", input,
    ...durationArgs,
    ...videoArgs, "-map", `0:a:${options.audioStream}`,
    "-c:v", "hevc_nvenc", "-preset", "p5", ...rateArgs,
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", ...audioArgs, work
  ], "encode-mkv");

  run(options.ffmpeg, [
    "-hide_banner", "-y", "-i", work,
    "-map", "0", "-c", "copy", "-tag:v", "hvc1", "-movflags", "+faststart", part
  ], "remux-mp4");

  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  fs.renameSync(part, output);
  fs.rmSync(work, { force: true });
  console.log(JSON.stringify({ output, bytes: size, maxBytes: options.maxBytes, duration: options.duration, subtitleStream: options.subtitleStream, subtitleFile: options.subtitleFile, audioStream: options.audioStream, audioChannels: options.audioChannels, scale: options.scale, videoBitrate: options.videoBitrate, toneMapSdr: options.toneMapSdr }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
