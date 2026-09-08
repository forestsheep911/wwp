import type { MoviePoster, SearchResult } from "@wwpdw/shared";
import { withMoviePosters } from "@wwpdw/cache-store";

const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;

function posterStableKey(poster: MoviePoster) {
  const value = poster.originalUrl ?? poster.url ?? poster.blobName;
  if (!value || !notionHostedFilePattern.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function isCachedBlobPoster(poster: MoviePoster) {
  return poster.source === "blob" && Boolean(poster.blobName);
}

export function mergeCachedPosters(existing: SearchResult, refreshed: SearchResult) {
  const existingPosters = existing.metadata?.posters ?? [];
  const cachedPostersByKey = new Map(
    existingPosters
      .filter(isCachedBlobPoster)
      .map((poster) => [posterStableKey(poster), poster] as const)
      .filter(([key]) => Boolean(key))
  );
  if (cachedPostersByKey.size === 0) {
    return refreshed;
  }

  const seen = new Set<string>();
  const posters: MoviePoster[] = [];
  for (const poster of refreshed.metadata?.posters ?? []) {
    const key = posterStableKey(poster);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const cached = cachedPostersByKey.get(key);
    posters.push(cached ? { ...cached, origin: poster.origin } : poster);
  }

  return withMoviePosters(refreshed, posters);
}
