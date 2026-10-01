#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage:
  node scripts/render-pgs-samples.mjs --input <media> --subtitle-stream <ordinal> --output-dir <directory> [--events 3] [--start <seconds>] [--timeout-ms 180000]

Extracts a bounded PGS subtitle sample, then renders the first distinct subtitle
events at or after the optional start time over black images. It records evidence
only: inspect the images before classifying subtitle language or selecting a
production branch.
`);
}

export function parseArgs(argv) {
  const options = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", events: 3, start: 0, timeout_ms: 180000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--input", "--subtitle-stream", "--output-dir", "--events", "--start", "--timeout-ms", "--ffmpeg", "--ffprobe"].includes(arg)) {
      options[arg.slice(2).replaceAll("-", "_")] = argv[++index];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.input || options.subtitle_stream === undefined || !options.output_dir) {
    throw new Error("--input, --subtitle-stream, and --output-dir are required");
  }
  options.events = Number(options.events);
  options.start = Number(options.start);
  options.timeoutMs = Number(options.timeout_ms);
  options.subtitleStream = Number(options.subtitle_stream);
  if (!Number.isInteger(options.subtitleStream) || options.subtitleStream < 0) throw new Error("--subtitle-stream must be a non-negative ordinal");
  if (!Number.isInteger(options.events) || options.events < 1 || options.events > 12) throw new Error("--events must be 1-12");
  if (!Number.isFinite(options.start) || options.start < 0) throw new Error("--start must be a non-negative number of seconds");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer");
  return options;
}

function run(command, args, timeoutMs) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: timeoutMs });
  if (result.error?.code === "ETIMEDOUT") throw new Error(`${command} timed out after ${timeoutMs}ms`);
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

export function buildSubtitleExtractArgs(options, input, supPath) {
  const seekArgs = options.start > 0
    ? ["-copyts", "-ss", String(options.start)]
    : [];
  return ["-y", "-v", "error", ...seekArgs, "-i", input, "-map", `0:s:${options.subtitleStream}`, "-c:s", "copy", "-frames:s", String(Math.max(options.events * 3, 6)), supPath];
}

export function visiblePgsEvents(data, limit) {
  const events = [];
  for (let offset = 0; offset + 13 <= data.length;) {
    if (data.toString("ascii", offset, offset + 2) !== "PG") throw new Error("Invalid SUP segment header");
    const length = data.readUInt16BE(offset + 11);
    if (offset + 13 + length > data.length) throw new Error("Truncated SUP segment");
    if (data[offset + 10] === 0x16 && length >= 11) {
      const time = data.readUInt32BE(offset + 2) / 90000;
      const objects = data[offset + 23];
      if (objects > 0) events.push({ time, end: null });
      else if (events.length && events.at(-1).end === null) events.at(-1).end = time;
    }
    offset += 13 + length;
  }
  return events.filter((event) => event.end === null || event.end > event.time).slice(0, limit);
}

export function isUniformSubtitleImage(stats) {
  const minimum = Number(stats.match(/lavfi\.signalstats\.YMIN=([\d.]+)/)?.[1]);
  const maximum = Number(stats.match(/lavfi\.signalstats\.YMAX=([\d.]+)/)?.[1]);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) throw new Error("Missing image luma statistics");
  return maximum - minimum <= 1;
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
    run(options.ffmpeg, buildSubtitleExtractArgs(options, input, supPath), options.timeoutMs);
    const events = visiblePgsEvents(fs.readFileSync(supPath), options.events);
    if (events.length === 0) throw new Error("No visible PGS subtitle events were extracted");
    const rejectedSamples = [];
    const rendered = events.map(({ time, end }, index) => {
      const output = path.join(outputDir, sampleName(input, options.subtitleStream, index));
      const duration = String(Math.max(Math.ceil(time + 3), 4));
      const sampleTime = time + Math.min(0.1, end === null ? 0.1 : (end - time) / 2);
      run(options.ffmpeg, ["-y", "-v", "error", "-copyts", "-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=24:d=${duration}`, "-i", supPath, "-filter_complex", "[0:v][1:s]overlay", "-ss", String(sampleTime), "-frames:v", "1", output], options.timeoutMs);
      const stats = run(options.ffmpeg, ["-v", "error", "-i", output, "-vf", "signalstats,metadata=print:file=-", "-frames:v", "1", "-f", "null", "-"], options.timeoutMs);
      if (isUniformSubtitleImage(stats)) {
        rejectedSamples.push({ eventTimeSeconds: time, output, reason: "uniform_image_no_visible_subtitle" });
        return null;
      }
      return { eventTimeSeconds: time, output };
    }).filter(Boolean);
    process.stdout.write(`${JSON.stringify({ input, subtitleStream: options.subtitleStream, sourceStartSeconds: options.start, rendered, rejectedSamples }, null, 2)}\n`);
    if (rendered.length === 0) throw new Error("All rendered PGS samples were blank; subtitle language remains unverified");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
