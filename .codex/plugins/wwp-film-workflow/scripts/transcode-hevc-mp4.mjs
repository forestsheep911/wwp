#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage:
  node scripts/transcode-hevc-mp4.mjs --input <media> --output <mp4> --subtitle-stream <ordinal|none>
    [--subtitle-file <ass|ssa|srt>] [--subtitle-charenc <encoding>] [--audio-stream <ordinal>] [--audio-channels <count>] [--audio-loudnorm]
    [--duration <seconds>] [--cq <value>] [--video-bitrate <rate>]
    [--max-bytes <bytes>] [--scale <width>x<height>] [--tone-map-sdr]
    [--tone-map-libplacebo]

The subtitle ordinal is relative to subtitle streams (0:s:0, 0:s:1, ...), not the
absolute ffprobe stream index. Use "none" when subtitles are already burned into
the source video. Use --subtitle-file for ASS/SSA/SRT text subtitles; this routes through
the text-subtitle filter instead of the bitmap-subtitle overlay path. The encoder writes an MKV work
file first, then stream-copy remuxes it to MP4 with hvc1 after the encode succeeds.
Use --tone-map-sdr only for a source confirmed to be HDR or Dolby Vision. It converts
the video to BT.709 before NVENC encoding; ordinary SDR sources must not use it.
Use --tone-map-libplacebo with a libplacebo-enabled FFmpeg build for Dolby Vision
Profile 5 or faster GPU tone mapping. It implies --tone-map-sdr.
`);
}

function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", subtitleStream: null, subtitleFile: null, subtitleCharenc: null, audioStream: 0, audioChannels: null, audioLoudnorm: false, cq: 26, videoBitrate: null, maxBytes: 5_000_000_000, scale: null, toneMapSdr: false, toneMapLibplacebo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--audio-loudnorm") options.audioLoudnorm = true;
    else if (arg === "--tone-map-sdr") options.toneMapSdr = true;
    else if (arg === "--tone-map-libplacebo") {
      options.toneMapSdr = true;
      options.toneMapLibplacebo = true;
    }
    else if (["--input", "--output", "--subtitle-stream", "--subtitle-file", "--subtitle-charenc", "--audio-stream", "--audio-channels", "--duration", "--cq", "--video-bitrate", "--max-bytes", "--scale", "--ffmpeg"].includes(arg)) {
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
  options.subtitleCharenc = options.subtitle_charenc == null ? null : String(options.subtitle_charenc);
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

function probeVideoDimensions(input) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    input
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe failed with exit code ${result.status}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height)) {
    throw new Error("ffprobe could not determine input video dimensions");
  }
  return { width: stream.width, height: stream.height };
}

function probeSubtitleCodec(input, subtitleStream) {
  if (subtitleStream === null) return null;
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "s", "-show_entries", "stream=codec_name", "-of", "json", input
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe subtitle probe failed with exit code ${result.status}`);
  const stream = JSON.parse(result.stdout).streams?.[subtitleStream];
  if (!stream?.codec_name) throw new Error(`subtitle stream ${subtitleStream} is unavailable`);
  return stream.codec_name.toLowerCase();
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

function escapedSubtitlePath(value) {
  return value.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
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
  const extractedSubtitle = `${base}.embedded-subtitle.srt`;
  for (const file of [work, part, extractedSubtitle]) fs.rmSync(file, { force: true });
  assertOutputSpace(output, options.maxBytes, options.duration);

  const durationArgs = options.duration == null ? [] : ["-t", String(options.duration)];
  const sourceDimensions = probeVideoDimensions(input);
  const subtitleCodec = probeSubtitleCodec(input, options.subtitleStream);
  const embeddedTextSubtitle = options.subtitleStream !== null
    && new Set(["ass", "mov_text", "srt", "ssa", "subrip", "text", "webvtt"]).has(subtitleCodec);
  if (embeddedTextSubtitle) {
    // A bounded smoke test must not extract subtitles for the entire episode first.
    run(options.ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostats", "-y", "-i", input, ...durationArgs, "-map", `0:s:${options.subtitleStream}`, "-f", "srt", extractedSubtitle], "extract-text-subtitle");
  }
  const scaleFilter = options.scale == null
    ? null
    : `scale=${options.scale.width}:${options.scale.height}:force_original_aspect_ratio=decrease,pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const libplaceboDimensions = options.scale == null
    ? "w=iw:h=ih"
    : `w=${options.scale.width}:h=${options.scale.height}:fillcolor=black`;
  // Resize HDR sources on the GPU before the CPU tone-map path. Tone-mapping a
  // full 4K frame before reducing it to the delivery resolution is needlessly
  // slow; the final CPU pad keeps the requested canvas dimensions without
  // distorting sources whose aspect ratio differs from the target.
  const gpuHdrPreScale = options.toneMapSdr && options.scale != null
    ? `scale_cuda=w=${options.scale.width}:h=${options.scale.height}:force_original_aspect_ratio=decrease:format=p010,hwdownload,format=p010le`
    : null;
  const hdrPreScale = gpuHdrPreScale ?? scaleFilter ?? "null";
  const hdrPostScale = options.toneMapSdr && options.scale != null
    ? `,pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`
    : "";
  const baseVideo = options.toneMapLibplacebo
    ? `[0:v:0]format=yuv420p10le,hwupload,libplacebo=${libplaceboDimensions}:format=yuv420p10le:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:tonemapping=mobius:apply_dolbyvision=1,hwdownload,format=yuv420p10le,format=yuv420p[base]`
    : options.toneMapSdr
    ? `[0:v:0]${hdrPreScale},zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=primaries=bt709:transfer=bt709:matrix=bt709,format=yuv420p${hdrPostScale}[base]`
    : `[0:v:0]${scaleFilter ?? "null"}[base]`;
  const effectiveSubtitleFile = options.subtitleFile ?? (embeddedTextSubtitle ? extractedSubtitle : null);
  const subtitleFilePath = effectiveSubtitleFile == null ? null : escapedSubtitlePath(effectiveSubtitleFile);
  const subtitleFileFilter = subtitleFilePath == null ? null : `subtitles='${subtitleFilePath}'${options.subtitleCharenc == null ? "" : `:charenc=${options.subtitleCharenc}`}`;
  // PGS subtitle canvases are often 16:9 even when the movie image is wider.
  // Resize only the subtitle canvas: subtitles may live in the source letterbox,
  // while the video itself must keep its original aspect ratio.
  const bitmapSubtitleFilter = options.subtitleStream === null || embeddedTextSubtitle
    ? null
    : `[0:s:${options.subtitleStream}]scale=${options.scale?.width ?? sourceDimensions.width}:${options.scale?.height ?? sourceDimensions.height}[subs]`;
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
          `${baseVideo};${bitmapSubtitleFilter};[base][subs]overlay=shortest=1:format=auto[v]`,
          "-map", "[v]"
        ];
  const rateArgs = options.videoBitrate == null
    ? ["-cq", String(options.cq)]
    : ["-b:v", options.videoBitrate, "-maxrate", options.videoBitrate, "-bufsize", options.videoBitrate];
  const audioArgs = [
    ...(options.audioChannels == null ? [] : ["-ac", String(options.audioChannels)]),
    ...(options.audioLoudnorm ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : [])
  ];
  run(options.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
    ...(options.toneMapLibplacebo ? ["-init_hw_device", "vulkan=vk:0", "-filter_hw_device", "vk"] : []),
    ...(gpuHdrPreScale ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []),
    "-i", input,
    ...durationArgs,
    ...videoArgs, "-map", `0:a:${options.audioStream}`,
    "-c:v", "hevc_nvenc", "-preset", "p5", ...rateArgs,
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", ...audioArgs,
    "-shortest", work
  ], "encode-mkv");

  run(options.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", work,
    "-map", "0", "-c", "copy", "-tag:v", "hvc1", "-movflags", "+faststart", part
  ], "remux-mp4");

  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  fs.renameSync(part, output);
  fs.rmSync(work, { force: true });
  fs.rmSync(extractedSubtitle, { force: true });
  assertBrowserPlayableMp4(output);
  console.log(JSON.stringify({ output, bytes: size, maxBytes: options.maxBytes, duration: options.duration, subtitleStream: options.subtitleStream, subtitleFile: options.subtitleFile, audioStream: options.audioStream, audioChannels: options.audioChannels, audioLoudnorm: options.audioLoudnorm, scale: options.scale, videoBitrate: options.videoBitrate, toneMapSdr: options.toneMapSdr, toneMapLibplacebo: options.toneMapLibplacebo }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
