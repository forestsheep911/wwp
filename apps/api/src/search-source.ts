import { mockSearchResults, type MediaVariant, type SearchResult } from "@wwpdw/shared";
import { NotionSearchSource } from "./notion-source.js";

export interface RefreshAssetInput {
  assetKey: string;
  sourcePageId?: string;
  title?: string;
  sourceBreadcrumb?: string[];
}

export interface SearchSource {
  readonly description: string;
  search(query: string): Promise<SearchResult[]>;
  refreshAsset?(input: RefreshAssetInput): Promise<SearchResult | undefined>;
}

function variantToSearchResult(result: SearchResult, variant: MediaVariant): SearchResult {
  return {
    assetKey: variant.assetKey,
    title: `${result.title} / ${variant.label}`,
    source: result.source,
    sourceUrl: variant.sourceUrl,
    sourcePageId: variant.sourcePageId ?? result.sourcePageId,
    sourceBreadcrumb: variant.sourceBreadcrumb ?? result.sourceBreadcrumb,
    durationLabel: result.durationLabel,
    updatedAt: result.updatedAt,
    summary: variant.summary,
    metadata: result.metadata
  };
}

function findResultByAssetKey(results: SearchResult[], assetKey: string) {
  for (const result of results) {
    if (result.assetKey === assetKey) {
      return result;
    }

    const variant = result.variants?.find((item) => item.assetKey === assetKey);
    if (variant) {
      return variantToSearchResult(result, variant);
    }
  }

  return undefined;
}

class MockSearchSource implements SearchSource {
  readonly description = "mock catalog";

  async search(query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    return mockSearchResults.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      return [item.title, item.source, item.summary, item.assetKey, item.sourceUrl]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }

  async refreshAsset(input: RefreshAssetInput) {
    return findResultByAssetKey(mockSearchResults, input.assetKey);
  }
}

export function createSearchSource(): SearchSource {
  const mode = process.env.SEARCH_SOURCE ?? process.env.WWPDW_SEARCH_SOURCE ?? "auto";

  if (mode === "mock") {
    return new MockSearchSource();
  }

  if (process.env.NOTION_READ_ONLY_TOKEN) {
    return new NotionSearchSource();
  }

  return new MockSearchSource();
}
