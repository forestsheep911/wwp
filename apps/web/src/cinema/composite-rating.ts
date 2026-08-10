import type { SearchResult } from "@wwpdw/shared";

export type CompositeRatingSource = "douban" | "imdb" | "rotten" | "metacritic";

export interface CompositeRatingValue {
  source: CompositeRatingSource;
  value: string;
}

export interface CompositeRating {
  score: number;
  sourceCount: number;
}

const sourceWeights: Record<CompositeRatingSource, number> = {
  douban: 13,
  imdb: 27,
  metacritic: 35,
  rotten: 25
};

function normalizeRating({ source, value }: CompositeRatingValue) {
  const numericValue = Number.parseFloat(value.match(/\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  const normalizedValue = source === "douban" || source === "imdb"
    ? numericValue <= 10
      ? numericValue * 10
      : numericValue
    : numericValue;

  return Math.min(100, Math.max(0, normalizedValue));
}

export function calculateCompositeRating(values: CompositeRatingValue[]): CompositeRating | undefined {
  let weightedScore = 0;
  let availableWeight = 0;
  let sourceCount = 0;

  for (const value of values) {
    const normalizedValue = normalizeRating(value);
    if (normalizedValue === undefined) {
      continue;
    }

    const weight = sourceWeights[value.source];
    weightedScore += normalizedValue * weight;
    availableWeight += weight;
    sourceCount += 1;
  }

  if (availableWeight === 0) {
    return undefined;
  }

  return {
    score: Math.round(weightedScore / availableWeight),
    sourceCount
  };
}

export function calculateCompositeRatingForResult(result: SearchResult) {
  const metadata = result.metadata;
  const ratings = [
    ...(metadata?.ratings ?? []),
    ...(metadata?.external?.omdb?.ratings ?? [])
  ];

  if (metadata?.external?.omdb?.imdbRating && metadata.external.omdb.imdbRating !== "N/A") {
    ratings.push({ label: "IMDb", value: metadata.external.omdb.imdbRating });
  }
  if (metadata?.external?.omdb?.metascore && metadata.external.omdb.metascore !== "N/A") {
    ratings.push({ label: "Metacritic", value: metadata.external.omdb.metascore });
  }

  const sourceMatchers: Array<[CompositeRatingSource, RegExp]> = [
    ["douban", /douban|豆瓣/i],
    ["imdb", /imdb/i],
    ["rotten", /^rt$|rotten|tomato|tomatometer|烂番茄|爛番茄/i],
    ["metacritic", /^meta$|metacritic|meta\s*critic|metascore|metamatrix|metamatrices/i]
  ];

  return calculateCompositeRating(sourceMatchers.flatMap(([source, matcher]) => {
    const rating = ratings.find((item) => item.label && item.value && item.value !== "N/A" && matcher.test(item.label));
    return rating ? [{ source, value: rating.value }] : [];
  }));
}
