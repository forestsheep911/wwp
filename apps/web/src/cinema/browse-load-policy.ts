import type { BrowseViewId } from "./types";

export type BrowseLoadMode = "paged" | "random";

export const browseInitialVisibleCount = 12;
export const browseAppendPageLimit = 100;
export const browseLuckyPageLimit = 48;
export const browseTspdtCatalogLimit = 2_000;

export type BrowseRequestPolicyOptions = {
  append?: boolean;
  limit?: number;
  mode?: BrowseLoadMode;
  view?: BrowseViewId;
};

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

export function resolveBrowseRequest(
  currentView: BrowseViewId,
  options: BrowseRequestPolicyOptions = {}
): { append: boolean; view: BrowseViewId; mode: BrowseLoadMode; limit: number } {
  const append = options.append === true;
  const view = options.view ?? currentView;
  const defaults = browseRequestDefaults(view, append);
  return {
    append,
    view,
    mode: options.mode ?? defaults.mode,
    limit: options.limit ?? defaults.limit
  };
}

export function browseFullCatalogRequest(view: BrowseViewId): { mode: "paged"; limit: number } {
  return {
    mode: "paged",
    limit: view === "tspdtRank" ? browseTspdtCatalogLimit : browseAppendPageLimit
  };
}
