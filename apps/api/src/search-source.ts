import { mockSearchResults, type SearchResult } from "@wwpdw/shared";
import { NotionSearchSource } from "./notion-source.js";

export interface SearchSource {
  readonly description: string;
  search(query: string): Promise<SearchResult[]>;
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
