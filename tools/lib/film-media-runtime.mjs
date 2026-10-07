import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function defaultOutputRoot(platform = process.platform, env = process.env) {
  return env.WWP_OUTPUT_ROOT || (platform === "win32" ? "E:\\video_made" : null);
}

export function requireOutputRoot(value) {
  if (!value) throw new Error("Choose an explicit output directory or configure WWP_OUTPUT_ROOT on this machine");
  return assertStoragePath(value);
}

export function assertStoragePath(value, platform = process.platform) {
  if (platform !== "win32" && /^[a-z]:[\\/]/iu.test(value)) {
    throw new Error(`Windows drive path is not usable on ${platform}: ${value}`);
  }
  const resolved = path.resolve(value);
  if (platform === "darwin" && resolved.startsWith("/Volumes/")) {
    const volume = resolved.split("/").slice(0, 3).join("/");
    const mounts = spawnSync("/sbin/mount", [], { encoding: "utf8", timeout: 10000 });
    if (mounts.status !== 0 || !mounts.stdout.includes(` on ${volume} (`)) {
      throw new Error(`External volume is not mounted: ${volume}; refusing local fallback writes`);
    }
  }
  return resolved;
}

export function storageIdentity(value) {
  const resolved = assertStoragePath(value);
  if (process.platform === "darwin" && resolved.startsWith("/Volumes/")) {
    const volume = resolved.split("/").slice(0, 3).join("/");
    return capture("/sbin/mount", []).split("\n").find(line => line.includes(` on ${volume} (`)).split(" on ")[0];
  }
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  return `device:${fs.statSync(ancestor).dev}`;
}

export function capture(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout;
}

export function resolveMediaTools(options = {}, platform = process.platform, env = process.env) {
  let ffmpeg = options.ffmpeg || env.WWP_FFMPEG;
  if (!ffmpeg && platform === "darwin") {
    ffmpeg = ["/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg"].find(fs.existsSync);
  }
  ffmpeg ||= "ffmpeg";
  let ffprobe = options.ffprobe || env.WWP_FFPROBE;
  if (!ffprobe && path.isAbsolute(ffmpeg)) {
    const sibling = path.join(path.dirname(ffmpeg), platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (!fs.existsSync(sibling)) throw new Error(`Matching ffprobe not found: ${sibling}; pass --ffprobe explicitly`);
    ffprobe = sibling;
  }
  ffprobe ||= "ffprobe";
  const version = capture(ffmpeg, ["-version"]).split("\n")[0];
  capture(ffprobe, ["-version"]);
  const encoders = capture(ffmpeg, ["-hide_banner", "-encoders"]);
  const filters = capture(ffmpeg, ["-hide_banner", "-filters"]);
  const hasEncoder = name => new RegExp(`\\s${name}\\s`, "u").test(encoders);
  const hasFilter = name => new RegExp(`\\s${name}\\s`, "u").test(filters);
  return { ffmpeg, ffprobe, version, hasEncoder, hasFilter };
}

export function selectVideoEncoder(runtime, requested = "auto", platform = process.platform) {
  const candidates = requested === "auto"
    ? (platform === "darwin" ? ["hevc_videotoolbox", "libx265"] : ["hevc_nvenc", "libx265"])
    : [requested];
  const failures = [];
  for (const encoder of candidates) {
    if (!runtime.hasEncoder(encoder)) { failures.push(`${encoder}: absent`); continue; }
    try {
      capture(runtime.ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=s=128x128:r=24:d=0.1",
        "-frames:v", "1", "-c:v", encoder, ...(encoder === "hevc_videotoolbox" ? ["-allow_sw", "0", "-b:v", "500k"] : []), "-f", "null", "-"], 30000);
      return encoder;
    } catch (error) { failures.push(`${encoder}: ${error.message}`); }
  }
  throw new Error(`No working HEVC encoder: ${failures.join("; ")}`);
}

export function videoEncodingArgs(encoder, { cq = 26, videoBitrate = null, vtQuality = 65 } = {}) {
  if (encoder === "hevc_videotoolbox") {
    return ["-c:v", encoder, "-allow_sw", "0", "-realtime", "0",
      ...(videoBitrate ? ["-b:v", videoBitrate] : ["-q:v", String(vtQuality)])];
  }
  return ["-c:v", encoder, "-preset", encoder === "libx265" ? "medium" : "p5",
    ...(videoBitrate ? ["-b:v", videoBitrate, "-maxrate", videoBitrate, "-bufsize", videoBitrate]
      : [encoder === "libx265" ? "-crf" : "-cq", String(cq)])];
}

export function assertVolumeSpace(tempDir, outputDir, maxBytes, duration = null) {
  // Samples need a bounded reserve too; full jobs budget work, remux, and target staging.
  const bytes = duration == null ? maxBytes : Math.min(maxBytes, Math.ceil(duration * 32 * 1024 * 1024));
  const sameVolume = fs.statSync(tempDir).dev === fs.statSync(outputDir).dev;
  const overhead = 512 * 1024 * 1024;
  for (const [dir, needed] of sameVolume
    ? [[tempDir, bytes * 3 + overhead]]
    : [[tempDir, bytes * 2 + overhead], [outputDir, bytes + overhead]]) {
    const stat = fs.statfsSync(dir);
    const available = Number(stat.bavail) * Number(stat.bsize);
    if (available < needed) throw new Error(`insufficient encode disk space: directory=${dir} available=${available} required=${needed}`);
  }
}
