#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/probe-media.mjs --input <media-file> [--output <probe.json>] [--ffprobe <path>] [--clip-info <file.clpi>]

Runs ffprobe and emits JSON with format, streams, file size, and probe timestamp.
For a BDMV stream, it also reads matching CLPI PGS language descriptors when available.
`);
}

function parseArgs(argv) {
  const options = { ffprobe: "ffprobe" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input" || arg === "-i") options.input = argv[++i];
    else if (arg === "--output" || arg === "-o") options.output = argv[++i];
    else if (arg === "--ffprobe") options.ffprobe = argv[++i];
    else if (arg === "--clip-info") options.clipInfo = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function ensureParent(filePath) {
  const parent = path.dirname(path.resolve(filePath));
  mkdirSync(parent, { recursive: true });
}

function plausibleLanguage(value) {
  return /^[a-z]{3}$/iu.test(value) ? value.toLowerCase() : undefined;
}

export function parseClipInfoPgsTracks(clipInfoPath) {
  if (!clipInfoPath || !existsSync(clipInfoPath)) return undefined;
  const data = readFileSync(clipInfoPath);
  const tracks = [];
  for (let offset = 0; offset + 7 <= data.length; offset += 1) {
    const pid = data.readUInt16BE(offset);
    const descriptorLength = data[offset + 2];
    const codingType = data[offset + 3];
    const language = plausibleLanguage(data.subarray(offset + 4, offset + 7).toString("ascii"));
    if (pid < 0x1200 || pid > 0x12ff || descriptorLength !== 0x15 || codingType !== 0x90 || !language) continue;
    const record = { pid: `0x${pid.toString(16)}`, language };
    if (!tracks.some((track) => track.pid === record.pid && track.language === record.language)) tracks.push(record);
  }
  return {
    path: clipInfoPath,
    pgsTracks: tracks,
    hasChineseSubtitle: tracks.some((track) => ["zho", "chi"].includes(track.language))
  };
}

export function inferredClipInfoPath(inputPath) {
  const resolved = path.resolve(inputPath);
  const streamDirectory = path.dirname(resolved);
  const bdmvDirectory = path.dirname(streamDirectory);
  if (path.basename(streamDirectory).toLowerCase() !== "stream" || path.basename(bdmvDirectory).toLowerCase() !== "bdmv") return undefined;
  return path.join(bdmvDirectory, "CLIPINF", `${path.basename(resolved, path.extname(resolved))}.clpi`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.input) {
    usage();
    process.exitCode = 2;
    return;
  }

  const inputPath = path.resolve(options.input);
  if (!existsSync(inputPath)) {
    throw new Error(`Input does not exist: ${inputPath}`);
  }

  const result = spawnSync(options.ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath
  ], { encoding: "utf8" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffprobe failed with exit ${result.status}: ${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout || "{}");
  const stats = statSync(inputPath);
  const clipInfoPath = options.clipInfo ? path.resolve(options.clipInfo) : inferredClipInfoPath(inputPath);
  const payload = {
    input: inputPath,
    sizeBytes: stats.size,
    probedAt: new Date().toISOString(),
    ffprobe: parsed,
    ...(parseClipInfoPgsTracks(clipInfoPath) ? { bluRayClipInfo: parseClipInfoPgsTracks(clipInfoPath) } : {})
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.output) {
    ensureParent(options.output);
    writeFileSync(options.output, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
