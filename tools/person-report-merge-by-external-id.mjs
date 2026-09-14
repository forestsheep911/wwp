#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const base = JSON.parse(await fs.readFile(args.base, "utf8"));
const expansion = JSON.parse(await fs.readFile(args.expansion, "utf8"));

if (base.identityIssues?.length || expansion.identityIssues?.length) {
  throw new Error("Cannot merge reports containing identity issues.");
}
if (base.proposedCredits?.length !== 1 || expansion.proposedCredits?.length !== 1) {
  throw new Error("This merge requires exactly one work in each report.");
}
if (base.proposedCredits[0].workId !== expansion.proposedCredits[0].workId) {
  throw new Error("Base and expansion reports target different works.");
}

const profiles = [...(base.proposedProfiles ?? [])];
const profileByKey = new Map();
for (const profile of profiles) indexProfile(profileByKey, profile);

const idMap = new Map();
for (const profile of expansion.proposedProfiles ?? []) {
  const key = externalKey(profile.externalIds);
  if (!key) throw new Error(`Expansion profile has no stable external ID: ${profile.personId}`);
  const existing = profileByKey.get(key);
  if (!existing) {
    profiles.push(profile);
    profileByKey.set(key, profile);
    idMap.set(profile.personId, profile.personId);
  } else {
    // Repeated identity passes may mint a new local ID for the same stable
    // external identity. Keep the existing profile ID canonical and remap its
    // credits instead of treating the regenerated ID as a conflict.
    idMap.set(profile.personId, existing.personId);
  }
}

const credits = structuredClone(base.proposedCredits[0].credits ?? []);
const creditByKey = new Map(credits.map((credit) => [externalKey(credit.externalIds), credit]).filter(([key]) => key));
for (const credit of expansion.proposedCredits[0].credits ?? []) {
  const key = externalKey(credit.externalIds);
  const target = key ? creditByKey.get(key) : undefined;
  if (!target) continue;
  const mappedId = credit.personId ? idMap.get(credit.personId) : undefined;
  if (mappedId && !target.personId) target.personId = mappedId;
}

// A person can have multiple departments on the same work. If one department
// was linked in an earlier pass and a later pass only carries the other credit,
// reuse the stable external identity's existing canonical profile ID.
const personIdByExternalKey = new Map(
  credits
    .map((credit) => [externalKey(credit.externalIds), credit.personId])
    .filter(([key, personId]) => key && personId)
);
for (const credit of credits) {
  if (credit.personId) continue;
  const personId = personIdByExternalKey.get(externalKey(credit.externalIds));
  if (personId) credit.personId = personId;
}

const proposedPeople = dedupeByKey([...(base.proposedPeople ?? []), ...(expansion.proposedPeople ?? [])]);
const output = {
  ...structuredClone(base),
  generatedAt: new Date().toISOString(),
  proposedPeople,
  proposedProfiles: profiles,
  proposedCredits: [{ ...structuredClone(base.proposedCredits[0]), credits }],
  identityIssues: [],
  unresolved: credits.filter((credit) => !credit.personId).map((credit) => ({
    workId: base.proposedCredits[0].workId,
    creditName: credit.name,
    reason: "credit_identity_not_materialized"
  }))
};

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: args.output,
  profiles: output.proposedProfiles.length,
  linkedCredits: credits.filter((credit) => credit.personId).length,
  unresolved: output.unresolved.length,
  identityIssues: output.identityIssues.length
}, null, 2));

function externalKey(ids = {}) {
  for (const source of ["wikidata", "imdb", "tmdb"]) {
    const value = ids[source];
    if (typeof value === "string" && value.trim()) return `${source}:${value.trim().toLowerCase()}`;
  }
  return null;
}

function indexProfile(map, profile) {
  const key = externalKey(profile.externalIds);
  if (key) {
    const previous = map.get(key);
    if (previous && previous.personId !== profile.personId) throw new Error(`Base report has duplicate identity: ${key}`);
    map.set(key, profile);
  }
}

function dedupeByKey(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = externalKey(item.externalIds) ?? JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--base") result.base = path.resolve(values[++index]);
    else if (values[index] === "--expansion") result.expansion = path.resolve(values[++index]);
    else if (values[index] === "--output") result.output = path.resolve(values[++index]);
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!result.base || !result.expansion || !result.output) throw new Error("--base, --expansion and --output are required.");
  return result;
}
