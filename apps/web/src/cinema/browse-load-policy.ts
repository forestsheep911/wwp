import type { BrowseViewId } from "./types";

export type BrowseLoadMode = "paged" | "random";

export const browseInitialVisibleCount = 12;
export const browseAppendPageLimit = 100;
export const browseLuckyPageLimit = 48;
export const browseTspdtCatalogLimit = 2_000;

export function browseRequestDefaults(view: BrowseViewId, append: boolean): {
  mode: BrowseLoadMode;
  limit: number;
} {
  if (append) {
    return { mode: "paged", limit: browseAppendPageLimit };
  }
  if (view === "lucky") {
    return { mode: "random", limit: browseLuckyPageLimit };
  }
  if (view === "tspdtRank") {
    return { mode: "paged", limit: browseTspdtCatalogLimit };
  }
  return { mode: "paged", limit: browseInitialVisibleCount };
}
