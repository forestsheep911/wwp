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
  douban: 35,
  imdb: 30,
  metacritic: 25,
  rotten: 10
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
