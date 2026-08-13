import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(args.config);
const outputPath = path.resolve(args.output);
const config = JSON.parse(await readFile(configPath, "utf8"));
const proposedProfiles = [];
const proposedPeople = [];
const proposedCredits = [];
const identityIssues = [];

for (const input of config.inputs) {
  const report = JSON.parse(await readFile(path.resolve(path.dirname(configPath), input.report), "utf8"));
  const selected = new Set(input.profilePersonIds);
  const linked = new Set(input.keepLinkedPersonIds);
  const selectedProfiles = report.proposedProfiles.filter((profile) => selected.has(profile.personId));
  if (selectedProfiles.length !== selected.size) {
    const found = new Set(selectedProfiles.map((profile) => profile.personId));
    throw new Error(`Missing selected profiles: ${[...selected].filter((id) => !found.has(id)).join(", ")}`);
  }
  proposedProfiles.push(...selectedProfiles);
  const selectedExternalKeys = new Set(selectedProfiles.flatMap((profile) => Object.entries(profile.externalIds ?? {}).map(([source, id]) => `${source}:${id}`)));
  proposedPeople.push(...(report.proposedPeople ?? []).filter((person) => Object.entries(person.externalIds ?? {}).some(([source, id]) => selectedExternalKeys.has(`${source}:${id}`))));
  identityIssues.push(...(report.identityIssues ?? []));
  for (const work of report.proposedCredits) {
    proposedCredits.push({
      ...work,
      credits: work.credits.map((credit) => {
        const wikidataId = credit.externalIds?.wikidata;
        const overrideName = wikidataId ? input.creditNameOverrides?.[wikidataId] : undefined;
        const next = { ...credit, ...(overrideName ? { name: overrideName } : {}) };
        if (next.personId && !linked.has(next.personId)) delete next.personId;
        return next;
      })
    });
  }
}

const profileIds = new Set(proposedProfiles.map((profile) => profile.personId));
if (profileIds.size !== proposedProfiles.length) throw new Error("Selected profiles contain duplicate person IDs.");
const unresolved = proposedCredits.flatMap((work) => work.credits.filter((credit) => !credit.personId).map((credit) => ({
  workId: work.workId,
  creditName: credit.name,
  reason: "credit_identity_not_materialized"
})));
const output = {
  schemaVersion: 1,
  mode: "curated-multi-work-batch",
  generatedAt: new Date().toISOString(),
  proposedPeople,
  proposedProfiles,
  proposedCredits,
  identityIssues,
  unresolved
};
await writeJsonAtomic(outputPath, output);
process.stdout.write(`${JSON.stringify({ configPath, outputPath, profiles: proposedProfiles.length, works: proposedCredits.length, linkedCredits: proposedCredits.flatMap((work) => work.credits).filter((credit) => credit.personId).length, unresolved: unresolved.length }, null, 2)}\n`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--config") result.config = values[++index];
    else if (values[index] === "--output") result.output = values[++index];
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!result.config || !result.output) throw new Error("--config and --output are required.");
  return result;
}
