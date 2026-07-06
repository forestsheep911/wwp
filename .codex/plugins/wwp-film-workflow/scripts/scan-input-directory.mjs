#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const mediaExt = new Set([".mkv", ".mp4", ".m2ts", ".ts", ".mov", ".avi", ".wmv", ".iso"]);
const subtitleExt = new Set([".srt", ".ass", ".ssa", ".sup", ".idx", ".sub", ".pgs"]);
const nfoExt = new Set([".nfo"]);

function usage() {
  console.log(`Usage:
  node scripts/scan-input-directory.mjs --root <input-dir> [--output <scan.json>] [--max-samples 5]

Summarizes top-level WWP film/series candidate folders without probing media streams.
`);
}

function parseArgs(argv) {
  const options = { maxSamples: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--root" || arg === "-r") options.root = argv[++i];
    else if (arg === "--output" || arg === "-o") options.output = argv[++i];
    else if (arg === "--max-samples") options.maxSamples = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.maxSamples) || options.maxSamples < 1) {
    throw new Error("--max-samples must be a positive number.");
  }
  return options;
}

function classifySubtitleHint(name) {
  const text = name.toLowerCase();
  const hints = [];
  if (/(?:chseng|gbeng|简英|簡英|简体.*英|簡體.*英)/iu.test(text)) hints.push("chseng");
  if (/(?:chteng|big5eng|繁英|繁體.*英)/iu.test(text)) hints.push("chteng");
  if (/(?:chs|gb|简体|簡體|简中|簡中|\bzh-hans\b)/iu.test(text)) hints.push("chs");
  if (/(?:cht|big5|繁体|繁體|繁中|\bzh-hant\b)/iu.test(text)) hints.push("cht");
  if (/(?:chinese|中文|\bzh\b)/iu.test(text)) hints.push("zh");
  if (/(?:eng|english|英文)/iu.test(text)) hints.push("eng");
  return hints;
}

function addUnique(target, values) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  const warnings = [];
  while (stack.length > 0) {
    const current = stack.pop();
    let children;
    try {
      children = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      warnings.push(`cannot_read:${current}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const child of children) {
      const fullPath = path.join(current, child.name);
      if (child.isDirectory()) {
        stack.push(fullPath);
      } else if (child.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return { files, warnings };
}

function detectFlags(name, files) {
  const text = `${name} ${files.map((file) => path.basename(file)).join(" ")}`;
  return {
    looksSeries: /\bS\d{2}\b|\bS\d{1,2}E\d{1,2}\b|season|series|剧集|电视剧|影集/iu.test(text),
    looksUhd: /\b(?:2160p|uhd|4k)\b/iu.test(text),
    looksDv: /\b(?:dovi|dv|dolby\s*vision)\b/iu.test(text),
    looksHdr: /\b(?:hdr|hdr10|hlg)\b/iu.test(text),
    hasBluRayShape: /\b(?:blu-?ray|remux|bdmv|uhd)\b/iu.test(text),
    hasChineseName: /[\u4e00-\u9fff]/u.test(name)
  };
}

function summarizeEntry(entryPath, root, maxSamples) {
  const { files, warnings } = walkFiles(entryPath);
  const subtitleHints = [];
  const media = [];
  let subtitleCount = 0;
  let nfoCount = 0;
  let totalBytes = 0;

  for (const file of files) {
    let stats;
    try {
      stats = statSync(file);
    } catch (error) {
      warnings.push(`cannot_stat:${file}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    totalBytes += stats.size;
    const ext = path.extname(file).toLowerCase();
    if (mediaExt.has(ext)) media.push({ path: file, bytes: stats.size });
    if (subtitleExt.has(ext)) {
      subtitleCount += 1;
      addUnique(subtitleHints, classifySubtitleHint(path.basename(file)));
    }
    if (nfoExt.has(ext)) nfoCount += 1;
  }

  media.sort((a, b) => b.bytes - a.bytes);
  const name = path.basename(entryPath);
  return {
    name,
    relativePath: path.relative(root, entryPath),
    fileCount: files.length,
    mediaCount: media.length,
    subtitleCount,
    nfoCount,
    totalBytes,
    totalGB: Number((totalBytes / 1024 / 1024 / 1024).toFixed(2)),
    largestMedia: media.slice(0, maxSamples).map((item) => ({
      relativePath: path.relative(root, item.path),
      bytes: item.bytes,
      gb: Number((item.bytes / 1024 / 1024 / 1024).toFixed(2)),
      extension: path.extname(item.path).toLowerCase()
    })),
    subtitleHints,
    flags: detectFlags(name, files),
    warnings
  };
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.root) {
    usage();
    process.exitCode = 2;
    return;
  }

  const root = path.resolve(options.root);
  if (!existsSync(root)) throw new Error(`Root does not exist: ${root}`);
  const rootStats = statSync(root);
  if (!rootStats.isDirectory()) throw new Error(`Root is not a directory: ${root}`);

  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeEntry(path.join(root, entry.name), root, options.maxSamples))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const payload = {
    root,
    scannedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries
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
