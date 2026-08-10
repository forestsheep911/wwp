import type { SearchResult } from "@wwpdw/shared";
import { resultMatchesBrowseChannel } from "./browse-channel";
import { calculateCompositeRatingForResult } from "./composite-rating";
import type { ResultWithCache } from "./types";

export type BrowseFilterKind = "all" | "movie" | "tv" | "animation";
export type BrowseFilterDecade = "all" | "2020s" | "2010s" | "2000s" | "classic";
export type BrowseFilterRating = "all" | "70" | "80" | "90";
export type BrowseFilterAvailability = "all" | "publicPrepared";

export interface BrowseFilterState {
  kind: BrowseFilterKind;
  decade: BrowseFilterDecade;
  rating: BrowseFilterRating;
  genres: string[];
  availability: BrowseFilterAvailability;
}

export const emptyBrowseFilter: BrowseFilterState = {
  kind: "all",
  decade: "all",
  rating: "all",
  genres: [],
  availability: "all"
};

export function browseFilterActive(filter: BrowseFilterState) {
  return filter.kind !== "all"
    || filter.decade !== "all"
    || filter.rating !== "all"
    || filter.genres.length > 0
    || filter.availability !== "all";
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
    .map(([genre]) => genre);
}

export function filterBrowseResults(
  results: ResultWithCache[],
  filter: BrowseFilterState
) {
  return results.filter((result) => {
    const year = yearForResult(result);
    const rating = calculateCompositeRatingForResult(result)?.score;
    const genres = genresForResult(result);
    const variants = result.variants ?? [];

    if (filter.kind !== "all" && !resultMatchesBrowseChannel(result, filter.kind)) {
      return false;
    }
    if (filter.decade !== "all" && !matchesDecade(year, filter.decade)) {
      return false;
    }
    if (filter.rating !== "all" && (rating === undefined || rating < Number(filter.rating))) {
      return false;
    }
    if (filter.genres.length > 0 && !filter.genres.some((selectedGenre) =>
      genres.some((genre) => genre.toLowerCase() === selectedGenre.toLowerCase())
    )) {
      return false;
    }
    if (filter.availability === "publicPrepared" && result.cache?.status !== "ready" && !variants.some((variant) => variant.cache?.status === "ready")) {
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
