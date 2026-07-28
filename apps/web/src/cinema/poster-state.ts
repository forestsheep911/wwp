export type PosterImageEvent = "load" | "error";

const notionTemporaryPosterPattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const localPosterPattern = /^\/api\/posters\/[a-f0-9]{32}$/i;

export function posterUrlPriority(url: string) {
  if (localPosterPattern.test(url)) {
    return 0;
  }

  if (/^https:\/\/[^/?#]+\.blob\.core\.windows\.net\//i.test(url)) {
    return 1;
  }

  if (!/^https:\/\//i.test(url)) {
    return 99;
  }

  return notionTemporaryPosterPattern.test(url) ? 3 : 2;
}

export function posterIndexAfterImageEvent(
  currentIndex: number | undefined,
  candidateCount: number,
  event: PosterImageEvent
) {
  if (currentIndex === undefined || event === "load") {
    return currentIndex;
  }

  return currentIndex + 1 < candidateCount ? currentIndex + 1 : undefined;
}
