#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { remapReportToExistingPeople } from "./lib/person-report-identity-remap.mjs";

const args = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(args.report, "utf8"));
const conflicts = JSON.parse(await readFile(args.conflicts, "utf8"));
const output = remapReportToExistingPeople(report, conflicts);
await writeJsonAtomic(args.output, output);
process.stdout.write(`${JSON.stringify({
  reportPath: args.report,
  conflictPath: args.conflicts,
  outputPath: args.output,
  remappedProfiles: output.identityRemaps.length
}, null, 2)}\n`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") result.report = path.resolve(values[++index]);
    else if (value === "--conflicts") result.conflicts = path.resolve(values[++index]);
    else if (value === "--output") result.output = path.resolve(values[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.report || !result.conflicts || !result.output) throw new Error("--report, --conflicts, and --output are required.");
  return result;
}
