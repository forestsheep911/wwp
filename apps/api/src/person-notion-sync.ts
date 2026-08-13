import type {
  MovieCreditDepartment,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonBiographyText,
  PersonNameEntry,
  PersonNameStatus,
  PersonProfile
} from "@wwpdw/shared";
import { normalizePersonExternalIds, normalizePersonNameSearchKey } from "@wwpdw/shared";
import { rebuildDerivedPersonIndexes, type PersonCatalogStore } from "@wwpdw/cache-store";
import type { NotionPeopleChange, NotionPeopleSnapshot } from "./notion-people-source.js";
import { reviewChineseBiography, reviewEnglishBiography, splitBiographySourceRefs } from "./person-biography-quality.js";

export interface PeopleNotionSyncCheckpoint {
  schemaVersion: 1;
  lastSuccessfulSyncAt?: string;
  lastSourceEditedAt?: string;
}

export interface PeopleNotionSyncPlan {
  nextCatalog: PersonCatalogState;
  catalogChanged: boolean;
  summary: {
    scanned: number;
    applied: number;
    unchanged: number;
    quarantined: number;
    invalid: number;
    issueCount: number;
  };
}

export function planPeopleNotionSync(
  current: PersonCatalogState,
  changes: NotionPeopleChange[],
  generatedAt = new Date().toISOString()
): PeopleNotionSyncPlan {
  const next = structuredClone(current);
  const pageIds = new Set(changes.map((change) => change.pageId));
  next.issues = next.issues.filter((issue) => !issue.notionPageId || !pageIds.has(issue.notionPageId));
  const issues: PersonCatalogIssue[] = [];
  const valid = changes.filter((change): change is NotionPeopleSnapshot => !("error" in change));
  const invalid = changes.filter((change): change is Extract<NotionPeopleChange, { error: string }> => "error" in change);
  for (const change of invalid) {
    issues.push({
      kind: "notion_row_invalid",
      message: change.error,
      notionPageId: change.pageId
    });
  }

  const rowsByPersonId = new Map<string, NotionPeopleSnapshot[]>();
  for (const row of valid) rowsByPersonId.set(row.personId, [...(rowsByPersonId.get(row.personId) ?? []), row]);
  const duplicatePersonIds = new Set(
    [...rowsByPersonId.entries()].filter(([, rows]) => rows.length > 1).map(([personId]) => personId)
  );
  for (const personId of duplicatePersonIds) {
    for (const row of rowsByPersonId.get(personId) ?? []) {
      issues.push({
        kind: "notion_identity_conflict",
        message: `Multiple Notion People rows use immutable Person ID ${personId}.`,
        personIds: [personId],
        notionPageId: row.pageId
      });
    }
  }

  let applied = 0;
  let unchanged = 0;
  let quarantined = duplicatePersonIds.size;
  for (const row of valid) {
    if (duplicatePersonIds.has(row.personId)) continue;
    const entry = next.people[row.personId];
    if (!entry) {
      issues.push({
        kind: "notion_identity_conflict",
        message: `Notion People row references unknown Person ID ${row.personId}; automatic sync never creates identity.`,
        personIds: [row.personId],
        notionPageId: row.pageId
      });
      quarantined += 1;
      continue;
    }
    const existingNotionPages = (entry.profile.sourceRefs ?? [])
      .filter((ref) => ref.source === "notion" && ref.id)
      .map((ref) => ref.id!);
    if (existingNotionPages.length > 0 && !existingNotionPages.includes(row.pageId)) {
      issues.push({
        kind: "notion_identity_conflict",
        message: `A different Notion row is already bound to immutable Person ID ${row.personId}.`,
        personIds: [row.personId],
        notionPageId: row.pageId
      });
      quarantined += 1;
      continue;
    }
    const identityConflict = externalIdConflict(entry.profile, row);
    if (identityConflict) {
      issues.push({
        kind: "notion_identity_conflict",
        message: `Notion ${identityConflict.source} ID differs from the runtime identity; the row was quarantined.`,
        personIds: [row.personId],
        notionPageId: row.pageId,
        ...(identityConflict.incoming ? { externalId: { source: identityConflict.source, id: identityConflict.incoming } } : {})
      });
      quarantined += 1;
      continue;
    }

    const biographyReview = reviewChineseBiography({
      text: row.biographyZh,
      method: row.biographyZhMethod,
      sourceRefs: splitBiographySourceRefs(row.sources)
    });
    if (row.biographyZhStatus === "verified" && !biographyReview.eligibleForVerified) {
      issues.push({
        kind: "biography_verification_incomplete",
        message: biographyReview.issues.join(" "),
        personIds: [row.personId],
        notionPageId: row.pageId
      });
    }
    const englishBiographyReview = reviewEnglishBiography({
      text: row.biographyEn,
      method: row.biographyEnMethod,
      sourceRefs: splitBiographySourceRefs(row.sources)
    });
    if (row.biographyEnStatus === "verified" && !englishBiographyReview.eligibleForVerified) {
      issues.push({
        kind: "biography_verification_incomplete",
        message: englishBiographyReview.issues.join(" "),
        personIds: [row.personId],
        notionPageId: row.pageId
      });
    }
    const profile = profileFromNotion(entry.profile, row, biographyReview.eligibleForVerified, englishBiographyReview.eligibleForVerified);
    if (sameJson(profile, entry.profile)) unchanged += 1;
    else {
      entry.profile = profile;
      entry.updatedAt = row.lastEditedTime;
      applied += 1;
    }
  }

  next.issues.push(...issues);
  rebuildDerivedPersonIndexes(next);
  const catalogChanged = !sameJson(catalogComparable(current), catalogComparable(next));
  if (catalogChanged) {
    next.generatedAt = generatedAt;
    next.source = {
      kind: current.source?.kind === "movie-catalog" ? "mixed" : (current.source?.kind ?? "mixed"),
      workCount: Object.keys(next.creditsByWorkId).length
    };
  } else {
    next.generatedAt = current.generatedAt;
    next.source = structuredClone(current.source);
  }
  return {
    nextCatalog: next,
    catalogChanged,
    summary: {
      scanned: changes.length,
      applied,
      unchanged,
      quarantined,
      invalid: invalid.length,
      issueCount: issues.length
    }
  };
}

export async function runPeopleNotionSync(input: {
  source: { listChanged(options?: { since?: string; limit?: number; pageSize?: number }): Promise<NotionPeopleChange[]> };
  store: PersonCatalogStore;
  checkpoint: PeopleNotionSyncCheckpoint;
  apply: boolean;
  limit?: number;
  pageSize?: number;
  overlapMinutes?: number;
  now?: () => Date;
  persistCheckpoint?: (checkpoint: PeopleNotionSyncCheckpoint) => Promise<void>;
}) {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const since = withOverlap(input.checkpoint.lastSuccessfulSyncAt, input.overlapMinutes ?? 10);
  const changes = await input.source.listChanged({ since, limit: input.limit, pageSize: input.pageSize });
  const current = await input.store.getState();
  const plan = planPeopleNotionSync(current, changes, startedAt);
  const lastSourceEditedAt = changes.map((change) => change.lastEditedTime).sort().at(-1);
  if (input.apply) {
    if (plan.catalogChanged) await input.store.replaceState(plan.nextCatalog);
    input.checkpoint.lastSuccessfulSyncAt = startedAt;
    if (lastSourceEditedAt) input.checkpoint.lastSourceEditedAt = lastSourceEditedAt;
    await input.persistCheckpoint?.(input.checkpoint);
  }
  return {
    mode: input.apply ? "applied" as const : "dry-run" as const,
    startedAt,
    since,
    lastSourceEditedAt,
    catalogChanged: plan.catalogChanged,
    ...plan.summary
  };
}

export function emptyPeopleNotionSyncCheckpoint(): PeopleNotionSyncCheckpoint {
  return { schemaVersion: 1 };
}

function profileFromNotion(current: PersonProfile, row: NotionPeopleSnapshot, biographyEligibleForVerified: boolean, englishBiographyEligibleForVerified: boolean): PersonProfile {
  const status: PersonNameStatus = row.nameStatus ?? "provisional";
  const names = current.names.filter((name) => name.source !== "notion");
  const notionNames: PersonNameEntry[] = [];
  addName(notionNames, row.chineseName, { language: "zh-CN", kind: "display" }, status, row);
  addName(notionNames, row.englishName, { language: "en", kind: "alternate" }, status, row);
  addName(notionNames, row.originalName, { kind: "original" }, status, row);
  addName(notionNames, row.name, { kind: "display" }, status, row);
  for (const alias of row.aliases) addName(notionNames, alias, { kind: "alternate" }, status, row);
  const biographyTexts = (current.biography?.texts ?? []).filter((entry) => entry.source !== "notion");
  addBiographyText(biographyTexts, row.biographyZh, "zh-CN", row, row.biographyZhStatus === "verified" && biographyEligibleForVerified, {
    method: row.biographyZhMethod,
    supportingSourceRefs: splitBiographySourceRefs(row.sources)
  });
  addBiographyText(biographyTexts, row.biographyEn, "en", row, row.biographyEnStatus === "verified" && englishBiographyEligibleForVerified, {
    method: row.biographyEnMethod,
    supportingSourceRefs: splitBiographySourceRefs(row.sources)
  });
  const biography = biographyTexts.length || row.birthDate || row.deathDate || row.birthPlace ? {
    ...(row.birthDate ? { birthDate: row.birthDate } : {}),
    ...(row.deathDate ? { deathDate: row.deathDate } : {}),
    ...(row.birthPlace ? { birthPlace: row.birthPlace } : {}),
    ...(biographyTexts.length ? { texts: biographyTexts } : {}),
    source: "notion" as const
  } : undefined;
  const existingImages = (current.profileImages ?? []).filter((image) => image.source !== "notion");
  const notionImage = row.profileUrl ? [{ url: row.profileUrl, source: "notion" as const, observedAt: row.lastEditedTime }] : [];
  return {
    ...current,
    names: uniqueNames([...notionNames, ...names]),
    departments: [...new Set<MovieCreditDepartment>(row.primaryDepartments)].sort(),
    biography,
    profileImages: [...notionImage, ...existingImages],
    sourceRefs: [
      { source: "notion", id: row.pageId, observedAt: row.lastEditedTime },
      ...(current.sourceRefs ?? []).filter((ref) => ref.source !== "notion")
    ],
    lockedFields: [...new Set(row.lockedFields)].sort(),
    hiddenFromWebsite: row.archived || Boolean(row.hideFromWebsite),
    dataQuality: {
      status: row.dataStatus ?? current.dataQuality.status,
      issues: current.dataQuality.issues,
      updatedAt: row.lastEditedTime
    },
    updatedAt: row.lastEditedTime
  };
}

function addBiographyText(
  target: PersonBiographyText[],
  value: string | undefined,
  language: string,
  row: NotionPeopleSnapshot,
  eligibleForVerified = true,
  provenance: Partial<Pick<PersonBiographyText, "method" | "supportingSourceRefs">> = {}
) {
  const clean = value?.trim();
  if (!clean) return;
  for (let index = target.length - 1; index >= 0; index -= 1) {
    const entry = target[index];
    if (entry.language.toLowerCase() === language.toLowerCase() && entry.value.trim() === clean) target.splice(index, 1);
  }
  target.unshift({
    value: clean,
    language,
    source: "notion",
    status: eligibleForVerified ? "verified" : "provisional",
    ...provenance,
    sourceRef: row.pageId,
    observedAt: row.lastEditedTime
  });
}

function addName(
  target: PersonNameEntry[],
  value: string | undefined,
  options: Pick<PersonNameEntry, "kind"> & Partial<Pick<PersonNameEntry, "language">>,
  status: PersonNameStatus,
  row: NotionPeopleSnapshot
) {
  const clean = value?.trim();
  if (!clean || target.some((entry) => normalizePersonNameSearchKey(entry.value) === normalizePersonNameSearchKey(clean))) return;
  target.push({
    value: clean,
    ...options,
    source: "notion",
    status,
    sourceRef: row.pageId,
    observedAt: row.lastEditedTime
  });
}

function uniqueNames(values: PersonNameEntry[]) {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind, entry.source, entry.status].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function externalIdConflict(profile: PersonProfile, row: NotionPeopleSnapshot) {
  const existing = normalizePersonExternalIds(profile.externalIds);
  const incoming = normalizePersonExternalIds(row.externalIds);
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    if ((existing[source] ?? "") !== (incoming[source] ?? "")) {
      return { source, incoming: incoming[source] };
    }
  }
  return undefined;
}

function withOverlap(value: string | undefined, overlapMinutes: number) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp - Math.max(0, overlapMinutes) * 60_000).toISOString() : undefined;
}

function catalogComparable(state: PersonCatalogState) {
  const value = structuredClone(state);
  value.generatedAt = "";
  delete value.source;
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
