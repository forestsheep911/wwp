export function loadingGridCount(columns: number, cardHeight: number, rowGap: number, availableHeight: number) {
  const cols = Math.max(1, Math.floor(columns));
  if (!Number.isFinite(cardHeight) || cardHeight <= 0) return cols;
  const gap = Math.max(0, rowGap);
  const rows = Math.max(1, Math.ceil((Math.max(0, availableHeight) + gap) / (cardHeight + gap)));
  return cols * rows;
}

export function remainingLoadingCount(capacity: number, columns: number, loadedCount: number) {
  const cols = Math.max(1, Math.floor(columns));
  const completeRows = Math.ceil(loadedCount / cols) * cols;
  return Math.max(0, Math.max(capacity, completeRows) - loadedCount);
}
