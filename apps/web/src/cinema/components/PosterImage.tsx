import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@wwpdw/shared";
import { posterIndexAfterImageEvent } from "../poster-state";
const notionTemporaryPosterPattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;

function isBlobPosterUrl(url: string) {
  return /^https:\/\/[^/?#]+\.blob\.core\.windows\.net\//i.test(url);
}

function isHttpsPosterUrl(url: string) {
  return /^https:\/\//i.test(url);
}

function isNotionTemporaryPosterUrl(url: string) {
  return notionTemporaryPosterPattern.test(url);
}

function posterPriority(url: string) {
  if (isBlobPosterUrl(url)) {
    return 0;
  }

  if (!isHttpsPosterUrl(url)) {
    return 99;
  }

  return isNotionTemporaryPosterUrl(url) ? 2 : 1;
}

function posterUrls(result: SearchResult) {
  const candidates = [
    ...(result.metadata?.posters?.map((poster) => poster.url) ?? []),
    ...(result.metadata?.work?.media?.posters?.map((poster) => poster.url) ?? []),
    ...(result.metadata?.posterUrl
      ? [result.metadata.posterUrl]
      : [])
  ]
    .filter((url): url is string => Boolean(url))
    .map((url) => ({
      url,
      priority: posterPriority(url)
    }))
    .filter((item) => item.priority < 99);

  const uniqueCandidates = new Map<string, number>();
  for (const candidate of candidates) {
    const existingPriority = uniqueCandidates.get(candidate.url);
    if (existingPriority === undefined || candidate.priority < existingPriority) {
      uniqueCandidates.set(candidate.url, candidate.priority);
    }
  }

  return [...uniqueCandidates.entries()]
    .sort(([, leftPriority], [, rightPriority]) => leftPriority - rightPriority)
    .map(([url]) => url);
}

export function PosterImage({
  alt,
  className,
  result
}: {
  alt: string;
  className: string;
  result: SearchResult;
}) {
  const urls = useMemo(() => posterUrls(result), [result]);
  const [posterIndex, setPosterIndex] = useState<number | undefined>(0);
  const src = posterIndex === undefined ? undefined : urls[posterIndex];

  useEffect(() => {
    setPosterIndex(0);
  }, [result.assetKey, urls]);

  if (!src) {
    return null;
  }

  return (
    <img
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={src}
      onLoad={() => {
        setPosterIndex((current) => posterIndexAfterImageEvent(current, urls.length, "load"));
      }}
      onError={() => {
        setPosterIndex((current) => posterIndexAfterImageEvent(current, urls.length, "error"));
      }}
    />
  );
}
