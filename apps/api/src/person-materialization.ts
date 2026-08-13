import type {
  MovieCreditEntry,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonBiography,
  PersonBiographyText,
  PersonExternalIds,
  PersonLockedField,
  PersonProfile
} from "@wwpdw/shared";
import {
  decidePersonIdentity,
  normalizePersonExternalIds,
  normalizePersonNameSearchKey
} from "@wwpdw/shared";
import type { PersonEvidence } from "./person-sources/types.js";

export interface MaterializedWorkCredits {
  workId: string;
  title: string;
  credits: MovieCreditEntry[];
}

export interface PersonMaterializationResult {
  profiles: PersonProfile[];
  creditReplacements: MaterializedWorkCredits[];
  unresolved: Array<{ workId?: string; creditName?: string; externalIds?: PersonExternalIds; reason: string }>;
  issues: PersonCatalogIssue[];
  assignments: Record<string, string>;
}

export function materializePersonEvidence(input: {
  state: PersonCatalogState;
  evidence: PersonEvidence[];
  workCredits: MaterializedWorkCredits[];
  allocatePersonId: (externalIds: PersonExternalIds) => string;
  now?: string;
}): PersonMaterializationResult {
  const now = input.now ?? new Date().toISOString();
  const profiles = new Map<string, PersonProfile>(
    Object.values(input.state.people).map((entry) => [entry.profile.personId, structuredClone(entry.profile)])
  );
  const changed = new Set<string>();
  const assignments: Record<string, string> = {};
  const unresolved: PersonMaterializationResult["unresolved"] = [];
  const issues: PersonCatalogIssue[] = [];

  for (const evidence of sortedEvidence(input.evidence)) {
    const externalIds = normalizePersonExternalIds(evidence.externalIds);
    const key = externalIdentityKey(externalIds);
    if (!key) {
      unresolved.push({ externalIds, reason: "missing_stable_external_id" });
      continue;
    }
    const decision = decidePersonIdentity(externalIds, [...profiles.values()].map((profile) => ({
      personId: profile.personId,
      externalIds: profile.externalIds
    })));
    if (decision.action === "conflict") {
      issues.push({
        kind: "external_id_conflict",
        message: `Person evidence conflicts across ${decision.sources.join(", ")}.`,
        personIds: decision.personIds
      });
      unresolved.push({ externalIds, reason: decision.reason });
      continue;
    }
    if (decision.action === "unresolved") {
      unresolved.push({ externalIds, reason: decision.reason });
      continue;
    }
    const personId = decision.action === "match" ? decision.personId : input.allocatePersonId(externalIds);
    if (!personId.trim()) throw new Error("Person ID allocator returned an empty ID.");
    const current = profiles.get(personId);
    const next = mergeEvidence(current, personId, externalIds, evidence, now);
    profiles.set(personId, next);
    changed.add(personId);
    for (const idKey of externalIdentityKeys(externalIds)) assignments[idKey] = personId;
  }

  const creditReplacements = input.workCredits.map((work) => ({
    ...work,
    credits: work.credits.map((credit) => {
      const personId = externalIdentityKeys(normalizePersonExternalIds(credit.externalIds))
        .map((idKey) => assignments[idKey] ?? personIdFromStateIndex(input.state, idKey))
        .find(Boolean);
      if (!personId) {
        unresolved.push({
          workId: work.workId,
          creditName: credit.name,
          externalIds: normalizePersonExternalIds(credit.externalIds),
          reason: "credit_identity_not_materialized"
        });
        return credit;
      }
      return { ...credit, personId };
    })
  }));

  for (const work of creditReplacements) {
    for (const credit of work.credits) {
      if (!credit.personId || !changed.has(credit.personId)) continue;
      const profile = profiles.get(credit.personId);
      if (!profile) continue;
      profile.departments = [...new Set([...(profile.departments ?? []), credit.department])].sort();
    }
  }

  return {
    profiles: [...changed].sort().map((personId) => profiles.get(personId)!),
    creditReplacements,
    unresolved,
    issues,
    assignments
  };
}

function mergeEvidence(
  current: PersonProfile | undefined,
  personId: string,
  externalIds: PersonExternalIds,
  evidence: PersonEvidence,
  now: string
): PersonProfile {
  const locked = new Set(current?.lockedFields ?? []);
  return {
    personId,
    names: uniqueNames([...(current?.names ?? []), ...evidence.names]),
    externalIds: { ...(current?.externalIds ?? {}), ...externalIds },
    departments: current?.departments ?? [],
    biography: mergeBiography(current?.biography, evidence.biography, locked),
    profileImages: locked.has("profileUrl") ? current?.profileImages : uniqueImages([...(current?.profileImages ?? []), ...(evidence.images ?? [])]),
    sourceRefs: uniqueSourceRefs([...(current?.sourceRefs ?? []), ...evidence.sourceRefs]),
    lockedFields: current?.lockedFields,
    hiddenFromWebsite: current?.hiddenFromWebsite,
    dataQuality: {
      status: current?.dataQuality.status === "verified" ? "verified" : "partial",
      issues: current?.dataQuality.issues,
      updatedAt: now
    },
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
}

function mergeBiography(
  current: PersonBiography | undefined,
  incoming: PersonBiography | undefined,
  locked: Set<PersonLockedField>
): PersonBiography | undefined {
  if (!incoming) return current;
  const currentTextKeys = new Set((current?.texts ?? []).map(biographyTextKey));
  const mergedTexts = uniqueBiographyTexts([...(current?.texts ?? []), ...(incoming.texts ?? [])]);
  const texts = mergedTexts.filter((entry) => {
    if (/^zh(?:-|$)/i.test(entry.language) && locked.has("biographyZh")) {
      return currentTextKeys.has(biographyTextKey(entry));
    }
    if (/^en(?:-|$)/i.test(entry.language) && locked.has("biographyEn")) {
      return currentTextKeys.has(biographyTextKey(entry));
    }
    return true;
  });
  return {
    ...current,
    ...incoming,
    ...(texts.length ? { texts } : {})
  };
}

function sortedEvidence(values: PersonEvidence[]) {
  return values.slice().sort((left, right) => (externalIdentityKey(normalizePersonExternalIds(left.externalIds)) ?? "")
    .localeCompare(externalIdentityKey(normalizePersonExternalIds(right.externalIds)) ?? ""));
}

function externalIdentityKey(ids: PersonExternalIds) {
  return externalIdentityKeys(ids)[0];
}

function externalIdentityKeys(ids: PersonExternalIds) {
  return (["tmdb", "imdb", "wikidata"] as const)
    .flatMap((source) => ids[source] ? [`${source}:${ids[source]}`] : []);
}

function personIdFromStateIndex(state: PersonCatalogState, key: string) {
  const separator = key.indexOf(":");
  const source = key.slice(0, separator) as keyof PersonCatalogState["externalIdIndex"];
  const id = key.slice(separator + 1);
  return state.externalIdIndex[source]?.[id];
}

function uniqueNames(values: PersonProfile["names"]) {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = `${normalizePersonNameSearchKey(entry.value)}:${entry.language ?? ""}:${entry.kind}:${entry.source}:${entry.status}`;
    if (!normalizePersonNameSearchKey(entry.value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueImages(values: NonNullable<PersonProfile["profileImages"]>) {
  return [...new Map(values.map((image) => [image.url, image])).values()];
}

function uniqueSourceRefs(values: NonNullable<PersonProfile["sourceRefs"]>) {
  return [...new Map(values.map((ref) => [`${ref.source}:${ref.id ?? ""}:${ref.url ?? ""}`, ref])).values()];
}

function uniqueBiographyTexts(values: PersonBiographyText[]) {
  return [...new Map(values.map((entry) => [
    biographyTextKey(entry),
    { ...entry, value: entry.value.trim() }
  ])).values()];
}

function biographyTextKey(entry: PersonBiographyText) {
  return `${entry.language.toLocaleLowerCase("und")}:${entry.source}:${entry.value.trim()}`;
}
