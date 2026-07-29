import type { CacheAsset, PlaybackLine } from "@wwpdw/shared";

export function mergePreparedLineAssets(
  domesticAsset?: CacheAsset,
  internationalAsset?: CacheAsset
): CacheAsset | undefined {
  const preparedLines: PlaybackLine[] = [];
  if (domesticAsset?.status === "ready") preparedLines.push("domestic");
  if (internationalAsset?.status === "ready") preparedLines.push("international");

  const preferred =
    (internationalAsset?.status === "ready" ? internationalAsset : undefined)
    ?? (domesticAsset?.status === "ready" ? domesticAsset : undefined)
    ?? internationalAsset
    ?? domesticAsset;
  if (!preferred) {
    return undefined;
  }

  return {
    ...preferred,
    line: preferred.line ?? (preferred === domesticAsset ? "domestic" : "international"),
    preparedLines
  };
}
