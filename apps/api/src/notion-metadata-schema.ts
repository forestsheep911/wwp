import { createHash } from "node:crypto";

export interface MovieIdentityHints {
  imdb?: string;
  douban?: string;
  tmdb?: string;
}

export interface NotionMetadataHints {
  externalIds: MovieIdentityHints;
  sourceTexts: string[];
}

export type NotionManagedPropertyType =
  | "rich_text"
  | "url"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multi_select";

export interface NotionManagedProperty {
  name: string;
  type: NotionManagedPropertyType;
  group: "identity" | "display" | "quality";
  options?: Array<{ name: string; color?: string }>;
}

const imdbIdPattern = /\btt\d{6,10}\b/gi;
const imdbUrlPattern = /imdb\.com\/title\/(tt\d{6,10})/gi;
const doubanUrlPattern = /douban\.com\/subject\/(\d{4,12})/gi;
const doubanTextPattern = /(?:douban|\u8c46\u74e3)[^\d]{0,24}(\d{4,12})/gi;
const tmdbUrlPattern = /themoviedb\.org\/movie\/(\d{1,12})/gi;
const tmdbTextPattern = /\btmdb[^\d]{0,16}(\d{1,12})/gi;

export const notionManagedProperties = [
  { name: "WW Work ID", type: "rich_text", group: "identity" },
  { name: "IMDb ID", type: "rich_text", group: "identity" },
  { name: "IMDb URL", type: "url", group: "identity" },
  { name: "Douban Subject ID", type: "rich_text", group: "identity" },
  { name: "Douban URL", type: "url", group: "identity" },
  { name: "TMDB ID", type: "rich_text", group: "identity" },
  { name: "TMDB URL", type: "url", group: "identity" },

  { name: "Chinese Title", type: "rich_text", group: "display" },
  { name: "Original Title", type: "rich_text", group: "display" },
  { name: "English Title", type: "rich_text", group: "display" },
  { name: "Release Year", type: "number", group: "display" },
  { name: "Release Date", type: "date", group: "display" },
  { name: "Countries", type: "multi_select", group: "display" },
  { name: "Languages", type: "multi_select", group: "display" },
  { name: "Genres", type: "multi_select", group: "display" },
  { name: "Runtime Minutes", type: "number", group: "display" },
  { name: "Directors", type: "rich_text", group: "display" },
  { name: "Writers", type: "rich_text", group: "display" },
  { name: "Cast", type: "rich_text", group: "display" },
  { name: "Poster URL", type: "url", group: "display" },
  { name: "Box Office", type: "rich_text", group: "display" },
  { name: "Box Office Amount", type: "number", group: "display" },
  { name: "Box Office Currency", type: "rich_text", group: "display" },
  { name: "Box Office Source", type: "rich_text", group: "display" },

  {
    name: "Match Status",
    type: "select",
    group: "quality",
    options: [
      { name: "unmatched", color: "gray" },
      { name: "candidate", color: "yellow" },
      { name: "verified", color: "green" },
      { name: "conflict", color: "red" },
      { name: "manual", color: "blue" }
    ]
  },
  {
    name: "Metadata Status",
    type: "select",
    group: "quality",
    options: [
      { name: "draft", color: "gray" },
      { name: "partial", color: "yellow" },
      { name: "verified", color: "green" },
      { name: "conflict", color: "red" }
    ]
  },
  { name: "Metadata Source", type: "multi_select", group: "quality" },
  { name: "Metadata Confidence", type: "number", group: "quality" },
  { name: "Needs Review", type: "checkbox", group: "quality" },
  { name: "Metadata Updated At", type: "date", group: "quality" }
] satisfies NotionManagedProperty[];

export function createMetadataHints(): NotionMetadataHints {
  return {
    externalIds: {},
    sourceTexts: []
  };
}

export function collectMetadataHintsFromText(hints: NotionMetadataHints, text: string | undefined) {
  const normalized = text?.trim();
  if (!normalized) {
    return;
  }

  let changed = false;
  for (const match of normalized.matchAll(imdbUrlPattern)) {
    changed = setHint(hints.externalIds, "imdb", normalizeImdbId(match[1])) || changed;
  }
  for (const match of normalized.matchAll(imdbIdPattern)) {
    changed = setHint(hints.externalIds, "imdb", normalizeImdbId(match[0])) || changed;
  }
  for (const match of normalized.matchAll(doubanUrlPattern)) {
    changed = setHint(hints.externalIds, "douban", normalizeNumericId(match[1])) || changed;
  }
  for (const match of normalized.matchAll(doubanTextPattern)) {
    changed = setHint(hints.externalIds, "douban", normalizeNumericId(match[1])) || changed;
  }
  for (const match of normalized.matchAll(tmdbUrlPattern)) {
    changed = setHint(hints.externalIds, "tmdb", normalizeNumericId(match[1])) || changed;
  }
  for (const match of normalized.matchAll(tmdbTextPattern)) {
    changed = setHint(hints.externalIds, "tmdb", normalizeNumericId(match[1])) || changed;
  }

  if (changed) {
    hints.sourceTexts.push(normalized.slice(0, 500));
  }
}

export function mergeMetadataHints(...sources: Array<NotionMetadataHints | undefined>) {
  const hints = createMetadataHints();
  for (const source of sources) {
    if (!source) {
      continue;
    }
    setHint(hints.externalIds, "imdb", source.externalIds.imdb);
    setHint(hints.externalIds, "douban", source.externalIds.douban);
    setHint(hints.externalIds, "tmdb", source.externalIds.tmdb);
    hints.sourceTexts.push(...source.sourceTexts);
  }
  return hints;
}

export function normalizeImdbId(value: string | undefined) {
  const match = value?.match(/\b(tt\d{6,10})\b/i);
  return match ? match[1].toLowerCase() : undefined;
}

export function normalizeDoubanSubjectId(value: string | undefined) {
  return normalizeNumericId(value);
}

export function normalizeTmdbId(value: string | undefined) {
  return normalizeNumericId(value);
}

export function imdbTitleUrl(imdbId: string | undefined) {
  return imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined;
}

export function doubanSubjectUrl(subjectId: string | undefined) {
  return subjectId ? `https://movie.douban.com/subject/${subjectId}/` : undefined;
}

export function tmdbMovieUrl(tmdbId: string | undefined) {
  return tmdbId ? `https://www.themoviedb.org/movie/${tmdbId}` : undefined;
}

export function stableMovieWorkIdFromNotion(pageId: string | undefined, title: string, year?: string) {
  const seed = pageId
    ? `notion:${pageId}`
    : `title:${title.trim().toLowerCase()}|year:${year ?? ""}`;
  const digest = createHash("sha256").update(seed).digest("base64url").slice(0, 16);
  return `wwm_${digest}`;
}

export function propertySchemaPayload(property: NotionManagedProperty) {
  if (property.type === "select") {
    return {
      select: {
        options: property.options ?? []
      }
    };
  }

  if (property.type === "multi_select") {
    return {
      multi_select: {
        options: property.options ?? []
      }
    };
  }

  if (property.type === "number") {
    return {
      number: {
        format: "number"
      }
    };
  }

  return {
    [property.type]: {}
  };
}

function normalizeNumericId(value: string | undefined) {
  const match = value?.match(/\b(\d{1,12})\b/);
  return match ? match[1] : undefined;
}

function setHint(target: MovieIdentityHints, source: keyof MovieIdentityHints, value: string | undefined) {
  if (!value || target[source]) {
    return false;
  }
  target[source] = value;
  return true;
}
