#!/usr/bin/env node

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPersonCatalogStore } from "@wwpdw/cache-store";
import { buildMetadataOnlyPeopleCoverage } from "./lib/person-metadata-only-coverage.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.backend) process.env.PERSON_CATALOG_BACKEND = options.backend;
const store = createPersonCatalogStore();
const catalog = await store.getState();
const report = buildMetadataOnlyPeopleCoverage(catalog, options);
report.catalogSource = store.description;
const outputPath = path.resolve(options.output);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--backend") options.backend = values[++index];
    else if (value === "--work-id") options.workId = values[++index];
    else if (value === "--source-page-id") options.sourcePageId = values[++index];
    else if (value === "--expected-credit-count") options.expectedCreditCount = values[++index];
    else if (value === "--output") options.output = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  for (const key of ["workId", "sourcePageId", "expectedCreditCount", "output"]) {
    if (!options[key]) throw new Error(`Missing required ${key} option.`);
  }
  return options;
}
