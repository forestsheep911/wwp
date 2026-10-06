#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveMediaTools, capture, assertStoragePath } from "../../../../tools/lib/film-media-runtime.mjs";
import { atomicJson } from "../../../../tools/lib/film-encode-job.mjs";

export function sampleTimes(duration, count) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1) throw new Error("Invalid QC duration or sample count");
  return Array.from({ length: count }, (_, index) => duration * (index + 0.5) / count);
}

export async function main(args = process.argv.slice(2)) {
  const options = { columns: 4, rows: 3, width: 320, waitHours: 12 };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      console.log("Usage: node scripts/make-qc-contact-sheet.mjs --input <media> --output-dir <qc-dir> [--wait-pid <pid>] [--wait-hours 12] [--columns 4] [--rows 3] [--width 320] [--ffmpeg <path>] [--ffprobe <path>]");
      return;
    }
    const key = { "--input": "input", "--output-dir": "directory", "--wait-pid": "waitPid", "--wait-hours": "waitHours", "--columns": "columns", "--rows": "rows", "--width": "width", "--ffmpeg": "ffmpeg", "--ffprobe": "ffprobe" }[flag];
    if (!key || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Invalid QC argument: ${flag}`);
    options[key] = args[++index];
  }
  if (!options.input || !options.directory) throw new Error("--input and --output-dir are required");
  for (const key of ["columns", "rows", "width"]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 4096) throw new Error(`Invalid ${key}`);
  }
  if (options.columns * options.rows > 48) throw new Error("QC is bounded to 48 frames");
  const input = assertStoragePath(options.input), directory = assertStoragePath(options.directory);
  if (options.waitPid != null) {
    const pid = Number(options.waitPid), hours = Number(options.waitHours);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(hours) || hours <= 0) throw new Error("Invalid PID or wait duration");
    const until = Date.now() + hours * 3600000;
    while (true) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") break; throw error; }
      if (Date.now() > until) throw new Error("QC wait timed out; no completion inferred");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  const tools = resolveMediaTools(options);
  const probe = JSON.parse(capture(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", input]));
  const times = sampleTimes(Number(probe.format?.duration), options.columns * options.rows);
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < times.length; index++) {
    capture(tools.ffmpeg, ["-v", "error", "-xerror", "-ss", String(times[index]), "-i", input, "-frames:v", "1", "-vf", `scale=${options.width}:-2`, "-y", path.join(directory, `frame-${String(index).padStart(2, "0")}.png`)]);
  }
  capture(tools.ffmpeg, ["-v", "error", "-framerate", "1", "-i", path.join(directory, "frame-%02d.png"), "-vf", `tile=${options.columns}x${options.rows}`, "-frames:v", "1", "-y", path.join(directory, "contact-sheet.png")]);
  for (const fraction of [0.05, 0.5, 0.95]) {
    capture(tools.ffmpeg, ["-v", "error", "-xerror", "-ss", String(Number(probe.format.duration) * fraction), "-i", input, "-t", "2", "-f", "null", "-"], 60000);
  }
  const report = { state: "qc_ready", input, bytes: fs.statSync(input).size, generatedAt: new Date().toISOString(), sampleTimes: times,
    contactSheet: path.join(directory, "contact-sheet.png"), probe, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe,
    nextGate: "Inspect subtitle language, glyphs, picture/color and audio; this artifact does not grant qc_passed or publication" };
  atomicJson(path.join(directory, "qc.json"), report);
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
