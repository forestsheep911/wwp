import type { MoviePoster, SearchResult } from "@wwpdw/shared";

export function moviePosterCandidates(result: SearchResult): MoviePoster[] {
  // An explicit empty list is a source deletion, not a request for a fallback.
  return result.metadata?.posters ?? result.metadata?.work?.media?.posters ?? [];
}

export function withMoviePosters(result: SearchResult, posters: MoviePoster[]): SearchResult {
  if (!result.metadata) return result;
  return {
    ...result,
    metadata: {
      ...result.metadata,
      posterUrl: posters[0]?.url,
      posters,
      ...(result.metadata.work ? {
        work: { ...result.metadata.work, media: { ...result.metadata.work.media, posters } }
      } : {})
    }
  };
}

export function isCachedPoster(poster: MoviePoster) {
  return Boolean(poster.blobName) || /^\/api\/posters\/[^?#]+$/.test(poster.url);
}

export async function postersForSync(result: SearchResult, refreshPosters?: () => Promise<MoviePoster[] | undefined>) {
  const posters = moviePosterCandidates(result);
  // Legacy entries may mix files, Poster URL and cover. Re-read Notion before
  // caching those entries; never turn an unverified fallback into a new Blob.
  if ((result.metadata?.posters === undefined || posters.some(poster => !poster.origin)) && refreshPosters) {
    const refreshed = await refreshPosters();
    if (refreshed === undefined) throw new Error("Notion poster field could not be read.");
    return refreshed.filter(poster => poster.origin === "notion-files");
  }
  return posters.filter(poster => poster.origin === "notion-files" || isCachedPoster(poster));
}

const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const doubanImagePattern = /^https:\/\/img\d*\.doubanio\.com\//i;
const defaultPosterRequestTimeoutMs = 30_000;

export interface PosterRefreshOptions {
  poster: MoviePoster;
  index: number;
  posters: MoviePoster[];
  refreshPosters?: () => Promise<MoviePoster[] | undefined>;
}

export interface PosterDownloadCandidate {
  poster: MoviePoster;
  url: string;
}

export function posterRequestTimeoutMs(value = process.env.POSTER_CACHE_REQUEST_TIMEOUT_MS) {
  if (value == null || value.trim() === "") return defaultPosterRequestTimeoutMs;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 120_000) {
    return defaultPosterRequestTimeoutMs;
  }
  return Math.floor(parsed);
}

function sourceUrlForPoster(poster: MoviePoster) {
  return poster.originalUrl ?? poster.url;
}

function isNotionHostedFile(url?: string) {
  return Boolean(url && notionHostedFilePattern.test(url));
}

export function posterRequestHeaders(url: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (compatible; wwpdw-poster-cache/0.1)",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    ...(doubanImagePattern.test(url) ? { Referer: "https://movie.douban.com/" } : {})
  };
}

function addCandidate(candidates: PosterDownloadCandidate[], poster: MoviePoster | undefined) {
  if (!poster) {
    return;
  }

  if (poster.origin !== "notion-files") return;

  const url = poster ? sourceUrlForPoster(poster) : undefined;
  if (!url || candidates.some((candidate) => candidate.url === url)) {
    return;
  }

  candidates.push({ poster, url });
}

export async function posterDownloadCandidates({
  poster,
  index,
  refreshPosters
}: PosterRefreshOptions): Promise<PosterDownloadCandidate[]> {
  const candidates: PosterDownloadCandidate[] = [];
  addCandidate(candidates, poster);

  if (!refreshPosters || !isNotionHostedFile(sourceUrlForPoster(poster))) {
    return candidates;
  }

  const refreshedPosters = await refreshPosters();
  const refreshedPoster = refreshedPosters?.[index];
  if (refreshedPoster && isNotionHostedFile(sourceUrlForPoster(refreshedPoster))) {
    addCandidate(candidates, refreshedPoster);
  }

  return candidates;
}
