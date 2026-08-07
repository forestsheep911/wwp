import type { SearchResult } from "@wwpdw/shared";
import type { ResultWithCache, TrackedCacheItem } from "./types";

export type BrowseFilterDecade = "all" | "2020s" | "2010s" | "2000s" | "classic";
export type BrowseFilterRating = "all" | "7" | "8" | "9";
export type BrowseFilterAvailability = "all" | "playable" | "subtitle" | "prepared";

export interface BrowseFilterState {
  decade: BrowseFilterDecade;
  rating: BrowseFilterRating;
  genre: string;
  availability: BrowseFilterAvailability;
}

export const emptyBrowseFilter: BrowseFilterState = {
  decade: "all",
  rating: "all",
  genre: "all",
  availability: "all"
};

export function browseFilterActive(filter: BrowseFilterState) {
  return Object.entries(filter).some(([key, value]) => value !== emptyBrowseFilter[key as keyof BrowseFilterState]);
}

export function browseFilterGenres(results: SearchResult[]) {
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const genre of genresForResult(result)) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, 12)
    .map(([genre]) => genre);
}

export function filterBrowseResults(
  results: ResultWithCache[],
  filter: BrowseFilterState,
  trackedByAssetKey: Map<string, TrackedCacheItem>
) {
  return results.filter((result) => {
    const year = yearForResult(result);
    const rating = ratingForResult(result);
    const genres = genresForResult(result);
    const variants = result.variants ?? [];

    if (filter.decade !== "all" && !matchesDecade(year, filter.decade)) {
      return false;
    }
    if (filter.rating !== "all" && (rating === undefined || rating < Number(filter.rating))) {
      return false;
    }
    if (filter.genre !== "all" && !genres.some((genre) => genre.toLowerCase() === filter.genre.toLowerCase())) {
      return false;
    }
    if (filter.availability === "playable" && !variants.some((variant) => variant.metadata?.availability === "playable")) {
      return false;
    }
    if (filter.availability === "subtitle" && !variants.some((variant) =>
      (variant.metadata?.subtitleLanguages ?? []).some((language) => /中文|简体|繁体|chinese|mandarin/i.test(language))
    )) {
      return false;
    }
    if (filter.availability === "prepared" && !trackedByAssetKey.has(result.assetKey)) {
      return false;
    }
    return true;
  });
}

export function yearForResult(result: SearchResult) {
  const value = result.metadata?.release?.year ??
    result.metadata?.display?.year ??
    result.metadata?.year ??
    result.metadata?.external?.omdb?.year;
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

export function ratingForResult(result: SearchResult) {
  const values = (result.metadata?.ratings ?? []).flatMap((rating) => {
    const value = Number.parseFloat(rating.value);
    return Number.isFinite(value) ? [value] : [];
  });
  return values.length > 0 ? Math.max(...values) : undefined;
}

function genresForResult(result: SearchResult) {
  return [
    ...(result.metadata?.work?.genres ?? []),
    ...(result.metadata?.genres ?? []),
    ...(result.metadata?.external?.omdb?.genres ?? [])
  ].map((genre) => genre.trim()).filter(Boolean).filter((genre, index, all) => all.indexOf(genre) === index);
}

function matchesDecade(year: number | undefined, decade: BrowseFilterDecade) {
  if (year === undefined) {
    return false;
  }
  if (decade === "classic") {
    return year < 2000;
  }
  const start = Number(decade.slice(0, 4));
  return year >= start && year < start + 10;
}
