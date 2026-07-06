import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@wwpdw/shared";

function posterUrls(result: SearchResult) {
  return [...new Set([
    result.metadata?.posterUrl,
    ...(result.metadata?.posters?.map((poster) => poster.url) ?? [])
  ].filter((url): url is string => Boolean(url)))];
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
