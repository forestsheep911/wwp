#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage:
  node scripts/render-pgs-samples.mjs --input <media> --subtitle-stream <ordinal> --output-dir <directory> [--events 3]

Extracts a bounded PGS subtitle sample, then renders the first distinct subtitle
events over black images. It records evidence only: inspect the images before
classifying subtitle language or selecting a production branch.
`);
}

function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", events: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--input", "--subtitle-stream", "--output-dir", "--events", "--ffmpeg", "--ffprobe"].includes(arg)) {
      options[arg.slice(2).replaceAll("-", "_")] = argv[++index];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.input || options.subtitle_stream === undefined || !options.output_dir) {
    throw new Error("--input, --subtitle-stream, and --output-dir are required");
  }
  options.events = Number(options.events);
  options.subtitleStream = Number(options.subtitle_stream);
  if (!Number.isInteger(options.subtitleStream) || options.subtitleStream < 0) throw new Error("--subtitle-stream must be a non-negative ordinal");
  if (!Number.isInteger(options.events) || options.events < 1 || options.events > 12) throw new Error("--events must be 1-12");
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function distinctEventTimes(values, limit) {
  const output = [];
  for (const value of values) {
    const time = Number(value);
    if (!Number.isFinite(time) || time < 0) continue;
    if (output.some((previous) => Math.abs(previous - time) < 0.2)) continue;
    output.push(time);
    if (output.length === limit) break;
  }
  return output;
}

function sampleName(input, stream, index) {
  const stem = path.basename(input, path.extname(input)).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${stem}.pgs-s${stream}.event-${String(index + 1).padStart(2, "0")}.png`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();
  const input = path.resolve(options.input);
  const outputDir = path.resolve(options.output_dir);
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-pgs-"));
  const supPath = path.join(tempDir, "sample.sup");
  try {
    run(options.ffmpeg, ["-y", "-v", "error", "-i", input, "-map", `0:s:${options.subtitleStream}`, "-c:s", "copy", "-frames:s", String(Math.max(options.events * 3, 6)), supPath]);
    const packetOutput = run(options.ffprobe, ["-v", "error", "-show_entries", "packet=pts_time", "-of", "csv=p=0", supPath]);
    const times = distinctEventTimes(packetOutput.split(/\r?\n/u), options.events);
    if (times.length === 0) throw new Error("No PGS subtitle events were extracted");
    const rendered = times.map((time, index) => {
      const output = path.join(outputDir, sampleName(input, options.subtitleStream, index));
      const duration = String(Math.max(Math.ceil(time + 3), 4));
      run(options.ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=1:d=${duration}`, "-i", supPath, "-filter_complex", "[0:v][1:s]overlay", "-ss", String(time + 0.5), "-frames:v", "1", output]);
      return { eventTimeSeconds: time, output };
    });
    process.stdout.write(`${JSON.stringify({ input, subtitleStream: options.subtitleStream, rendered }, null, 2)}\n`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
