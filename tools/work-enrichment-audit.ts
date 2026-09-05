#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessWorkEnrichment,
  type HighlightGateStatus,
  type WorkEnrichmentInput
} from "../apps/api/src/work-enrichment.js";

function parseArgs(argv: string[]) {
  let input = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") input = argv[++index] ?? "";
    else if (argv[index] === "--json") continue;
    else if (!argv[index].startsWith("-") && !input) input = argv[index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!input) throw new Error("an input JSON file or --input <json-file> is required");
  return { input: resolve(input) };
}

function main() {
  const { input } = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(readFileSync(input, "utf8")) as { works?: WorkEnrichmentInput[] };
  if (!Array.isArray(payload.works)) throw new Error("input must contain a works array");
  const works = payload.works.map(assessWorkEnrichment);
  const byHighlightStatus = works.reduce<Partial<Record<HighlightGateStatus, number>>>((counts, work) => {
    const status = work.highlights.status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const manualConfirmations = works
    .filter((work) => work.needsHumanConfirmation)
    .map((work) => ({ workId: work.workId, reasons: work.humanConfirmationReasons }));
  const blocked = works
    .filter((work) => work.highlights.blockedBy.length > 0)
    .map((work) => ({
      workId: work.workId,
      status: work.highlights.status,
      missingFields: work.highlights.missingFields,
      nextAction: work.highlights.nextAction
    }));

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    input,
    summary: {
      total: works.length,
      byHighlightStatus,
      blocked: blocked.length,
      needsHumanConfirmation: manualConfirmations.length
    },
    blocked,
    manualConfirmations,
    works
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
