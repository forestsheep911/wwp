import type { SearchResult } from "@wwpdw/shared";

export function stableBrowseTie(left: SearchResult, right: SearchResult) {
  return left.assetKey.localeCompare(right.assetKey);
}
