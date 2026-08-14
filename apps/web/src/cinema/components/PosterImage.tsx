import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@wwpdw/shared";
import { posterIndexAfterImageEvent, posterUrlPriority } from "../poster-state";

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
      priority: posterUrlPriority(url)
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
  result,
  priority = false
}: {
  alt: string;
  className: string;
  result: SearchResult;
  priority?: boolean;
}) {
  const urlKey = posterUrls(result).join("\n");
  const urls = useMemo(() => urlKey ? urlKey.split("\n") : [], [urlKey]);
  const [posterIndex, setPosterIndex] = useState<number | undefined>(0);
  const src = posterIndex === undefined ? undefined : urls[posterIndex];

  useEffect(() => {
    setPosterIndex(0);
  }, [result.assetKey, urlKey]);

  if (!src) {
    return null;
  }

  return (
    <img
      alt={alt}
      className={className}
      fetchPriority={priority ? "high" : "auto"}
      loading={priority ? "eager" : "lazy"}
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
