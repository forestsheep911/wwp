export function mergeBrowsePage<T extends { assetKey: string }>(
  currentResults: T[],
  incomingResults: T[],
  options: { append: boolean; reset?: boolean }
) {
  if (!options.append || options.reset) {
    return incomingResults;
  }
  const currentKeys = new Set(currentResults.map((result) => result.assetKey));
  return [...currentResults, ...incomingResults.filter((result) => !currentKeys.has(result.assetKey))];
}
