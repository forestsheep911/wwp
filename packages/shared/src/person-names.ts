import type { MovieCreditDepartment, MovieMetadataSource } from "./index.js";

export interface PersonExternalIds {
  tmdb?: string;
  imdb?: string;
  wikidata?: string;
}

export type PersonNameKind =
  | "display"
  | "original"
  | "alternate"
  | "stage"
  | "transliteration";

export type PersonNameStatus =
  | "verified"
  | "strong"
  | "provisional"
  | "conflict"
  | "rejected";

export interface PersonNameEntry {
  value: string;
  language?: string;
  script?: string;
  region?: string;
  kind: PersonNameKind;
  source: MovieMetadataSource;
  status: PersonNameStatus;
  sourceRef?: string;
  observedAt: string;
}

export type PersonLockedField =
  | "chineseName"
  | "englishName"
  | "originalName"
  | "biographyZh"
  | "biographyEn"
  | "profileUrl";

export interface PersonBiographyText {
  value: string;
  language: string;
  source: MovieMetadataSource;
  status: PersonNameStatus;
  method?: "source-summary" | "editorial-rewrite" | "machine-translation" | "source-excerpt";
  supportingSourceRefs?: string[];
  sourceRef?: string;
  observedAt: string;
}

export interface PersonBiography {
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  texts?: PersonBiographyText[];
  /** Source for structured biographical facts; localized text has per-entry provenance. */
  source?: MovieMetadataSource;
}

export interface PersonBiographyDisplayTexts {
  chinese?: string;
  english?: string;
  fallback?: string;
}

export interface PersonImage {
  url: string;
  source: MovieMetadataSource;
  originalUrl?: string;
  observedAt?: string;
}

export interface PersonSourceRef {
  source: MovieMetadataSource;
  id?: string;
  url?: string;
  observedAt: string;
}

export interface PersonDataQuality {
  status: "draft" | "partial" | "verified" | "conflict";
  issues?: string[];
  updatedAt: string;
}

export interface PersonProfile {
  personId: string;
  names: PersonNameEntry[];
  externalIds?: PersonExternalIds;
  departments?: MovieCreditDepartment[];
  biography?: PersonBiography;
  profileImages?: PersonImage[];
  sourceRefs?: PersonSourceRef[];
  lockedFields?: PersonLockedField[];
  hiddenFromWebsite?: boolean;
  dataQuality: PersonDataQuality;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDisplayNames {
  primary?: string;
  chinese?: string;
  english?: string;
  original?: string;
  aliases: string[];
}

export interface PersonDisplayNameOverrides {
  chinese?: string;
  english?: string;
  original?: string;
}

export interface PersonCreditRef {
  personId: string;
  name: string;
  department: MovieCreditDepartment;
  job?: string;
  character?: string;
  order?: number;
  source?: MovieMetadataSource;
}

export interface PersonWorkCreditRef extends PersonCreditRef {
  workId: string;
  workTitle?: string;
}

export interface PersonCatalogEntry {
  profile: PersonProfile;
  workIds: string[];
  updatedAt: string;
}

export interface PersonCatalogIssue {
  kind:
    | "external_id_conflict"
    | "unresolved_credit"
    | "redirect_conflict"
    | "notion_identity_conflict"
    | "biography_verification_incomplete"
    | "notion_row_invalid";
  message: string;
  personIds?: string[];
  workId?: string;
  creditName?: string;
  notionPageId?: string;
  externalId?: {
    source: keyof PersonExternalIds;
    id: string;
  };
}

export interface PublicPersonSummary {
  personId: string;
  names: PersonDisplayNames;
  departments: MovieCreditDepartment[];
  profileUrl?: string;
  dataStatus: PersonDataQuality["status"];
  biographyLanguages: string[];
  workCount: number;
  representativeWorks: string[];
}

export interface PublicPersonWork {
  workId: string;
  title?: string;
  department: MovieCreditDepartment;
  job?: string;
  character?: string;
}

export interface PublicPersonDetail extends PublicPersonSummary {
  biography?: PersonBiography;
  externalIds?: PersonExternalIds;
  works: PublicPersonWork[];
}

export interface PublicPersonListResponse {
  people: PublicPersonSummary[];
  total: number;
  offset: number;
  nextOffset?: number;
  workRelationshipCount: number;
}

export interface PersonCatalogState {
  schemaVersion: 1;
  generatedAt: string;
  source?: {
    kind: "movie-catalog" | "manual" | "mixed";
    workCount?: number;
  };
  people: Record<string, PersonCatalogEntry>;
  redirects: Record<string, string>;
  externalIdIndex: {
    tmdb: Record<string, string>;
    imdb: Record<string, string>;
    wikidata: Record<string, string>;
  };
  aliasIndex: Record<string, string[]>;
  creditsByWorkId: Record<string, PersonCreditRef[]>;
  creditsByPersonId: Record<string, PersonWorkCreditRef[]>;
  issues: PersonCatalogIssue[];
}

const publicStatuses = new Set<PersonNameStatus>(["verified", "strong"]);

export function selectPersonBiographyTexts(biography?: PersonBiography): PersonBiographyDisplayTexts {
  const entries = (biography?.texts ?? [])
    .filter((entry) => entry.value.trim() && entry.status !== "rejected" && entry.status !== "conflict")
    .sort((left, right) => biographyStatusRank(right.status) - biographyStatusRank(left.status));
  const chinese = entries.find((entry) => /^zh(?:-|$)/i.test(entry.language))?.value.trim();
  const english = entries.find((entry) => /^en(?:-|$)/i.test(entry.language))?.value.trim();
  const fallback = chinese ?? english ?? entries[0]?.value.trim();
  return {
    ...(chinese ? { chinese } : {}),
    ...(english ? { english } : {}),
    ...(fallback ? { fallback } : {})
  };
}

function biographyStatusRank(status: PersonNameStatus) {
  return ({ verified: 4, strong: 3, provisional: 2, conflict: 1, rejected: 0 } as const)[status];
}

export function normalizePersonNameSearchKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

export function selectPersonDisplayNames(
  names: PersonNameEntry[],
  locked: PersonDisplayNameOverrides = {}
): PersonDisplayNames {
  const eligible = uniqueNameEntries(names.filter((entry) => entry.status !== "rejected"));
  const publicNames = eligible.filter((entry) => publicStatuses.has(entry.status));
  const chinese = cleanOverride(locked.chinese) ?? selectBest(publicNames.filter(isChineseName), chineseScore);
  const english = cleanOverride(locked.english) ?? selectBest(publicNames.filter(isEnglishName), englishScore);
  const original = cleanOverride(locked.original) ?? selectBest(publicNames.filter(isOriginalName), originalScore);
  const selectedKeys = new Set([chinese, english, original].filter(Boolean).map((value) => normalizePersonNameSearchKey(value!)));
  const aliases = eligible
    .filter((entry) => entry.status !== "conflict")
    .map((entry) => entry.value.trim())
    .filter(Boolean)
    .filter((value) => !selectedKeys.has(normalizePersonNameSearchKey(value)));

  return {
    primary: chinese ?? english ?? original,
    chinese,
    english,
    original,
    aliases: uniqueStrings(aliases)
  };
}

function isChineseName(entry: PersonNameEntry) {
  const language = entry.language?.toLowerCase();
  return language === "zh" || language?.startsWith("zh-")
    || (!language && (entry.script === "Hans" || entry.script === "Hant"));
}

function isEnglishName(entry: PersonNameEntry) {
  const language = entry.language?.toLowerCase();
  return language === "en" || language?.startsWith("en-") || entry.script === "Latn";
}

function isOriginalName(entry: PersonNameEntry) {
  return entry.kind === "original";
}

function chineseScore(entry: PersonNameEntry) {
  return statusScore(entry) + sourceScore(entry.source, ["manual", "notion", "wikidata", "tmdb"])
    + (entry.language?.toLowerCase() === "zh-cn" ? 30 : 0)
    + (entry.language?.toLowerCase() === "zh-hans" || entry.script === "Hans" ? 20 : 0);
}

function englishScore(entry: PersonNameEntry) {
  return statusScore(entry) + sourceScore(entry.source, ["manual", "notion", "imdb", "tmdb", "wikidata"])
    + (entry.kind === "display" ? 10 : 0);
}

function originalScore(entry: PersonNameEntry) {
  return statusScore(entry) + sourceScore(entry.source, ["manual", "notion", "wikidata", "tmdb"]);
}

function statusScore(entry: PersonNameEntry) {
  return entry.status === "verified" ? 1_000 : entry.status === "strong" ? 500 : 0;
}

function sourceScore(source: MovieMetadataSource, order: MovieMetadataSource[]) {
  const index = order.indexOf(source);
  return index < 0 ? 0 : (order.length - index) * 50;
}

function selectBest(entries: PersonNameEntry[], score: (entry: PersonNameEntry) => number) {
  return entries
    .slice()
    .sort((left, right) => score(right) - score(left)
      || right.observedAt.localeCompare(left.observedAt)
      || left.value.localeCompare(right.value, "und"))[0]
    ?.value.trim() || undefined;
}

function uniqueNameEntries(entries: PersonNameEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${normalizePersonNameSearchKey(entry.value)}:${entry.language ?? ""}:${entry.kind}:${entry.source}:${entry.status}`;
    if (!normalizePersonNameSearchKey(entry.value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizePersonNameSearchKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanOverride(value?: string) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}
