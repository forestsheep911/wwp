#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_BYTES = 5_000_000_000;
const DEFAULT_TARGET_BYTES = 4_850_000_000;

function usage() {
  console.log(`Usage:
  node scripts/build-series-collections.mjs --manifest <json> [--apply]
    [--target-bytes 4850000000] [--max-bytes 5000000000]
    [--ffmpeg ffmpeg] [--ffprobe ffprobe] [--report <json>]

Manifest:
{
  "sourceDir": "E:\\\\video_made",
  "filePattern": "Series.Title.S01E*.mp4",
  "outputDir": "E:\\\\video_made",
  "outputPrefix": "Series.Title",
  "season": 1
}

Alternatively, list inputs explicitly:
{
  "outputDir": "E:\\\\video_made",
  "outputPrefix": "Series.Title",
  "season": 1,
  "episodes": [
    { "episode": 1, "input": "E:\\\\video_made\\\\Series.S01E01.mp4" },
    { "episode": 2, "input": "E:\\\\video_made\\\\Series.S01E02.mp4" }
  ]
}

The inputs must already be QC-passed, stream-compatible MP4 episode files. The
script groups consecutive episodes below the target, then uses concat stream copy
to make one upload asset per range. Dry-run is the default.
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    targetBytes: DEFAULT_TARGET_BYTES,
    maxBytes: DEFAULT_MAX_BYTES
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--apply") options.apply = true;
    else if (["--manifest", "--target-bytes", "--max-bytes", "--ffmpeg", "--ffprobe", "--report"].includes(arg)) {
      const value = argv[++index];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--target-bytes") options.targetBytes = Number(value);
      else if (arg === "--max-bytes") options.maxBytes = Number(value);
      else options[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.help) return options;
  if (!options.manifest) throw new Error("--manifest is required");
  if (!Number.isFinite(options.targetBytes) || !Number.isFinite(options.maxBytes)
    || options.targetBytes <= 0 || options.maxBytes <= 0 || options.targetBytes > options.maxBytes) {
    throw new Error("--target-bytes and --max-bytes must be positive, with target <= max");
  }
  return options;
}

export function planEpisodeCollections(episodes, targetBytes = DEFAULT_TARGET_BYTES, maxBytes = DEFAULT_MAX_BYTES) {
  const sorted = [...episodes].sort((left, right) => left.episode - right.episode);
  const seen = new Set();
  const groups = [];
  let current = [];
  let currentBytes = 0;

  for (const item of sorted) {
    if (!Number.isInteger(item.episode) || item.episode < 1) {
      throw new Error(`invalid episode number: ${item.episode}`);
    }
    if (!Number.isFinite(item.bytes) || item.bytes <= 0) {
      throw new Error(`invalid byte size for episode ${item.episode}`);
    }
    if (item.bytes > maxBytes) {
      throw new Error(`episode ${item.episode} exceeds max-bytes before collection: ${item.bytes} > ${maxBytes}`);
    }
    if (seen.has(item.episode)) throw new Error(`duplicate episode number: ${item.episode}`);
    seen.add(item.episode);

    const previous = current.at(-1);
    const isConsecutive = previous == null || item.episode === previous.episode + 1;
    const fitsTarget = currentBytes + item.bytes <= targetBytes;
    if (current.length > 0 && (!isConsecutive || !fitsTarget)) {
      groups.push({ episodes: current, estimatedBytes: currentBytes });
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.bytes;
  }
  if (current.length > 0) groups.push({ episodes: current, estimatedBytes: currentBytes });

  return groups.map((group) => ({
    ...group,
    episodeStart: group.episodes[0].episode,
    episodeEnd: group.episodes.at(-1).episode
  }));
}

export function episodeCollectionFileName(prefix, season, episodeStart, episodeEnd) {
  const seasonLabel = String(season).padStart(2, "0");
  const first = String(episodeStart).padStart(2, "0");
  const last = String(episodeEnd).padStart(2, "0");
  return `${prefix}.S${seasonLabel}E${first}-E${last}.mp4`;
}

function run(command, args, label, capture = false) {
  const result = spawnSync(command, args, {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}${capture ? `: ${result.stderr}` : ""}`);
  }
  return capture ? result.stdout : "";
}

function probeInput(ffprobe, input) {
  const output = run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=size,duration:stream=index,codec_type,codec_name,codec_tag_string,width,height,pix_fmt,time_base,sample_rate,channels,channel_layout",
    "-of", "json",
    input
  ], `probe ${input}`, true);
  const probe = JSON.parse(output);
  return {
    bytes: Number(probe.format?.size),
    durationSeconds: Number(probe.format?.duration),
    streams: probe.streams ?? []
  };
}

function streamSignature(probe) {
  return JSON.stringify(probe.streams
    .filter((stream) => stream.codec_type === "video" || stream.codec_type === "audio")
    .map((stream) => ({
    codecType: stream.codec_type,
    codecName: stream.codec_name,
    width: stream.width,
    height: stream.height,
    pixFmt: stream.pix_fmt,
    timeBase: stream.time_base,
    sampleRate: stream.sample_rate,
    channels: stream.channels,
    channelLayout: stream.channel_layout
    })));
}

function concatListLine(filePath) {
  return `file '${filePath.replaceAll("'", "'\\''")}'`;
}

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function episodeNumberFromName(fileName, season) {
  const match = String(fileName).match(new RegExp(`S${String(season).padStart(2, "0")}E(\\d{1,3})(?!\\d)`, "i"))
    ?? String(fileName).match(/\bS\d{1,2}E(\d{1,3})(?!\d)/i);
  const episode = Number(match?.[1]);
  return Number.isInteger(episode) && episode > 0 ? episode : undefined;
}

function manifestEpisodes(manifest, manifestPath, season) {
  if (Array.isArray(manifest.episodes)) return manifest.episodes;
  if (!manifest.sourceDir || !manifest.filePattern) {
    throw new Error("manifest requires episodes[] or sourceDir plus filePattern");
  }
  const sourceDir = path.resolve(path.dirname(manifestPath), manifest.sourceDir);
  const pattern = globToRegExp(manifest.filePattern);
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => ({
      episode: episodeNumberFromName(entry.name, season),
      input: path.join(sourceDir, entry.name)
    }))
    .sort((left, right) => (left.episode ?? Number.MAX_SAFE_INTEGER) - (right.episode ?? Number.MAX_SAFE_INTEGER));
}

function buildCollection(options, group, output) {
  const signatures = new Set(group.episodes.map((episode) => streamSignature(episode.probe)));
  if (signatures.size !== 1) {
    throw new Error(`episodes ${group.episodeStart}-${group.episodeEnd} are not stream-compatible; normalize them with the same encode settings first`);
  }

  const listPath = `${output}.concat.txt`;
  const partPath = `${output}.part.mp4`;
  fs.writeFileSync(listPath, `${group.episodes.map((episode) => concatListLine(episode.input)).join("\n")}\n`);
  fs.rmSync(partPath, { force: true });
  try {
    const videoCodec = group.episodes[0].probe.streams.find((stream) => stream.codec_type === "video")?.codec_name;
    const videoTagArgs = videoCodec === "hevc"
      ? ["-tag:v", "hvc1"]
      : videoCodec === "h264"
        ? ["-tag:v", "avc1"]
        : [];
    run(options.ffmpeg, [
      "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-map", "0:v", "-map", "0:a", "-c", "copy", ...videoTagArgs, "-movflags", "+faststart", partPath
    ], `concat episodes ${group.episodeStart}-${group.episodeEnd}`);
    const bytes = fs.statSync(partPath).size;
    if (bytes > options.maxBytes) {
      throw new Error(`collection ${group.episodeStart}-${group.episodeEnd} exceeds max-bytes: ${bytes} > ${options.maxBytes}`);
    }
    fs.renameSync(partPath, output);
    return bytes;
  } finally {
    fs.rmSync(listPath, { force: true });
    fs.rmSync(partPath, { force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const manifestPath = path.resolve(options.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputDir = path.resolve(manifest.outputDir);
  const outputPrefix = String(manifest.outputPrefix ?? "").trim();
  const season = Number(manifest.season ?? 1);
  if (!outputPrefix || !Number.isInteger(season) || season < 0) {
    throw new Error("manifest requires outputDir, outputPrefix, and season");
  }

  const episodes = manifestEpisodes(manifest, manifestPath, season).map((item) => {
    const input = path.resolve(path.dirname(manifestPath), item.input);
    if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);
    const probe = probeInput(options.ffprobe, input);
    return { episode: Number(item.episode), input, bytes: probe.bytes, probe };
  });
  const groups = planEpisodeCollections(episodes, options.targetBytes, options.maxBytes);
  fs.mkdirSync(outputDir, { recursive: true });

  const collections = groups.map((group) => {
    const output = path.join(
      outputDir,
      episodeCollectionFileName(outputPrefix, season, group.episodeStart, group.episodeEnd)
    );
    const bytes = options.apply ? buildCollection(options, group, output) : undefined;
    return {
      episodeStart: group.episodeStart,
      episodeEnd: group.episodeEnd,
      inputs: group.episodes.map((episode) => episode.input),
      estimatedBytes: group.estimatedBytes,
      output,
      bytes,
      status: options.apply ? "created" : "planned"
    };
  });

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    targetBytes: options.targetBytes,
    maxBytes: options.maxBytes,
    collectionCount: collections.length,
    collections
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
