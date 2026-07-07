import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@wwpdw/shared";

const posterFallbackMs = 3200;

function isBlobPosterUrl(url: string) {
  return /^https:\/\/[^/?#]+\.blob\.core\.windows\.net\//i.test(url);
}

function posterUrls(result: SearchResult) {
  const candidates = [
    ...(result.metadata?.posters?.map((poster) => ({
      url: poster.url,
      allowed: isBlobPosterUrl(poster.url)
    })) ?? []),
    ...(result.metadata?.posterUrl
      ? [{
        url: result.metadata.posterUrl,
        allowed: isBlobPosterUrl(result.metadata.posterUrl)
      }]
      : [])
  ].filter((item) => Boolean(item.url) && item.allowed);

  return [...new Map(
    candidates
      .map((item) => [item.url, item.url])
  ).values()];
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
  const [posterIndex, setPosterIndex] = useState(0);
  const src = urls[posterIndex];

  useEffect(() => {
    setPosterIndex(0);
  }, [result.assetKey, urls]);

  useEffect(() => {
    if (!src || posterIndex >= urls.length - 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPosterIndex((current) => (current === posterIndex ? current + 1 : current));
    }, posterFallbackMs);

    return () => window.clearTimeout(timer);
  }, [posterIndex, src, urls.length]);

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
      onError={() => {
        setPosterIndex((current) => current + 1);
      }}
    />
  );
}
