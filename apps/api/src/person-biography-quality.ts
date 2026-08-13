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
  return { eligibleForVerified: issues.length === 0, independentSources, issues };
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
