import { readFile } from "node:fs/promises";
import path from "node:path";

import { applyReviewedChineseBiographies, applyReviewedCreditNames } from "../apps/api/src/person-biography-review.ts";
import { writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report);
const reviewsPath = path.resolve(args.reviews);
const outputPath = path.resolve(args.output);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const reviewPackage = JSON.parse(await readFile(reviewsPath, "utf8"));
const reviews = Array.isArray(reviewPackage) ? reviewPackage : reviewPackage.biographies;
if (!Array.isArray(reviews)) throw new Error("Biography review file must contain an array or a biographies array.");
const reviewed = applyReviewedChineseBiographies(report, reviews, new Date().toISOString());
const next = applyReviewedCreditNames(reviewed, reviews, Array.isArray(reviewPackage) ? {} : reviewPackage.creditNameOverrides);
await writeJsonAtomic(outputPath, next);
process.stdout.write(`${JSON.stringify({ reportPath, reviewsPath, outputPath, reviewed: reviews.length, profiles: next.proposedProfiles.length }, null, 2)}\n`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") result.report = values[++index];
    else if (value === "--reviews") result.reviews = values[++index];
    else if (value === "--output") result.output = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  for (const key of ["report", "reviews", "output"]) if (!result[key]) throw new Error(`--${key} is required.`);
  return result;
}
