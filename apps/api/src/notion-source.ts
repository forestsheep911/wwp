import { Client } from "@notionhq/client";
import type { SearchResult } from "@wwpdw/shared";

type JsonRecord = Record<string, unknown>;

interface MediaCandidate {
  url: string;
  label: string;
  score: number;
  kind: "file" | "video" | "embed" | "url" | "text";
}

interface ParseOptions {
  searchPageSize: number;
  parseMaxPages: number;
  blockDepth: number;
  blockLimit: number;
  titleScanLimit: number;
  titleMatchLimit: number;
}

const defaultOptions: ParseOptions = {
  searchPageSize: Number(process.env.NOTION_SEARCH_PAGE_SIZE ?? 8),
  parseMaxPages: Number(process.env.NOTION_PARSE_MAX_PAGES ?? 6),
  blockDepth: Number(process.env.NOTION_PARSE_BLOCK_DEPTH ?? 2),
  blockLimit: Number(process.env.NOTION_PARSE_BLOCK_LIMIT ?? 120),
  titleScanLimit: Number(process.env.NOTION_TITLE_SCAN_LIMIT ?? 120),
  titleMatchLimit: Number(process.env.NOTION_TITLE_MATCH_LIMIT ?? 6)
};

const urlPattern = /https?:\/\/[^\s<>"']+/gi;
const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const durationPropertyPattern = /duration|runtime|length|\u65f6\u957f|\u65f6\u95f4/i;
const cjkPattern = /[\u3400-\u9fff]/;

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeUrl(url: string) {
  return url.trim().replace(/[),.;\]]+$/g, "");
}

function looksDirect(url: string) {
  return directFilePattern.test(url) || notionHostedFilePattern.test(url);
}

function mediaScore(url: string, base: number) {
  return looksDirect(url) ? base + 40 : base;
}

function pushCandidate(
  candidates: MediaCandidate[],
  url: string | undefined,
  label: string,
  baseScore: number,
  kind: MediaCandidate["kind"]
) {
  if (!url) {
    return;
  }

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl.startsWith("http")) {
    return;
  }

  candidates.push({
    url: normalizedUrl,
    label,
    score: mediaScore(normalizedUrl, baseScore),
    kind
  });
}

function plainTextFromRichText(value: unknown) {
  return asArray(value)
    .map((item) => asString(asRecord(item)?.plain_text))
    .filter(Boolean)
    .join("");
}

function urlsFromRichText(value: unknown, label: string, candidates: MediaCandidate[], baseScore: number) {
  const textParts: string[] = [];

  for (const item of asArray(value)) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const href = asString(record.href);
    pushCandidate(candidates, href, `${label} link`, baseScore + 8, "url");
    const plainText = asString(record.plain_text);
    if (plainText) {
      textParts.push(plainText);
    }
  }

  for (const url of textParts.join(" ").match(urlPattern) ?? []) {
    pushCandidate(candidates, url, `${label} text`, baseScore, "text");
  }

  return textParts.join(" ").trim();
}

function mediaUrlFromObject(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  if (record.type === "external") {
    return asString(asRecord(record.external)?.url);
  }

  if (record.type === "file") {
    return asString(asRecord(record.file)?.url);
  }

  return asString(record.url);
}

function collectPropertyCandidates(
  properties: JsonRecord,
  candidates: MediaCandidate[]
) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    const type = asString(property.type);
    if (type === "url") {
      pushCandidate(candidates, asString(property.url), `property:${name}`, 42, "url");
    }

    if (type === "files") {
      for (const file of asArray(property.files)) {
        pushCandidate(candidates, mediaUrlFromObject(file), `property:${name}`, 72, "file");
      }
    }

    if (type === "title" || type === "rich_text") {
      urlsFromRichText(property[type], `property:${name}`, candidates, 32);
    }

    if (type === "formula") {
      const formula = asRecord(property.formula);
      const stringValue = asString(formula?.string);
      for (const url of stringValue.match(urlPattern) ?? []) {
        pushCandidate(candidates, url, `property:${name} formula`, 30, "text");
      }
    }
  }
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = plainTextFromRichText(record.title);
      if (title) {
        return title;
      }
    }
  }

  return "Untitled Notion page";
}

function durationFromProperties(properties: JsonRecord) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!durationPropertyPattern.test(name)) {
      continue;
    }

    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    const type = asString(property.type);
    if (type === "rich_text" || type === "title") {
      const text = plainTextFromRichText(property[type]);
      if (text) {
        return text;
      }
    }

    if (type === "number" && typeof property.number === "number") {
      return `${property.number}`;
    }
  }

  return "--";
}

function collectBlockCandidates(block: JsonRecord, candidates: MediaCandidate[]) {
  const type = asString(block.type);
  const payload = asRecord(block[type]);
  if (!payload) {
    return;
  }

  if (type === "video") {
    pushCandidate(candidates, mediaUrlFromObject(payload.video ?? payload), "block:video", 90, "video");
  }

  if (type === "file" || type === "audio" || type === "pdf") {
    pushCandidate(candidates, mediaUrlFromObject(payload), `block:${type}`, 76, "file");
  }

  if (type === "embed" || type === "bookmark" || type === "link_preview") {
    pushCandidate(candidates, asString(payload.url), `block:${type}`, 52, "embed");
  }

  if ("rich_text" in payload) {
    urlsFromRichText(payload.rich_text, `block:${type}`, candidates, 34);
  }

  if (type === "table_row") {
    for (const cell of asArray(payload.cells)) {
      urlsFromRichText(cell, "block:table_row", candidates, 28);
    }
  }
}

function chooseBestCandidate(candidates: MediaCandidate[]) {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    })
    .sort((left, right) => right.score - left.score)[0];
}

function isPageResult(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  return record?.object === "page" && typeof record.id === "string";
}

export class NotionSearchSource {
  readonly description = "notion read-only search";
  private readonly notion = new Client({
    auth: process.env.NOTION_READ_ONLY_TOKEN
  });

  constructor(private readonly options = defaultOptions) {}

  async search(query: string): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    const response = await this.notion.search({
      query: normalizedQuery || undefined,
      filter: {
        property: "object",
        value: "page"
      },
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      },
      page_size: this.options.searchPageSize
    });

    const pages: JsonRecord[] = response.results
      .filter(isPageResult)
      .slice(0, this.options.parseMaxPages);

    if (normalizedQuery) {
      pages.push(...await this.findSegmentMatches(normalizedQuery, pages));
      pages.push(...await this.findTitleMatches(normalizedQuery, pages));
    }

    const results: SearchResult[] = [];
    for (const page of pages) {
      results.push(await this.pageToSearchResult(page));
    }

    return this.rankResults(results, normalizedQuery);
  }

  private querySegments(query: string) {
    if (!cjkPattern.test(query) || Array.from(query).length < 3) {
      return [];
    }

    const chars = Array.from(query);
    return [...new Set([
      chars.slice(0, 2).join(""),
      chars.slice(-2).join("")
    ].filter((segment) => segment && segment !== query))];
  }

  private async findSegmentMatches(query: string, existingPages: JsonRecord[]) {
    const seenIds = new Set(existingPages.map((page) => asString(page.id)));
    const matches: JsonRecord[] = [];

    for (const segment of this.querySegments(query)) {
      const response = await this.notion.search({
        query: segment,
        filter: {
          property: "object",
          value: "page"
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time"
        },
        page_size: this.options.searchPageSize
      });

      for (const page of response.results.filter(isPageResult) as JsonRecord[]) {
        const pageId = asString(page.id);
        if (seenIds.has(pageId)) {
          continue;
        }

        matches.push(page);
        seenIds.add(pageId);
        if (matches.length >= this.options.titleMatchLimit) {
          return matches;
        }
      }
    }

    return matches;
  }

  private async findTitleMatches(query: string, existingPages: JsonRecord[]) {
    if (this.options.titleScanLimit <= 0 || this.options.titleMatchLimit <= 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase();
    const seenIds = new Set(existingPages.map((page) => asString(page.id)));
    const matches: JsonRecord[] = [];
    let scanned = 0;
    let startCursor: string | undefined;

    do {
      const response = await this.notion.search({
        filter: {
          property: "object",
          value: "page"
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time"
        },
        page_size: Math.min(100, this.options.titleScanLimit - scanned),
        start_cursor: startCursor
      });

      const pageResults: JsonRecord[] = response.results.filter(isPageResult);
      for (const page of pageResults) {
        scanned += 1;
        const pageId = asString(page.id);
        if (seenIds.has(pageId)) {
          continue;
        }

        const properties = asRecord(page.properties) ?? {};
        const title = titleFromProperties(properties).toLowerCase();
        if (title.includes(normalizedQuery)) {
          matches.push(page);
          seenIds.add(pageId);
        }

        if (matches.length >= this.options.titleMatchLimit || scanned >= this.options.titleScanLimit) {
          break;
        }
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (
      startCursor &&
      scanned < this.options.titleScanLimit &&
      matches.length < this.options.titleMatchLimit
    );

    return matches;
  }

  private rankResults(results: SearchResult[], query: string) {
    if (!query) {
      return results;
    }

    const normalizedQuery = query.toLowerCase();
    return results.sort((left, right) => {
      const leftExact = left.title.toLowerCase().includes(normalizedQuery) ? 1 : 0;
      const rightExact = right.title.toLowerCase().includes(normalizedQuery) ? 1 : 0;
      return rightExact - leftExact;
    });
  }

  private async pageToSearchResult(page: JsonRecord): Promise<SearchResult> {
    const properties = asRecord(page.properties) ?? {};
    const candidates: MediaCandidate[] = [];
    collectPropertyCandidates(properties, candidates);

    try {
      await this.collectBlockTree(asString(page.id), 0, { count: 0 }, candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : "block parse failed";
      candidates.push({
        url: asString(page.url),
        label: `parse warning: ${message}`,
        score: 1,
        kind: "text"
      });
    }

    const best = chooseBestCandidate(candidates);
    const title = titleFromProperties(properties);
    const pageUrl = asString(page.url);
    const sourceUrl = best?.url || pageUrl;
    const summary = best
      ? `Parsed ${best.label}; ${looksDirect(best.url) ? "direct media candidate" : "intermediate link candidate"}.`
      : "No media URL found by the rule parser yet; cache will need browser or AI resolution.";

    return {
      assetKey: `notion-page-${asString(page.id)}`,
      title,
      source: "Notion",
      sourceUrl,
      durationLabel: durationFromProperties(properties),
      updatedAt: asString(page.last_edited_time) || new Date().toISOString(),
      summary
    };
  }

  private async collectBlockTree(
    blockId: string,
    depth: number,
    counter: { count: number },
    candidates: MediaCandidate[]
  ) {
    if (!blockId || depth > this.options.blockDepth || counter.count >= this.options.blockLimit) {
      return;
    }

    let startCursor: string | undefined;
    do {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: Math.min(100, this.options.blockLimit - counter.count),
        start_cursor: startCursor
      });

      for (const block of response.results) {
        if (counter.count >= this.options.blockLimit) {
          break;
        }

        const record = asRecord(block);
        if (!record) {
          continue;
        }

        counter.count += 1;
        collectBlockCandidates(record, candidates);

        if (record.has_children === true && depth < this.options.blockDepth) {
          await this.collectBlockTree(asString(record.id), depth + 1, counter, candidates);
        }
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (startCursor && counter.count < this.options.blockLimit);
  }
}
