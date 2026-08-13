import type { PersonEvidence } from "./types.js";
import { normalizeImdbPersonId } from "@wwpdw/shared";

export interface ImdbNameBasicsRow {
  imdbId: string;
  primaryName: string;
  birthYear?: string;
  deathYear?: string;
  primaryProfessions: string[];
  knownForTitleIds: string[];
}

export function parseImdbNameBasicsRow(line: string): ImdbNameBasicsRow | undefined {
  const [rawId, primaryName, birthYear, deathYear, professions, knownFor] = line.replace(/\r$/, "").split("\t");
  const imdbId = normalizeImdbPersonId(rawId);
  if (!imdbId || !primaryName || primaryName === "primaryName") return undefined;
  return {
    imdbId,
    primaryName,
    birthYear: missingToUndefined(birthYear),
    deathYear: missingToUndefined(deathYear),
    primaryProfessions: csv(professions),
    knownForTitleIds: csv(knownFor)
  };
}

export async function findImdbNames(lines: AsyncIterable<string>, targetIds: Iterable<string>) {
  const remaining = new Set([...targetIds].map(normalizeImdbPersonId).filter((value): value is string => Boolean(value)));
  const found = new Map<string, ImdbNameBasicsRow>();
  for await (const line of lines) {
    const candidateId = line.slice(0, line.indexOf("\t"));
    if (!remaining.has(candidateId)) continue;
    const row = parseImdbNameBasicsRow(line);
    if (!row) continue;
    found.set(row.imdbId, row);
    remaining.delete(row.imdbId);
    if (remaining.size === 0) break;
  }
  return { found, missing: [...remaining].sort() };
}

export function imdbNameEvidence(row: ImdbNameBasicsRow, observedAt = new Date().toISOString()): PersonEvidence {
  return {
    externalIds: { imdb: row.imdbId },
    names: [{
      value: row.primaryName,
      language: "en",
      script: "Latn",
      kind: "display",
      source: "imdb",
      status: "strong",
      sourceRef: `https://www.imdb.com/name/${row.imdbId}/`,
      observedAt
    }],
    biography: row.birthYear || row.deathYear ? {
      birthDate: row.birthYear,
      deathDate: row.deathYear,
      source: "imdb"
    } : undefined,
    sourceRefs: [{
      source: "imdb",
      id: row.imdbId,
      url: `https://www.imdb.com/name/${row.imdbId}/`,
      observedAt
    }],
    observedAt
  };
}

function missingToUndefined(value?: string) {
  return value && value !== "\\N" ? value : undefined;
}

function csv(value?: string) {
  return value && value !== "\\N" ? value.split(",").filter(Boolean) : [];
}
