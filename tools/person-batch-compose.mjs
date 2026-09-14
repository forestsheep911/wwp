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
const creditIdentityProfiles = [];
const creditIdentityProfileIds = new Set();
const selectedPersonIdByExternalKey = new Map();
const conflictingExternalKeys = new Set();
const profileByPersonId = new Map();
const canonicalPersonIdByIncomingId = new Map();

for (const input of config.inputs) {
  const report = JSON.parse(await readFile(path.resolve(path.dirname(configPath), input.report), "utf8"));
  for (const profile of report.proposedProfiles ?? []) {
    if (creditIdentityProfileIds.has(profile.personId)) continue;
    creditIdentityProfileIds.add(profile.personId);
    creditIdentityProfiles.push(profile);
  }
  const selected = new Set(input.profilePersonIds);
  const linked = new Set(input.keepLinkedPersonIds);
  const selectedProfiles = report.proposedProfiles.filter((profile) => selected.has(profile.personId));
  if (selectedProfiles.length !== selected.size) {
    const found = new Set(selectedProfiles.map((profile) => profile.personId));
    throw new Error(`Missing selected profiles: ${[...selected].filter((id) => !found.has(id)).join(", ")}`);
  }
  for (const profile of selectedProfiles) {
    const keys = externalKeys(profile.externalIds);
    const matchedPersonIds = new Set(keys.map((key) => selectedPersonIdByExternalKey.get(key)).filter(Boolean));
    if (matchedPersonIds.size === 1) {
      const canonicalPersonId = [...matchedPersonIds][0];
      const canonicalProfile = profileByPersonId.get(canonicalPersonId);
      const sharedKeyCount = keys.filter((key) => selectedPersonIdByExternalKey.get(key) === canonicalPersonId).length;
      if (canonicalProfile && sharedKeyCount >= 2 && !hasContraryExternalId(canonicalProfile.externalIds, profile.externalIds)) {
        canonicalPersonIdByIncomingId.set(profile.personId, canonicalPersonId);
        mergeProfile(canonicalProfile, profile);
        continue;
      }
    }
    proposedProfiles.push(profile);
    profileByPersonId.set(profile.personId, profile);
    for (const key of keys) {
      const previous = selectedPersonIdByExternalKey.get(key);
      if (previous && previous !== profile.personId) {
        conflictingExternalKeys.add(key);
        identityIssues.push({
          reason: "external_id_conflict",
          externalKey: key,
          personIds: [previous, profile.personId],
          report: input.report
        });
        continue;
      }
      if (!conflictingExternalKeys.has(key)) selectedPersonIdByExternalKey.set(key, profile.personId);
    }
    if (matchedPersonIds.size > 1) {
      identityIssues.push({
        reason: "external_identity_split_owners",
        personIds: [...matchedPersonIds, profile.personId],
        report: input.report
      });
    } else if (matchedPersonIds.size === 1) {
      identityIssues.push({
        reason: "external_identity_insufficient_match",
        personIds: [[...matchedPersonIds][0], profile.personId],
        report: input.report
      });
    }
  }
  const selectedExternalKeys = new Set(selectedProfiles.flatMap((profile) => Object.entries(profile.externalIds ?? {}).map(([source, id]) => `${source}:${id}`)));
  proposedPeople.push(...(report.proposedPeople ?? []).filter((person) => Object.entries(person.externalIds ?? {}).some(([source, id]) => selectedExternalKeys.has(`${source}:${id}`))));
  identityIssues.push(...(report.identityIssues ?? []));
  for (const work of input.profilesOnly ? [] : report.proposedCredits) {
    proposedCredits.push({
      ...work,
      ...(input.creditReplacement ? { creditReplacement: input.creditReplacement } : {}),
      credits: work.credits.map((credit) => {
        const wikidataId = credit.externalIds?.wikidata;
        const overrideName = wikidataId ? input.creditNameOverrides?.[wikidataId] : undefined;
        const next = { ...credit, ...(overrideName ? { name: overrideName } : {}) };
        const originalPersonId = next.personId;
        if (originalPersonId && !linked.has(originalPersonId)) delete next.personId;
        else if (originalPersonId) next.personId = canonicalPersonIdByIncomingId.get(originalPersonId) ?? originalPersonId;
        if (!next.personId) {
          const creditKey = externalKey(next.externalIds);
          const mappedPersonId = creditKey && !conflictingExternalKeys.has(creditKey)
            ? selectedPersonIdByExternalKey.get(creditKey)
            : undefined;
          if (mappedPersonId) next.personId = mappedPersonId;
        }
        return next;
      })
    });
  }
}

function externalKey(ids = {}) {
  for (const source of ["wikidata", "imdb", "tmdb"]) {
    const value = ids[source];
    if (typeof value === "string" && value.trim()) return `${source}:${value.trim().toLowerCase()}`;
  }
  return null;
}

function externalKeys(ids = {}) {
  return Object.entries(ids)
    .map(([source, id]) => typeof id === "string" && id.trim() ? `${source}:${id.trim().toLowerCase()}` : null)
    .filter(Boolean);
}

function hasContraryExternalId(left = {}, right = {}) {
  return Object.keys(left).some((source) => left[source] && right[source] && left[source].trim().toLowerCase() !== right[source].trim().toLowerCase());
}

function mergeProfile(target, incoming) {
  target.departments = [...new Set([...(target.departments ?? []), ...(incoming.departments ?? [])])];
  target.names = dedupeBy(target.names ?? [], incoming.names ?? [], (name) => `${name.language}:${name.kind}:${name.value}`);
  target.profileImages = dedupeBy(target.profileImages ?? [], incoming.profileImages ?? [], (image) => image.url);
  target.sourceRefs = dedupeBy(target.sourceRefs ?? [], incoming.sourceRefs ?? [], (source) => `${source.source}:${source.id ?? source.url}`);
  if (target.biography && incoming.biography) {
    target.biography.texts = dedupeBy(target.biography.texts ?? [], incoming.biography.texts ?? [], (entry) => `${entry.language}:${entry.value}`);
  }
}

function dedupeBy(left, right, keyOf) {
  const seen = new Set();
  return [...left, ...right].filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  creditIdentityProfiles,
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
