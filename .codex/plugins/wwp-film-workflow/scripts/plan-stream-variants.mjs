#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/plan-stream-variants.mjs --matrix <variants.json> [--output <plan.json>]

Matrix JSON shape:
{
  "variants": [
    {
      "name": "original-chteng",
      "sourceVideoKey": "feature",
      "videoFilterKey": "hevc-main",
      "hardSubtitleKey": "chteng",
      "softSubtitleKey": "",
      "audioKey": "original"
    }
  ]
}

The planner explains whether each variant needs a new video encode, can reuse video,
can remux, or changes only soft subtitles.
`);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--matrix" || arg === "-m") options.matrix = argv[++i];
    else if (arg === "--output" || arg === "-o") options.output = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function stringKey(value, fallback = "none") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function visualKey(variant) {
  return [
    `video:${stringKey(variant.sourceVideoKey, "source")}`,
    `filter:${stringKey(variant.videoFilterKey, "default")}`,
    `hardSub:${stringKey(variant.hardSubtitleKey)}`
  ].join("|");
}

function muxKey(variant) {
  return [
    visualKey(variant),
    `audio:${stringKey(variant.audioKey)}`,
    `softSub:${stringKey(variant.softSubtitleKey)}`
  ].join("|");
}

function plan(matrix) {
  if (!matrix || !Array.isArray(matrix.variants)) {
    throw new Error("Matrix must contain a variants array.");
  }

  const visuals = new Map();
  const muxes = new Map();
  return matrix.variants.map((variant, index) => {
    const name = stringKey(variant.name, `variant-${index + 1}`);
    const vKey = visualKey(variant);
    const mKey = muxKey(variant);
    const priorVisual = visuals.get(vKey);
    const priorMux = muxes.get(mKey);
    let action;
    let reuseFrom = null;
    let reason;

    if (!priorVisual) {
      action = "encode-video";
      reason = "No prior variant has the same source video, filters, and hard subtitles.";
      visuals.set(vKey, name);
    } else if (!priorMux) {
      action = "reuse-video-remux-or-audio-encode";
      reuseFrom = priorVisual;
      reason = "Visual stream matches an earlier variant; audio or soft subtitles differ.";
    } else {
      action = "duplicate-or-label-only";
      reuseFrom = priorMux;
      reason = "Video, audio, and soft subtitle keys match an earlier variant.";
    }

    muxes.set(mKey, name);
    return {
      name,
      action,
      reuseFrom,
      visualKey: vKey,
      muxKey: mKey,
      reason
    };
  });
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
  if (!options.matrix) {
    usage();
    process.exitCode = 2;
    return;
  }
  const matrix = JSON.parse(readFileSync(options.matrix, "utf8"));
  const result = { plannedAt: new Date().toISOString(), variants: plan(matrix) };
  const json = `${JSON.stringify(result, null, 2)}\n`;
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
