#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { markMetadataOnlyWork } from "./lib/person-metadata-only-report.mjs";

const options = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(options.report);
const outputPath = path.resolve(options.output);
const report = JSON.parse(await readFile(inputPath, "utf8"));
const result = markMetadataOnlyWork(report, options);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "ok", inputPath, outputPath, workId: options.workId, sourcePageId: options.sourcePageId }, null, 2)}\n`);

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") options.report = values[++index];
    else if (value === "--output") options.output = values[++index];
    else if (value === "--work-id") options.workId = values[++index];
    else if (value === "--source-page-id") options.sourcePageId = values[++index];
    else if (value === "--source-work-id") options.sourceWorkId = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  for (const key of ["report", "output", "workId", "sourcePageId"]) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required.`);
  }
  return options;
}
