import { createHash } from "node:crypto";
import type { SearchResult } from "@wwpdw/shared";

export function browseCatalogRevision(results: SearchResult[]) {
  const digest = createHash("sha256");
  for (const result of results) {
    digest.update(result.assetKey);
    digest.update("\0");
    digest.update(result.updatedAt ?? "");
    digest.update("\0");
  }
  return `${results.length}:${digest.digest("hex").slice(0, 16)}`;
}

export function resolveBrowseOffset(input: {
  requestedOffset: number;
  requestedRevision?: string;
  currentRevision: string;
}) {
  const reset = input.requestedOffset > 0 &&
    Boolean(input.requestedRevision) &&
    input.requestedRevision !== input.currentRevision;
  return {
    offset: reset ? 0 : input.requestedOffset,
    reset
  };
}
