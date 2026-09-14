#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";

const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(args.output);
const outputDirectory = path.dirname(outputPath);
const selectedPersonIds = new Set(args.selectPersonIds);
const explicitKeepLinkedPersonIds = new Set(args.keepLinkedPersonIds);
const inheritedKeepLinkedPersonIds = new Set();
for (const reportValue of args.keepLinkedReports) {
  const report = JSON.parse(await readFile(path.resolve(reportValue), "utf8"));
  for (const work of report.proposedCredits ?? []) {
    for (const credit of work.credits ?? []) {
      if (credit.personId) inheritedKeepLinkedPersonIds.add(credit.personId);
    }
  }
}
const subsetMode = selectedPersonIds.size > 0
  || explicitKeepLinkedPersonIds.size > 0
  || inheritedKeepLinkedPersonIds.size > 0
  || Object.keys(args.creditNameOverrides).length > 0;
const inputs = [];
let profileCount = 0;
const foundSelectedPersonIds = new Set();
for (const reportValue of args.reports) {
  const reportPath = path.resolve(reportValue);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if ((report.identityIssues?.length ?? 0) > 0) throw new Error(`${reportPath} contains identity issues.`);
  if (!subsetMode && !args.profilesOnly && (report.unresolved?.length ?? 0) > 0) throw new Error(`${reportPath} contains unresolved credits.`);
  const availableProfilePersonIds = (report.proposedProfiles ?? []).map((profile) => profile.personId);
  const profilePersonIds = subsetMode
    ? availableProfilePersonIds.filter((personId) => selectedPersonIds.has(personId))
    : availableProfilePersonIds;
  for (const personId of profilePersonIds) foundSelectedPersonIds.add(personId);
  if (profilePersonIds.length === 0) throw new Error(`${reportPath} contains no proposed profiles.`);
  if (new Set(profilePersonIds).size !== profilePersonIds.length) throw new Error(`${reportPath} contains duplicate Person IDs.`);
  profileCount += profilePersonIds.length;
  const availableCreditPersonIds = new Set((report.proposedCredits ?? [])
    .flatMap((work) => work.credits ?? [])
    .map((credit) => credit.personId)
    .filter(Boolean));
  const keepLinkedPersonIds = subsetMode
    ? [...new Set([
        ...profilePersonIds,
        ...[...explicitKeepLinkedPersonIds].filter((personId) => availableCreditPersonIds.has(personId)),
        ...[...inheritedKeepLinkedPersonIds].filter((personId) => availableCreditPersonIds.has(personId))
      ])]
    : profilePersonIds;
  inputs.push({
    report: normalizeRelativePath(path.relative(outputDirectory, reportPath)),
    profilePersonIds,
    keepLinkedPersonIds,
    ...(args.profilesOnly ? { profilesOnly: true } : {}),
    ...(Object.keys(args.creditNameOverrides).length > 0 ? { creditNameOverrides: args.creditNameOverrides } : {})
  });
}
const missingSelectedPersonIds = [...selectedPersonIds].filter((personId) => !foundSelectedPersonIds.has(personId));
if (missingSelectedPersonIds.length > 0) throw new Error(`Selected Person IDs were not found: ${missingSelectedPersonIds.join(", ")}`);
if (profileCount > 20) throw new Error(`Batch has ${profileCount} input profiles; maximum is 20 before cross-report identity merging.`);
await writeJsonAtomic(outputPath, { inputs });
process.stdout.write(`${JSON.stringify({
  outputPath,
  reportCount: inputs.length,
  profileCount,
  keptLinkedPersonCount: new Set(inputs.flatMap((input) => input.keepLinkedPersonIds)).size,
  subsetMode
}, null, 2)}\n`);

function normalizeRelativePath(value) {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function parseArgs(values) {
  const result = {
    reports: [],
    keepLinkedReports: [],
    selectPersonIds: [],
    keepLinkedPersonIds: [],
    creditNameOverrides: {},
    output: undefined
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") result.reports.push(values[++index]);
    else if (value === "--select-person-id") result.selectPersonIds.push(values[++index]);
    else if (value === "--keep-linked-person-id") result.keepLinkedPersonIds.push(values[++index]);
    else if (value === "--keep-linked-from-report") result.keepLinkedReports.push(values[++index]);
    else if (value === "--credit-name-override") {
      const entry = values[++index];
      const separator = entry.indexOf("=");
      if (separator <= 0 || separator === entry.length - 1) throw new Error("--credit-name-override must use <external-id>=<name>.");
      result.creditNameOverrides[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    else if (value === "--output") result.output = values[++index];
    else if (value === "--profiles-only") result.profilesOnly = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (result.reports.length === 0 || !result.output) throw new Error("At least one --report and --output are required.");
  if (result.selectPersonIds.length === 0 && (result.keepLinkedReports.length > 0 || result.keepLinkedPersonIds.length > 0 || Object.keys(result.creditNameOverrides).length > 0)) {
    throw new Error("--select-person-id is required when generating a subset batch.");
  }
  return result;
}
