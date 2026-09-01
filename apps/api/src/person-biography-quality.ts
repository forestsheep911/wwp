export type ChineseBiographyMethod =
  | "source-summary"
  | "editorial-rewrite"
  | "machine-translation"
  | "source-excerpt";

export interface ChineseBiographyReview {
  eligibleForVerified: boolean;
  independentSources: string[];
  issues: string[];
}

export function splitBiographySourceRefs(value?: string) {
  return (value ?? "")
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function reviewChineseBiography(input: {
  text?: string;
  method?: ChineseBiographyMethod;
  sourceRefs?: string[];
}): ChineseBiographyReview {
  return reviewBiography(input, "Biography ZH");
}

export function reviewEnglishBiography(input: {
  text?: string;
  method?: ChineseBiographyMethod;
  sourceRefs?: string[];
}): ChineseBiographyReview {
  return reviewBiography(input, "Biography EN");
}

function reviewBiography(input: {
  text?: string;
  method?: ChineseBiographyMethod;
  sourceRefs?: string[];
}, field: "Biography ZH" | "Biography EN"): ChineseBiographyReview {
  const text = input.text?.trim();
  if (!text) return { eligibleForVerified: true, independentSources: [], issues: [] };
  const independentSources = [...new Set((input.sourceRefs ?? []).map(sourceFamily).filter(Boolean) as string[])];
  const issues: string[] = [];
  if (input.method !== "editorial-rewrite") issues.push(`${field} must be marked editorial-rewrite before verification.`);
  if (independentSources.length < 2) issues.push(`${field} requires at least two independent source families before verification.`);
  if (text && !biographyHasSubstantiveLength(text, field)) {
    issues.push(`${field} is too short to establish a person-centred career summary.`);
  }
  if (text && biographyLooksLikeWorkflowCopy(text, field)) {
    issues.push(`${field} must read as a person-centred biography, not a WWP credit or verification report.`);
  }
  return { eligibleForVerified: issues.length === 0, independentSources, issues };
}

export function reviewPersonCoreProfile(profile: PersonProfile) {
  const issues: string[] = [];
  if (!Object.values(profile.externalIds ?? {}).some((value) => value?.trim())) {
    issues.push("missing_stable_external_id");
  }
  if (!hasVerifiedName(profile, /^zh(?:-|$)/i)) issues.push("missing_verified_chinese_name");
  if (!hasVerifiedName(profile, /^en(?:-|$)/i)) issues.push("missing_verified_english_name");
  if (!(profile.departments?.length)) issues.push("missing_verified_department");
  if (!hasVerifiedBiography(profile, /^zh(?:-|$)/i)) issues.push("missing_verified_chinese_biography");
  if (!hasVerifiedBiography(profile, /^en(?:-|$)/i)) issues.push("missing_verified_english_biography");
  return { eligibleForVerified: issues.length === 0, issues };
}

export function assertVerifiedPersonProfileQuality(profile: PersonProfile) {
  if (profile.dataQuality.status !== "verified") return;
  const review = reviewPersonCoreProfile(profile);
  if (!review.eligibleForVerified) {
    throw new Error(`${profile.personId} claims verified data but fails the core biography gate: ${review.issues.join(", ")}`);
  }
}

function hasVerifiedName(profile: PersonProfile, language: RegExp) {
  return profile.names.some((name) => language.test(name.language ?? "") && name.status === "verified" && Boolean(name.value.trim()));
}

function hasVerifiedBiography(profile: PersonProfile, language: RegExp) {
  return (profile.biography?.texts ?? []).some((entry) => {
    if (!language.test(entry.language) || entry.status !== "verified") return false;
    return reviewBiography({
      text: entry.value,
      method: entry.method,
      sourceRefs: entry.supportingSourceRefs
    }, language.source.startsWith("^zh") ? "Biography ZH" : "Biography EN").eligibleForVerified;
  });
}

export function biographyLooksLikeWorkflowCopy(text: string, field: "Biography ZH" | "Biography EN") {
  const patterns = field === "Biography ZH" ? [
    /公开人物资料来自\s*Wikidata/iu,
    /在《[^》]+》中担任(?:Actor|Voice Actor|Director|Screenwriter|Producer|Editor|Director of Photography|Original Music Composer)/iu,
    /相关作品关系由.*(?:身份记录|资料).*核对/u,
    /本小传依据.*(?:资料|身份).*综合改写/u,
    /以.*身份参与创作或演出/u,
    /与[^。；]+有关的?荣誉或提名/u
  ] : [
    /documented in Wikidata/iu,
    /\bis credited as\b/iu,
    /\bis (?:a|an) (?:actor|editor|director|screenwriter|producer) documented in\b/iu,
    /\bis a (?:actor|editor)\b/iu,
    /linking (?:their|his|her) profile to the film through a documented/iu,
    /this summary was independently rewritten from the cited/iu,
    /recognition connected with/iu,
    /contributed as .+ a principal cast member/iu
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function biographyHasSubstantiveLength(text: string, field: "Biography ZH" | "Biography EN") {
  if (field === "Biography ZH") return [...text.replace(/\s+/gu, "")].length >= 100;
  return text.split(/\s+/u).filter(Boolean).length >= 45;
}

function sourceFamily(value: string) {
  const normalized = value.trim().toLocaleLowerCase("und");
  if (!normalized) return undefined;
  const named = normalized.match(/^([a-z][a-z0-9_-]*):/i)?.[1];
  if (named && !["http", "https", "notion", "manual", "editorial"].includes(named)) return named;
  try {
    const hostname = new URL(normalized).hostname.replace(/^www\./, "");
    if (!hostname) return undefined;
    if (hostname === "douban.com" || hostname.endsWith(".douban.com")) return "douban";
    if (hostname === "wikidata.org" || hostname.endsWith(".wikidata.org")) return "wikidata";
    if (hostname === "themoviedb.org" || hostname.endsWith(".themoviedb.org")) return "tmdb";
    if (hostname === "imdb.com" || hostname.endsWith(".imdb.com")) return "imdb";
    const parts = hostname.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    return undefined;
  }
}
import type { PersonProfile } from "@wwpdw/shared";
