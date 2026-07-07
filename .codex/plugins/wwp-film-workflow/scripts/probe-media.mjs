#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/probe-media.mjs --input <media-file> [--output <probe.json>] [--ffprobe <path>]

Runs ffprobe and emits JSON with format, streams, file size, and probe timestamp.
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function ensureParent(filePath) {
  const parent = path.dirname(path.resolve(filePath));
  mkdirSync(parent, { recursive: true });
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
  const payload = {
    input: inputPath,
    sizeBytes: stats.size,
    probedAt: new Date().toISOString(),
    ffprobe: parsed
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.output) {
    ensureParent(options.output);
    writeFileSync(options.output, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
