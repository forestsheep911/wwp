export type PosterImageEvent = "load" | "error";

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
