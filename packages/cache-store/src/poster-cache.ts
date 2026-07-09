import type { MoviePoster } from "@wwpdw/shared";

const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const doubanImagePattern = /^https:\/\/img\d*\.doubanio\.com\//i;

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
