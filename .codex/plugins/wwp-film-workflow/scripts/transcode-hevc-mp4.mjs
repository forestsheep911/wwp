#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage:
  node scripts/transcode-hevc-mp4.mjs --input <media> --output <mp4> --video-stream <ordinal> --subtitle-stream <ordinal|none>
    [--subtitle-file <ass|ssa|srt>] [--subtitle-charenc <encoding>] [--audio-stream <ordinal>] [--audio-channels <count>] [--audio-language <code>] [--audio-loudnorm]
    [--split-audio]
    [--start <seconds>] [--duration <seconds>] [--cq <value>] [--video-bitrate <rate>]
    [--video-encoder <hevc_nvenc|libx265>]
    [--allow-decoder-recovery]
    [--max-bytes <bytes>] [--temp-dir <directory>] [--scale <width>x<height>] [--tone-map-sdr]
    [--tone-map-libplacebo] [--cpu-tone-map]

The subtitle ordinal is relative to subtitle streams (0:s:0, 0:s:1, ...), not the
absolute ffprobe stream index. Use "none" when subtitles are already burned into
the source video. Use --subtitle-file for ASS/SSA/SRT text subtitles; this routes through
the text-subtitle filter instead of the bitmap-subtitle overlay path. The encoder writes an MKV work
file first, then stream-copy remuxes it to MP4 with hvc1 after the encode succeeds.
Use --split-audio when decoding the selected source audio in the video pipeline
causes severe slowdown. It encodes the complete video and audio independently,
then muxes both without -shortest so the video stream is never truncated.
Use --tone-map-sdr only for a source confirmed to be HDR or Dolby Vision. It converts
the video to BT.709 before NVENC encoding; ordinary SDR sources must not use it.
Use --tone-map-libplacebo with a libplacebo-enabled FFmpeg build for Dolby Vision
Profile 5 or faster GPU tone mapping. It implies --tone-map-sdr.
Use --cpu-tone-map when CUDA pre-scaling or Vulkan/libplacebo is unavailable, or
when a smoke sample shows a hardware color-path problem. It keeps the same
BT.709 tone-map path but performs the HDR resize on the CPU.
`);
}

function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", videoStream: 0, subtitleStream: null, subtitleFile: null, subtitleCharenc: null, audioStream: 0, audioChannels: null, audioLanguage: null, audioLoudnorm: false, splitAudio: false, videoEncoder: "hevc_nvenc", allowDecoderRecovery: false, cq: 26, videoBitrate: null, maxBytes: 5_000_000_000, tempDir: null, scale: null, start: null, toneMapSdr: false, toneMapLibplacebo: false, cpuToneMap: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
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
    else if (["--input", "--output", "--video-stream", "--subtitle-stream", "--subtitle-file", "--subtitle-charenc", "--audio-stream", "--audio-channels", "--audio-language", "--start", "--duration", "--cq", "--video-bitrate", "--video-encoder", "--max-bytes", "--temp-dir", "--scale", "--ffmpeg"].includes(arg)) {
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
  options.tempDir = options.temp_dir == null ? null : path.resolve(options.temp_dir);
  options.audioStream = options.audio_stream == null ? 0 : Number(options.audio_stream);
  options.videoStream = options.video_stream == null ? 0 : Number(options.video_stream);
  options.audioChannels = options.audio_channels == null ? null : Number(options.audio_channels);
  options.audioLanguage = options.audio_language == null ? null : String(options.audio_language).toLowerCase();
  options.start = options.start == null ? null : Number(options.start);
  options.duration = options.duration == null ? null : Number(options.duration);
  options.cq = options.cq == null ? 26 : Number(options.cq);
  options.videoBitrate = options.video_bitrate == null ? null : String(options.video_bitrate);
  options.videoEncoder = options.video_encoder == null ? "hevc_nvenc" : String(options.video_encoder);
  if (!["hevc_nvenc", "libx265"].includes(options.videoEncoder)) {
    throw new Error("--video-encoder must be hevc_nvenc or libx265");
  }
  options.maxBytes = options.max_bytes == null ? 5_000_000_000 : Number(options.max_bytes);
  if (options.scale != null) {
    const match = String(options.scale).match(/^(\d+)x(\d+)$/i);
    if (!match || Number(match[1]) < 2 || Number(match[2]) < 2) throw new Error("--scale must be WIDTHxHEIGHT");
    options.scale = { width: Number(match[1]), height: Number(match[2]) };
  }
  if ((options.subtitleStream !== null && !Number.isFinite(options.subtitleStream))
    || !Number.isInteger(options.videoStream) || options.videoStream < 0
    || ![options.audioStream, options.cq, options.maxBytes].every(Number.isFinite)
    || (options.start !== null && !Number.isFinite(options.start))
    || (options.audioChannels !== null && (!Number.isInteger(options.audioChannels) || options.audioChannels < 1 || options.audioChannels > 8))) {
    throw new Error("stream ordinals, audio-channels, cq, and max-bytes must be valid numbers");
  }
  if (options.videoBitrate != null && !/^\d+(?:\.\d+)?[kKmMgG]$/.test(options.videoBitrate)) {
    throw new Error("--video-bitrate must be a value such as 3700k or 4M");
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

function run(ffmpeg, args, label) {
  console.log(`${label}: ${ffmpeg} ${args.map(value => JSON.stringify(value)).join(" ")}`);
  const strictSmoke = args.includes("-xerror");
  const result = strictSmoke
    ? spawnSync(ffmpeg, args, { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8", windowsHide: true })
    : spawnSync(ffmpeg, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  if (strictSmoke) {
    const stderr = result.stderr ?? "";
    if (stderr) process.stderr.write(stderr);
    const decoderFailure = stderr.match(/(?:Could not find ref with POC|Error constructing the frame RPS|error while decoding|corrupt decoded frame|Invalid data found when processing input)/iu);
    if (decoderFailure) {
      throw new Error(`${label} strict smoke failed on decoder error: ${decoderFailure[0]}`);
    }
  }
}

function smokeFailureArgs(duration, allowDecoderRecovery = false) {
  // A bounded smoke sample is a gate, not a best-effort preview. FFmpeg can
  // otherwise exit 0 after recovering from decoder errors and leave a green
  // or otherwise invalid sample that looks superficially complete.
  return duration == null || allowDecoderRecovery ? [] : ["-xerror"];
}

function probeVideoDimensions(input, videoStream) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", `v:${videoStream}`,
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

function probeVideoFrameRate(input, videoStream) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", `v:${videoStream}`,
    "-show_entries", "stream=avg_frame_rate,r_frame_rate",
    "-of", "json",
    input
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe frame-rate probe failed with exit code ${result.status}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  for (const value of [stream?.avg_frame_rate, stream?.r_frame_rate]) {
    const match = String(value ?? "").match(/^(\d+)\/(\d+)$/u);
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return `${match[1]}/${match[2]}`;
  }
  throw new Error("ffprobe could not determine the selected video's frame rate");
}

function probeMediaDurations(input, videoStream) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,duration",
    "-of", "json",
    input
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe duration probe failed with exit code ${result.status}`);
  const probe = JSON.parse(result.stdout);
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

function assertOutputSpace(directory, requiredBytes, duration) {
  // Bounded samples are exempt because their actual size is duration-limited.
  if (duration != null) return;
  const required = requiredBytes;
  const available = availableBytes(directory);
  if (available < required) {
    throw new Error(`insufficient encode disk space: directory=${directory} available=${available} required=${required}; choose another output or temp directory, or free space`);
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

  const tempDir = options.tempDir == null ? path.dirname(output) : options.tempDir;
  fs.mkdirSync(tempDir, { recursive: true });
  const base = path.join(tempDir, path.basename(output, ".mp4"));
  const work = `${base}.work.mkv`;
  const audioWork = `${base}.work-audio.m4a`;
  const part = `${base}.part.mp4`;
  const extractedSubtitle = `${base}.embedded-subtitle.srt`;
  for (const file of [work, audioWork, part, extractedSubtitle]) fs.rmSync(file, { force: true });
  assertOutputSpace(tempDir, options.maxBytes * 2 + 512 * 1024 * 1024, options.duration);
  if (path.dirname(output).toLowerCase() !== tempDir.toLowerCase()) {
    assertOutputSpace(path.dirname(output), options.maxBytes + 512 * 1024 * 1024, options.duration);
  }

  const seekArgs = options.start == null ? [] : ["-ss", String(options.start)];
  const durationArgs = options.duration == null ? [] : ["-t", String(options.duration)];
  const sourceWindowArgs = [...seekArgs, ...durationArgs];
  const sourceDimensions = probeVideoDimensions(input, options.videoStream);
  const sourceFrameRate = probeVideoFrameRate(input, options.videoStream);
  const rebuildTimeline = `setpts=N/(${sourceFrameRate}*TB)`;
  const subtitleCodec = probeSubtitleCodec(input, options.subtitleStream);
  const embeddedTextSubtitle = options.subtitleStream !== null
    && new Set(["ass", "mov_text", "srt", "ssa", "subrip", "text", "webvtt"]).has(subtitleCodec);
  if (embeddedTextSubtitle) {
    // A bounded smoke test must not extract subtitles for the entire episode first.
    run(options.ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostats", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y", ...seekArgs, "-i", input, ...durationArgs, "-map", `0:s:${options.subtitleStream}`, "-f", "srt", extractedSubtitle], "extract-text-subtitle");
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
  const gpuHdrPreScale = options.toneMapSdr && !options.toneMapLibplacebo && !options.cpuToneMap && options.scale != null
    ? `scale_cuda=w=${options.scale.width}:h=${options.scale.height}:force_original_aspect_ratio=decrease:format=p010,hwdownload,format=p010le`
    : null;
  const hdrPreScale = gpuHdrPreScale ?? scaleFilter ?? "null";
  const hdrPostScale = options.toneMapSdr && options.scale != null
    ? `,pad=${options.scale.width}:${options.scale.height}:(ow-iw)/2:(oh-ih)/2:color=black`
    : "";
  const baseVideo = options.toneMapLibplacebo
    ? `[0:v:${options.videoStream}]format=yuv420p10le,hwupload,libplacebo=${libplaceboDimensions}:format=yuv420p10le:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:tonemapping=mobius:apply_dolbyvision=1,hwdownload,format=yuv420p10le,format=yuv420p,${rebuildTimeline}[base]`
    : options.toneMapSdr
    ? `[0:v:${options.videoStream}]${hdrPreScale},zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=primaries=bt709:transfer=bt709:matrix=bt709,format=yuv420p${hdrPostScale},${rebuildTimeline}[base]`
    : `[0:v:${options.videoStream}]${scaleFilter ?? "null"},${rebuildTimeline}[base]`;
  const effectiveSubtitleFile = options.subtitleFile ?? (embeddedTextSubtitle ? extractedSubtitle : null);
  const subtitleFilePath = effectiveSubtitleFile == null ? null : escapedSubtitlePath(effectiveSubtitleFile);
  const rawSubtitleFileFilter = subtitleFilePath == null ? null : `subtitles='${subtitleFilePath}'${options.subtitleCharenc == null ? "" : `:charenc=${options.subtitleCharenc}`}`;
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
    : `[0:s:${options.subtitleStream}]scale=${options.scale?.width ?? sourceDimensions.width}:${options.scale?.height ?? sourceDimensions.height}[subs]`;
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
  const rateArgs = options.videoBitrate == null && options.videoEncoder === "hevc_nvenc"
    ? ["-cq", String(options.cq)]
    : options.videoBitrate == null
      ? ["-crf", String(options.cq)]
    : ["-b:v", options.videoBitrate, "-maxrate", options.videoBitrate, "-bufsize", options.videoBitrate];
  const encoderArgs = options.videoEncoder === "libx265"
    ? ["-c:v", "libx265", "-preset", "medium"]
    : ["-c:v", "hevc_nvenc", "-preset", "p5"];
  const audioArgs = [
    ...(options.audioChannels == null ? [] : [
      "-ac", String(options.audioChannels),
      ...(options.audioChannels === 6 ? ["-channel_layout", "5.1"] : []),
      ...(options.audioChannels === 8 ? ["-channel_layout", "7.1"] : [])
    ]),
    ...(options.audioLoudnorm ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : [])
  ];
  const sharedInputArgs = [
    "-hide_banner", "-loglevel", options.allowDecoderRecovery ? "warning" : "error", "-nostats", "-progress", "pipe:1", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y",
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
    "-fps_mode", "cfr",
    ...encoderArgs, ...rateArgs,
    "-pix_fmt", "yuv420p"
  ];
  if (options.splitAudio) {
    run(options.ffmpeg, [...videoEncodeArgs, "-an", work], "encode-video-mkv");
    run(options.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
      ...seekArgs, "-i", input, ...durationArgs, "-map", `0:a:${options.audioStream}`, "-vn",
      "-c:a", "aac", "-b:a", "256k", ...audioArgs,
      ...(options.audioLanguage == null ? [] : ["-metadata:s:a:0", `language=${options.audioLanguage}`]),
      audioWork
    ], "encode-audio-m4a");
  } else {
    run(options.ffmpeg, [
      ...videoEncodeArgs, "-map", `0:a:${options.audioStream}`,
      "-c:a", "aac", "-b:a", "256k", ...audioArgs,
      ...(options.audioLanguage == null ? [] : ["-metadata:s:a:0", `language=${options.audioLanguage}`]),
      work
    ], "encode-mkv");
  }

  run(options.ffmpeg, [
    "-hide_banner", "-loglevel", options.allowDecoderRecovery ? "warning" : "error", "-nostats", "-progress", "pipe:1", ...smokeFailureArgs(options.duration, options.allowDecoderRecovery), "-y", "-i", work,
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

  const size = fs.statSync(part).size;
  if (size > options.maxBytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`output exceeds max-bytes: ${size} > ${options.maxBytes}`);
  }
  try {
    assertDeliveryDurations(input, part, options.videoStream, options.start, options.duration);
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }
  if (path.dirname(part).toLowerCase() === path.dirname(output).toLowerCase()) fs.renameSync(part, output);
  else {
    fs.copyFileSync(part, output);
    fs.rmSync(part, { force: true });
  }
  fs.rmSync(work, { force: true });
  fs.rmSync(audioWork, { force: true });
  fs.rmSync(extractedSubtitle, { force: true });
  assertBrowserPlayableMp4(output);
  console.log(JSON.stringify({ output, tempDir, bytes: size, maxBytes: options.maxBytes, start: options.start, duration: options.duration, videoStream: options.videoStream, sourceFrameRate, subtitleStream: options.subtitleStream, subtitleFile: options.subtitleFile, audioStream: options.audioStream, audioChannels: options.audioChannels, audioLanguage: options.audioLanguage, audioLoudnorm: options.audioLoudnorm, splitAudio: options.splitAudio, scale: options.scale, videoEncoder: options.videoEncoder, allowDecoderRecovery: options.allowDecoderRecovery, videoBitrate: options.videoBitrate, toneMapSdr: options.toneMapSdr, toneMapLibplacebo: options.toneMapLibplacebo, cpuToneMap: options.cpuToneMap }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
