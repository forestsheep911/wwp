export type PosterImageEvent = "load" | "error";

const localPosterPattern = /^\/api\/posters\/[^?#]+$/i;

export function posterUrlPriority(url: string) {
  if (localPosterPattern.test(url)) {
    return 0;
  }

  if (/^https:\/\/[^/?#]+\.blob\.core\.windows\.net\//i.test(url)) {
    return 1;
  }

  // Notion links, Poster URL, Douban and other external fallbacks are not
  // website posters. Only our own storage may be rendered.
  return 99;
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
