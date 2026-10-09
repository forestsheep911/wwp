#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { resolveMediaTools, selectVideoEncoder, videoEncodingArgs, assertStoragePath, assertVolumeSpace, capture, storageIdentity } from "../../../../tools/lib/film-media-runtime.mjs";
import { claimEncodeJob, runMedia, publishEncodedFile } from "../../../../tools/lib/film-encode-job.mjs";
import { repairAssFonts } from "../../../../tools/lib/film-ass-fonts.mjs";

let activeJob;
let probeBinary = "ffprobe";

function usage() {
  console.log(`Usage:
  node scripts/transcode-hevc-mp4.mjs --input <media> --output <mp4> --video-stream <ordinal> --subtitle-stream <ordinal|none>
    [--subtitle-file <ass|ssa|srt>] [--subtitle-charenc <encoding>] [--subtitle-margin-v <pixels>] [--audio-stream <ordinal>] [--audio-channels <count>] [--audio-language <code>] [--audio-loudnorm]
    [--split-audio]
    [--start <seconds>] [--duration <seconds>] [--cq <value>] [--video-bitrate <rate>] [--video-frame-rate <numerator/denominator>]
    [--video-encoder <auto|hevc_nvenc|hevc_videotoolbox|libx265>]
    [--vt-quality <1..100>] [--ffmpeg <path>] [--ffprobe <path>]
    [--fonts-dir <directory>] [--subtitle-font <family>]
    [--resume | --restart-work] [--recover-lock]
    [--allow-decoder-recovery]
    [--max-bytes <bytes>] [--temp-dir <directory>] [--scale <width>x<height>] [--tone-map-sdr]
    [--tone-map-libplacebo] [--cpu-tone-map]

The subtitle ordinal is relative to subtitle streams (0:s:0, 0:s:1, ...), not the
absolute ffprobe stream index. Use "none" when subtitles are already burned into
the source video. Use --subtitle-file for ASS/SSA/SRT text subtitles; this routes through
  the text-subtitle filter instead of the bitmap-subtitle overlay path. Use
--subtitle-margin-v only when verified source graphics/subtitles overlap the
default subtitle position, and inspect a dialogue sample afterward. The encoder writes an MKV work
file first, then stream-copy remuxes it to MP4 with hvc1 after the encode succeeds.
Use --split-audio when decoding the selected source audio in the video pipeline
causes severe slowdown. It encodes the complete video and audio independently,
then muxes both without -shortest so the video stream is never truncated.
Use --tone-map-sdr only for a source confirmed to be HDR or Dolby Vision. It converts
the video to BT.709 before encoding; ordinary SDR sources must not use it.
Use --tone-map-libplacebo with a libplacebo-enabled FFmpeg build for Dolby Vision
Profile 5 or faster GPU tone mapping. It implies --tone-map-sdr.
Use --cpu-tone-map when CUDA pre-scaling or Vulkan/libplacebo is unavailable, or
when a smoke sample shows a hardware color-path problem. It keeps the same
BT.709 tone-map path but performs the HDR resize on the CPU.
`);
}

function parseArgs(argv) {
  const options = { ffmpeg: null, ffprobe: null, videoStream: 0, subtitleStream: null, subtitleFile: null, subtitleCharenc: null, subtitleMarginV: null, audioStream: 0, audioChannels: null, audioLanguage: null, audioLoudnorm: false, splitAudio: false, videoEncoder: "auto", videoFrameRate: null, allowDecoderRecovery: false, cq: 26, videoBitrate: null, maxBytes: 5_000_000_000, tempDir: null, scale: null, start: null, toneMapSdr: false, toneMapLibplacebo: false, cpuToneMap: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--restart-work") options.restart = true;
    else if (arg === "--recover-lock") options.recoverLock = true;
    else if (arg === "--audio-loudnorm") options.audioLoudnorm = true;
    else if (arg === "--split-audio") options.splitAudio = true;
    else if (arg === "--tone-map-sdr") options.toneMapSdr = true;
    else if (arg === "--tone-map-libplacebo") {
      options.toneMapSdr = true;
      options.toneMapLibplacebo = true;
    }
    else if (arg === "--cpu-tone-map") {
      options.cpuToneMap = true;
      options.toneMapSdr = true;
    }
    else if (arg === "--allow-decoder-recovery") options.allowDecoderRecovery = true;
    else if (["--input", "--output", "--video-stream", "--subtitle-stream", "--subtitle-file", "--subtitle-charenc", "--subtitle-margin-v", "--audio-stream", "--audio-channels", "--audio-language", "--start", "--duration", "--cq", "--video-bitrate", "--video-frame-rate", "--video-encoder", "--max-bytes", "--temp-dir", "--scale", "--ffmpeg", "--ffprobe", "--fonts-dir", "--subtitle-font", "--vt-quality"].includes(arg)) {
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
  options.subtitleMarginV = options.subtitle_margin_v == null ? null : Number(options.subtitle_margin_v);
  options.tempDir = options.temp_dir == null ? null : path.resolve(options.temp_dir);
  options.audioStream = options.audio_stream == null ? 0 : Number(options.audio_stream);
  options.videoStream = options.video_stream == null ? 0 : Number(options.video_stream);
  options.audioChannels = options.audio_channels == null ? null : Number(options.audio_channels);
  options.audioLanguage = options.audio_language == null ? null : String(options.audio_language).toLowerCase();
  options.start = options.start == null ? null : Number(options.start);
  options.duration = options.duration == null ? null : Number(options.duration);
  options.cq = options.cq == null ? 26 : Number(options.cq);
  options.videoBitrate = options.video_bitrate == null ? null : String(options.video_bitrate);
  options.videoFrameRate = options.video_frame_rate == null ? null : String(options.video_frame_rate);
  options.videoEncoder = options.video_encoder == null ? "auto" : String(options.video_encoder);
  if (!["auto", "hevc_nvenc", "hevc_videotoolbox", "libx265"].includes(options.videoEncoder)) {
    throw new Error("--video-encoder must be auto, hevc_nvenc, hevc_videotoolbox or libx265");
  }
  if (options.resume && options.restart) throw new Error("--resume and --restart-work are mutually exclusive");
  options.vtQuality = Number(options.vt_quality ?? 65);
  if (!Number.isFinite(options.vtQuality) || options.vtQuality < 1 || options.vtQuality > 100) throw new Error("--vt-quality must be between 1 and 100");
  options.fontsDir = options.fonts_dir == null ? null : path.resolve(options.fonts_dir);
  options.subtitleFont = options.subtitle_font ?? null;
  if (options.subtitleFont && !/^[\p{L}\p{N} ._-]+$/u.test(options.subtitleFont)) throw new Error("invalid --subtitle-font family");
  options.maxBytes = options.max_bytes == null ? 5_000_000_000 : Number(options.max_bytes);
  if (options.scale != null) {
    const match = String(options.scale).match(/^(\d+)x(\d+)$/i);
    if (!match || Number(match[1]) < 2 || Number(match[2]) < 2 || Number(match[1]) % 2 || Number(match[2]) % 2) throw new Error("--scale must be even WIDTHxHEIGHT (at least 2x2)");
    options.scale = { width: Number(match[1]), height: Number(match[2]) };
  }
  if ((options.subtitleStream !== null && (!Number.isInteger(options.subtitleStream) || options.subtitleStream < 0))
    || !Number.isInteger(options.videoStream) || options.videoStream < 0
    || !Number.isInteger(options.audioStream) || options.audioStream < 0
    || ![options.cq, options.maxBytes].every(Number.isFinite) || options.maxBytes <= 0 || options.cq < 0 || options.cq > 51
    || (options.start !== null && !Number.isFinite(options.start))
    || (options.audioChannels !== null && (!Number.isInteger(options.audioChannels) || options.audioChannels < 1 || options.audioChannels > 8))) {
    throw new Error("stream ordinals, audio-channels, cq, and max-bytes must be valid numbers");
  }
  if (options.videoBitrate != null && !/^\d+(?:\.\d+)?[kKmMgG]$/.test(options.videoBitrate)) {
    throw new Error("--video-bitrate must be a value such as 3700k or 4M");
  }
  if (options.videoFrameRate != null && !/^\d+\/\d+$/.test(options.videoFrameRate)) {
    throw new Error("--video-frame-rate must be a rational value such as 24000/1001");
  }
  if (options.videoFrameRate != null && options.videoFrameRate.split("/").some((part) => Number(part) <= 0)) {
    throw new Error("--video-frame-rate numerator and denominator must be positive");
  }
  if (options.subtitleMarginV != null && (!Number.isInteger(options.subtitleMarginV) || options.subtitleMarginV < 0 || options.subtitleMarginV > 1000)) {
    throw new Error("--subtitle-margin-v must be an integer from 0 to 1000 pixels");
  }
  if (options.audioLanguage != null && !/^[a-z]{3}$/u.test(options.audioLanguage)) {
    throw new Error("--audio-language must be a three-letter ISO 639-2 code such as eng or zho");
  }
  if (options.duration != null && (!Number.isFinite(options.duration) || options.duration <= 0)) {
    throw new Error("--duration must be a positive number");
  }
  if (options.start != null && options.start < 0) {
    throw new Error("--start must be zero or a positive number");
  }
  return options;
}

let boundedJobTimeoutMs = 0;

async function run(ffmpeg, args, label, onProgress) {
  return runMedia(ffmpeg, args, label, activeJob, { onProgress, timeoutMs: boundedJobTimeoutMs });
}

function smokeFailureArgs(duration, allowDecoderRecovery = false) {
  // A bounded smoke sample is a gate, not a best-effort preview. FFmpeg can
  // otherwise exit 0 after recovering from decoder errors and leave a green
  // or otherwise invalid sample that looks superficially complete.
  return duration == null || allowDecoderRecovery ? [] : ["-xerror"];
}

let sourceInput, sourceProbeCache;
function probeMedia(input) {
  if (input === sourceInput && sourceProbeCache) return sourceProbeCache;
  const probe = JSON.parse(capture(probeBinary, ["-v", "error", "-show_streams", "-show_format", "-of", "json", input]));
  if (input === sourceInput) sourceProbeCache = probe;
  return probe;
}

function selectedStream(input, type, ordinal) {
  return (probeMedia(input).streams ?? []).filter(stream => stream.codec_type === type)[ordinal];
}

function probeVideoDimensions(input, videoStream) {
  const stream = selectedStream(input, "video", videoStream);
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height)) {
    throw new Error("ffprobe could not determine input video dimensions");
  }
  return { width: stream.width, height: stream.height };
}

function probeVideoFrameRate(input, videoStream) {
  const stream = selectedStream(input, "video", videoStream);
  for (const value of [stream?.avg_frame_rate, stream?.r_frame_rate]) {
    const match = String(value ?? "").match(/^(\d+)\/(\d+)$/u);
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return `${match[1]}/${match[2]}`;
  }
  throw new Error("ffprobe could not determine the selected video's frame rate");
}

function probeAudioChannels(input, audioStream) {
  const channels = Number(selectedStream(input, "audio", audioStream)?.channels);
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new Error("ffprobe could not determine the selected audio channel count");
  }
  return channels;
}

function audioBitrateForChannels(channels) {
  if (channels >= 7) return "768k";
  if (channels >= 3) return "512k";
  return "256k";
}

function probeMediaDurations(input, videoStream) {
  const probe = probeMedia(input);
  const videos = (probe.streams ?? []).filter((stream) => stream.codec_type === "video");
  const audios = (probe.streams ?? []).filter((stream) => stream.codec_type === "audio");
  const sourceVideo = videos[videoStream];
  const videoDuration = Number(sourceVideo?.duration ?? probe.format?.duration);
  const audioDurations = audios.map((stream) => Number(stream.duration)).filter(Number.isFinite);
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    throw new Error("ffprobe could not determine the media duration");
  }
  return { videoDuration, audioDurations };
}

function assertDeliveryDurations(input, output, videoStream, start, duration) {
  const source = probeMediaDurations(input, videoStream);
  const delivery = probeMediaDurations(output, 0);
  const expected = duration ?? Math.max(0, source.videoDuration - (start ?? 0));
  const toleranceSeconds = 2;
  if (Math.abs(delivery.videoDuration - expected) > toleranceSeconds) {
    throw new Error(`output video duration mismatch: expected about ${expected.toFixed(3)}s, got ${delivery.videoDuration.toFixed(3)}s`);
  }
  for (const audioDuration of delivery.audioDurations) {
    if (Math.abs(delivery.videoDuration - audioDuration) > toleranceSeconds) {
      throw new Error(`output audio/video duration mismatch: video=${delivery.videoDuration.toFixed(3)}s audio=${audioDuration.toFixed(3)}s`);
    }
  }
}

function probeSubtitleCodec(input, subtitleStream) {
  if (subtitleStream === null) return null;
  const stream = selectedStream(input, "subtitle", subtitleStream);
  if (!stream?.codec_name) throw new Error(`subtitle stream ${subtitleStream} is unavailable`);
  return stream.codec_name.toLowerCase();
}

function assertBrowserPlayableMp4(output, expectSdr = false) {
  const result = spawnSync(probeBinary, [
    "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,codec_tag_string,channels,channel_layout,color_space,color_transfer,color_primaries,color_range",
    "-of", "json", output
  ], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe final output failed with exit code ${result.status}`);
  const streams = JSON.parse(result.stdout).streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (expectSdr && (video?.color_space !== "bt709" || video?.color_transfer !== "bt709"
    || video?.color_primaries !== "bt709" || video?.color_range !== "tv")) {
    throw new Error("HDR-to-SDR output must carry BT.709 primaries/transfer/matrix and limited range");
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

async function prepareSubtitleFonts(input, options, directory) {
  const fonts = path.join(directory, "fonts");
  fs.mkdirSync(fonts, { recursive: true });
  if (options.fontsDir) {
    for (const entry of fs.readdirSync(options.fontsDir, { withFileTypes: true })) {
      if (entry.isFile() && /\.(ttf|otf|ttc)$/iu.test(entry.name)) {
        fs.copyFileSync(path.join(options.fontsDir, entry.name), path.join(fonts, `user-${fs.readdirSync(fonts).length}${path.extname(entry.name)}`));
      }
    }
  }
  if (process.platform === "darwin") {
    const fallback = "/System/Library/Fonts/STHeiti Medium.ttc";
    if (!fs.existsSync(fallback)) throw new Error("Chinese fallback font is unavailable; provide --fonts-dir and --subtitle-font");
    fs.copyFileSync(fallback, path.join(fonts, "fallback.ttc"));
    const latin = "/System/Library/Fonts/Supplemental/Arial.ttf";
    if (fs.existsSync(latin)) fs.copyFileSync(latin, path.join(fonts, "latin.ttf"));
    // macOS reserved PingFangUI fonts are not readable by FreeType. Limit
    // fontconfig to staged, readable fonts while retaining embedded ASS fonts.
    fs.mkdirSync(path.join(fonts, "cache"), { recursive: true });
    fs.writeFileSync(path.join(directory, "fontconfig.xml"), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir prefix="relative">fonts</dir><cachedir prefix="relative">fonts/cache</cachedir>
<alias><family>sans-serif</family><prefer><family>Arial</family><family>STHeiti</family></prefer></alias>
</fontconfig>\n`);
  }
  const streams = (probeMedia(input).streams ?? []).filter(stream => stream.codec_type === "attachment");
  for (const stream of streams) {
    const ext = path.extname(stream.tags?.filename ?? "").toLowerCase();
    if (![".ttf", ".otf", ".ttc"].includes(ext)) continue;
    const target = path.join(fonts, `attachment-${stream.index}${ext}`);
    if (fs.existsSync(target)) continue;
    await run(options.ffmpeg, ["-v", "error", "-dump_attachment:" + stream.index, target, "-i", input, "-t", "0", "-f", "null", "-"], "extract-font");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  boundedJobTimeoutMs = options.duration == null ? 0 : Math.max(180_000, options.duration * 10_000);
  if (options.help) {
    usage();
    return;
  }
  const input = assertStoragePath(options.input);
  const output = assertStoragePath(options.output);
  sourceInput = input;
  const runtime = resolveMediaTools(options);
  options.ffmpeg = runtime.ffmpeg;
  options.ffprobe = runtime.ffprobe;
  probeBinary = runtime.ffprobe;
  options.videoEncoder = selectVideoEncoder(runtime, options.videoEncoder);
  if (options.videoEncoder === "hevc_videotoolbox" && options.cq !== 26 && !options.videoBitrate) {
    throw new Error("Apple quality is independent of CQ/CRF; use --vt-quality or --video-bitrate");
  }
  if (options.subtitleFile != null && !fs.existsSync(options.subtitleFile)) {
    throw new Error(`subtitle file not found: ${options.subtitleFile}`);
  }
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("output must be an .mp4 file");

  const tempDir = assertStoragePath(options.tempDir ?? process.env.WWP_TEMP_ROOT ?? path.dirname(output));
  fs.mkdirSync(tempDir, { recursive: true });
  assertVolumeSpace(tempDir, path.dirname(output), options.maxBytes, options.duration);
  const subtitleCodec = probeSubtitleCodec(input, options.subtitleStream);
  const embeddedTextSubtitle = options.subtitleStream !== null
    && new Set(["ass", "mov_text", "srt", "ssa", "subrip", "text", "webvtt"]).has(subtitleCodec);
  if ((options.subtitleFile || embeddedTextSubtitle) && !runtime.hasFilter("subtitles")) {
    throw new Error("FFmpeg lacks libass subtitles filter; configure WWP_FFMPEG/--ffmpeg to a full build");
  }
  if (options.toneMapSdr && !options.toneMapLibplacebo && (!runtime.hasFilter("zscale") || !runtime.hasFilter("tonemap"))) {
    throw new Error("HDR-to-SDR requires zscale and tonemap filters in the chosen FFmpeg build");
  }
  if (options.toneMapLibplacebo) {
    if (!runtime.hasFilter("libplacebo")) throw new Error("FFmpeg lacks libplacebo");
    capture(options.ffmpeg, ["-v", "error", "-init_hw_device", "vulkan=vk:0", "-f", "lavfi", "-i", "color=s=128x128:d=0.1", "-f", "null", "-"]);
  }
  if (options.toneMapSdr && !options.toneMapLibplacebo && !runtime.hasFilter("scale_cuda")) options.cpuToneMap = true;
  const selectedVideo = selectedStream(input, "video", options.videoStream);
  const dv = selectedVideo?.side_data_list?.find(item => item.dv_profile != null);
  if (dv?.dv_profile === 5 && !options.toneMapLibplacebo) throw new Error("Dolby Vision Profile 5 requires a verified DV-aware color path; CPU PQ tone mapping is unsafe");
  if ((selectedVideo?.color_transfer === "smpte2084" || selectedVideo?.color_transfer === "arib-std-b67" || dv) && !options.toneMapSdr) {
    throw new Error("HDR/Dolby Vision source requires an explicit verified HDR-to-SDR plan");
  }
  const sourceStat = fs.statSync(input);
  const subtitleStat = options.subtitleFile ? fs.statSync(options.subtitleFile) : null;
  const colorPipeline = {
    source: Object.fromEntries(["color_space", "color_transfer", "color_primaries", "color_range"].map(key => [key, selectedVideo?.[key] ?? "unknown"])),
    toneMapping: options.toneMapSdr ? (options.toneMapLibplacebo ? "mobius" : "hable") : "none",
    output: options.toneMapSdr ? "BT.709 limited-range 8-bit" : "source colorimetry, 8-bit",
    dither: options.toneMapSdr ? "ordered" : "unchanged"
  };
  const plan = { input, output, colorPipeline, sourceBytes: sourceStat.size, sourceMtime: sourceStat.mtimeMs,
    subtitleBytes: subtitleStat?.size, subtitleMtime: subtitleStat?.mtimeMs,
    options: Object.fromEntries(Object.entries(options).filter(([key]) => !["resume", "restart", "recoverLock"].includes(key))),
    toolVersion: runtime.version, mounts: [input, output, tempDir].map(storageIdentity) };
  activeJob = claimEncodeJob(output, tempDir, plan, options);
  let awake;
  try {
  if (process.platform === "darwin") awake = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  const work = path.join(activeJob.directory, "video.work.mkv");
  const audioWork = path.join(activeJob.directory, "audio.work.m4a");
  const part = path.join(activeJob.directory, "delivery.part.mp4");
  const extractedSubtitle = path.join(activeJob.directory, ["ass", "ssa"].includes(subtitleCodec) ? "subtitle.ass" : "subtitle.srt");
  const resumeStage = activeJob.state.stage;
  if (options.resume && !["video_complete", "audio_complete", "remux_complete"].includes(resumeStage)) {
    throw new Error("The interrupted encode has no complete checkpoint; preserve its log and use --restart-work");
  }
  if (options.resume && !fs.existsSync(work)) throw new Error("Retained checkpoint video is missing");
  if (options.resume) {
    assertDeliveryDurations(input, work, options.videoStream, options.start, options.duration);
    await run(options.ffmpeg, ["-v", "error", "-xerror", "-i", work, "-t", "3", "-f", "null", "-"], "checkpoint-decode-check");
  }

  const seekArgs = options.start == null ? [] : ["-ss", String(options.start)];
  const durationArgs = options.duration == null ? [] : ["-t", String(options.duration)];
  const sourceDimensions = probeVideoDimensions(input, options.videoStream);
  const sourceFrameRate = options.videoFrameRate ?? probeVideoFrameRate(input, options.videoStream);
  const sourceAudioChannels = probeAudioChannels(input, options.audioStream);
  const audioBitrate = audioBitrateForChannels(options.audioChannels ?? sourceAudioChannels);
  const rebuildTimeline = `setpts=N/(${sourceFrameRate}*TB)`;

  // FFmpeg rebases input timestamps by default because this command does not
  // use -copyts. The bitmap subtitle filter must stay on that same zero-based
  // timeline as the video rebuilt below.
  const bitmapSubtitleOffset = 0;
  if (embeddedTextSubtitle && !options.resume) {
    // A bounded smoke test must not extract subtitles for the entire episode first.
    await run(options.ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostats", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y", ...seekArgs, "-i", input, ...durationArgs, "-map", `0:s:${options.subtitleStream}`, "-c:s", ["ass", "ssa"].includes(subtitleCodec) ? "ass" : "srt", extractedSubtitle], "extract-text-subtitle");
  }
  const resizeFilter = options.scale == null ? null
    : `scale=${options.scale.width}:${options.scale.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const scaleFilter = resizeFilter == null ? null
    : `${resizeFilter},pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const libplaceboDimensions = options.scale == null
    ? "w=iw:h=ih"
    : `w=${options.scale.width}:h=${options.scale.height}:fillcolor=black`;
  // Resize HDR sources on the GPU before the CPU tone-map path. Tone-mapping a
  // full 4K frame before reducing it to the delivery resolution is needlessly
  // slow; the final CPU pad keeps the requested canvas dimensions without
  // distorting sources whose aspect ratio differs from the target.
  const gpuHdrPreScale = options.toneMapSdr && !options.toneMapLibplacebo && !options.cpuToneMap && options.scale != null
    ? `scale_cuda=w=${options.scale.width}:h=${options.scale.height}:force_original_aspect_ratio=decrease:format=p010,hwdownload,format=p010le`
    : null;
  const hdrPreScale = gpuHdrPreScale ?? resizeFilter ?? "null";
  const hdrPostScale = options.toneMapSdr && options.scale != null
    ? `,pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`
    : "";
  const baseVideo = options.toneMapLibplacebo
    ? `[0:v:${options.videoStream}]format=yuv420p10le,hwupload,libplacebo=${libplaceboDimensions}:format=yuv420p10le:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:tonemapping=mobius:apply_dolbyvision=1,hwdownload,format=yuv420p10le,zscale=range=limited:dither=ordered,format=yuv420p,${rebuildTimeline}[base]`
    : options.toneMapSdr
    ? `[0:v:${options.videoStream}]${hdrPreScale},zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited:dither=ordered,format=yuv420p${hdrPostScale},${rebuildTimeline}[base]`
    : `[0:v:${options.videoStream}]${scaleFilter ?? "null"},${rebuildTimeline}[base]`;
  const effectiveSubtitleFile = options.subtitleFile ?? (embeddedTextSubtitle ? extractedSubtitle : null);
  let subtitleFilePath = null;
  if (effectiveSubtitleFile != null) {
    subtitleFilePath = `burn${[".ass", ".ssa"].includes(path.extname(effectiveSubtitleFile).toLowerCase()) ? ".ass" : ".srt"}`;
    fs.copyFileSync(effectiveSubtitleFile, path.join(activeJob.directory, subtitleFilePath));
    await prepareSubtitleFonts(input, options, activeJob.directory);
    if (process.platform === "darwin" && subtitleFilePath === "burn.ass" && !options.subtitleFont) {
      const families = [];
      for (const file of fs.readdirSync(path.join(activeJob.directory, "fonts"))) {
        if (!/\.(ttf|otf|ttc)$/iu.test(file)) continue;
        const info = capture("fc-query", ["--format", "%{family}\t%{lang}\n", path.join(activeJob.directory, "fonts", file)]);
        for (const face of info.trim().split("\n")) {
          const [names, languages] = face.split("\t");
          if (/(?:^|\|)(?:zh|ja)(?:[-|]|$)/u.test(languages ?? "")) families.push(...names.split(","));
        }
      }
      const staged = path.join(activeJob.directory, subtitleFilePath);
      const text = options.subtitleCharenc && options.subtitleCharenc.toUpperCase() !== "UTF-8"
        ? capture("iconv", ["-f", options.subtitleCharenc, "-t", "UTF-8", staged]) : fs.readFileSync(staged, "utf8");
      const repaired = repairAssFonts(text, families);
      fs.writeFileSync(staged, repaired.text);
      if (options.subtitleCharenc) options.subtitleCharenc = "UTF-8";
      activeJob.state.fontSubstitutions = repaired.substitutions;
      activeJob.save(activeJob.state.stage);
      if (repaired.substitutions.length) console.log(JSON.stringify({ subtitleFontSubstitutions: repaired.substitutions }));
    }
  }
  if (options.subtitleMarginV != null && subtitleFilePath == null) {
    throw new Error("--subtitle-margin-v requires a text subtitle file or embedded text subtitle stream");
  }
  const styles = [
    ...(options.subtitleMarginV == null ? [] : [`MarginV=${options.subtitleMarginV}`]),
    ...(options.subtitleFont ? [`FontName=${options.subtitleFont}`] : []),
    ...(process.platform === "darwin" && subtitleFilePath === "burn.srt" && !options.subtitleFont ? ["FontName=STHeiti"] : [])
  ];
  const subtitleStyle = styles.length ? `:force_style='${styles.join(",")}'` : "";
  const rawSubtitleFileFilter = subtitleFilePath == null ? null : `subtitles='${subtitleFilePath}':fontsdir=fonts${options.subtitleCharenc == null ? "" : `:charenc=${options.subtitleCharenc}`}${subtitleStyle}`;
  // Input seeking resets the encoded clip to a zero-based timeline, while an
  // external subtitle file still carries full-feature timestamps. Temporarily
  // restore the source timeline around libass so bounded smoke tests render the
  // same cues as a full encode, then return the clip to zero-based timestamps.
  const subtitleFileFilter = rawSubtitleFileFilter == null
    ? null
    : options.subtitleFile != null && options.start != null && options.start > 0
      ? `setpts=PTS+${options.start}/TB,${rawSubtitleFileFilter},setpts=PTS-${options.start}/TB`
      : rawSubtitleFileFilter;
  // PGS subtitle canvases are often 16:9 even when the movie image is wider.
  // Resize only the subtitle canvas: subtitles may live in the source letterbox,
  // while the video itself must keep its original aspect ratio.
  const bitmapSubtitleFilter = options.subtitleStream === null || embeddedTextSubtitle
    ? null
    : `[0:s:${options.subtitleStream}]setpts=PTS-${bitmapSubtitleOffset}/TB,scale=${options.scale?.width ?? sourceDimensions.width}:${options.scale?.height ?? sourceDimensions.height}[subs]`;
  const videoArgs = subtitleFileFilter != null && !options.toneMapSdr && scaleFilter === null
    ? ["-vf", subtitleFileFilter, "-map", `0:v:${options.videoStream}`]
    : subtitleFileFilter != null
      ? ["-filter_complex", `${baseVideo};[base]${subtitleFileFilter}[video]`, "-map", "[video]"]
      : options.subtitleStream === null && !options.toneMapSdr && scaleFilter === null
    ? ["-map", `0:v:${options.videoStream}`]
    : options.subtitleStream === null
      ? ["-filter_complex", `${baseVideo};[base]null[video]`, "-map", "[video]"]
      : [
          "-filter_complex",
          `${baseVideo};${bitmapSubtitleFilter};[base][subs]overlay=eof_action=pass:repeatlast=0:format=auto[v]`,
          "-map", "[v]"
        ];
  const encoderArgs = videoEncodingArgs(options.videoEncoder, options);
  const audioArgs = [
    ...(options.audioChannels == null ? [] : [
      "-ac", String(options.audioChannels),
      ...(options.audioChannels === 6 ? ["-channel_layout", "5.1"] : []),
      ...(options.audioChannels === 8 ? ["-channel_layout", "7.1"] : [])
    ]),
    ...(options.audioLoudnorm ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : [])
  ];
  const sharedInputArgs = [
    "-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y",
    // Do not force filter worker counts here. On some 4K PGS/HDR sources,
    // explicit filter threading serializes the CUDA/CPU handoff and can make
    // the encode dramatically slower than FFmpeg's automatic scheduler.
    ...(options.toneMapLibplacebo ? ["-init_hw_device", "vulkan=vk:0", "-filter_hw_device", "vk"] : []),
    ...(gpuHdrPreScale ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []),
    ...seekArgs, ...(options.allowDecoderRecovery ? ["-err_detect", "ignore_err"] : []), "-i", input,
    ...durationArgs,
    ...videoArgs
  ];
  const videoEncodeArgs = [
    ...sharedInputArgs,
    // Some remuxed HDR/Web-DL sources expose decode-order PTS that are not
    // monotonic. Rebuild a CFR delivery timeline so the MP4 muxer cannot
    // emit duplicate DTS values that fail strict playback QC.
    "-fps_mode", "cfr", "-r", sourceFrameRate,
    ...encoderArgs,
    ...(options.toneMapSdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"] : []),
    "-pix_fmt", "yuv420p"
  ];
  const expectedDuration = options.duration ?? Math.max(0, probeMediaDurations(input, options.videoStream).videoDuration - (options.start ?? 0));
  let lastMountCheck = 0;
  const guardProjection = seconds => {
    if (Date.now() - lastMountCheck > 5000) {
      if ([input, output, tempDir].some((file, index) => storageIdentity(file) !== plan.mounts[index])) {
        throw new Error("Storage mount identity changed during encoding; preserve the job and re-probe before resuming");
      }
      lastMountCheck = Date.now();
    }
    if (options.duration == null && seconds > Math.max(30, expectedDuration * 0.05) && fs.existsSync(work)) {
      const projected = fs.statSync(work).size * expectedDuration / seconds;
      if (projected > options.maxBytes * 1.03) throw new Error(`target_size_projection_failed: projected=${Math.ceil(projected)} cap=${options.maxBytes}`);
    }
  };
  if (options.splitAudio) {
    if (!options.resume) {
    activeJob.save("encoding_video");
    await run(options.ffmpeg, [...videoEncodeArgs, "-an", work], "encode-video-mkv", guardProjection);
    activeJob.save("video_complete");
    }
    if (!options.resume || resumeStage === "video_complete") {
    await run(options.ffmpeg, [
      "-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y",
      ...seekArgs, "-i", input, ...durationArgs, "-map", `0:a:${options.audioStream}`, "-vn",
      "-c:a", "aac", "-b:a", audioBitrate, ...audioArgs,
      ...(options.audioLanguage == null ? [] : ["-metadata:s:a:0", `language=${options.audioLanguage}`]),
      audioWork
    ], "encode-audio-m4a");
    activeJob.save("audio_complete");
    }
  } else if (!options.resume) {
    activeJob.save("encoding_video");
    await run(options.ffmpeg, [
      ...videoEncodeArgs, "-map", `0:a:${options.audioStream}`,
      "-c:a", "aac", "-b:a", audioBitrate, ...audioArgs,
      ...(options.audioLanguage == null ? [] : ["-metadata:s:a:0", `language=${options.audioLanguage}`]),
      work
     ], "encode-mkv", guardProjection);
    activeJob.save("audio_complete");
  }

  if (!options.resume || resumeStage !== "remux_complete") {
  await run(options.ffmpeg, [
    "-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y", "-i", work,
    ...(options.splitAudio ? ["-i", audioWork] : []),
    // Keep only the playable video/audio streams. Text-subtitle filters can
    // leave an auxiliary data stream in the MKV work file; copying all streams
    // into MP4 makes browser probing noisy and can trigger timestamp warnings.
    // The work MKV contains the selected/filtered video as its first video
    // stream, regardless of which source video ordinal was selected.
    "-map", "0:v:0", "-map", options.splitAudio ? "1:a:0" : "0:a:0", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy", "-tag:v", "hvc1",
    ...(options.audioLanguage == null ? [] : ["-metadata:s:a:0", `language=${options.audioLanguage}`]),
    "-movflags", "+faststart", part
   ], "remux-mp4");
  activeJob.save("remux_complete");
  }

  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  try {
    assertDeliveryDurations(input, part, options.videoStream, options.start, options.duration);
  } catch (error) {
    throw error;
  }
  assertBrowserPlayableMp4(part, options.toneMapSdr);
  await run(options.ffmpeg, ["-v", "error", "-xerror", "-i", part, "-t", "3", "-f", "null", "-"], "final-decode-check");
  await publishEncodedFile(part, output, size);
  activeJob.save("published");
  fs.rmSync(work, { force: true });
  fs.rmSync(audioWork, { force: true });
  fs.rmSync(extractedSubtitle, { force: true });

  console.log(JSON.stringify({ output, tempDir, colorPipeline, jobDir: activeJob.directory, ffmpeg: options.ffmpeg, ffprobe: probeBinary, bytes: size, maxBytes: options.maxBytes, start: options.start, duration: options.duration, videoStream: options.videoStream, sourceFrameRate, subtitleStream: options.subtitleStream, subtitleFile: options.subtitleFile, audioStream: options.audioStream, audioChannels: options.audioChannels ?? sourceAudioChannels, audioBitrate, audioLanguage: options.audioLanguage, audioLoudnorm: options.audioLoudnorm, splitAudio: options.splitAudio, scale: options.scale, videoEncoder: options.videoEncoder, allowDecoderRecovery: options.allowDecoderRecovery, videoBitrate: options.videoBitrate, toneMapSdr: options.toneMapSdr, toneMapLibplacebo: options.toneMapLibplacebo, cpuToneMap: options.cpuToneMap }));
  } finally { awake?.kill(); activeJob.release(); }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
