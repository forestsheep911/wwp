import { createHash } from "node:crypto";
import { Client } from "@notionhq/client";
import type { MediaVariant, MovieMetadata, RatingValue, SearchResult } from "@wwpdw/shared";

type JsonRecord = Record<string, unknown>;

interface MediaCandidate {
  url: string;
  label: string;
  score: number;
  kind: MediaVariant["kind"];
}

interface LibraryMetadata {
  dataSourceId: string;
  titleProperty?: string;
  databaseTitle?: string;
}

interface ChildPageCandidate {
  id: string;
  title: string;
}

interface ParseOptions {
  searchPageSize: number;
  parseMaxPages: number;
  blockDepth: number;
  blockLimit: number;
  titleScanLimit: number;
  titleMatchLimit: number;
  libraryQueryLimit: number;
  variantLimit: number;
}

const defaultOptions: ParseOptions = {
  searchPageSize: Number(process.env.NOTION_SEARCH_PAGE_SIZE ?? 8),
  parseMaxPages: Number(process.env.NOTION_PARSE_MAX_PAGES ?? 6),
  blockDepth: Number(process.env.NOTION_PARSE_BLOCK_DEPTH ?? 2),
  blockLimit: Number(process.env.NOTION_PARSE_BLOCK_LIMIT ?? 120),
  titleScanLimit: Number(process.env.NOTION_TITLE_SCAN_LIMIT ?? 120),
  titleMatchLimit: Number(process.env.NOTION_TITLE_MATCH_LIMIT ?? 6),
  libraryQueryLimit: Number(process.env.NOTION_LIBRARY_QUERY_LIMIT ?? 300),
  variantLimit: Number(process.env.NOTION_VARIANT_LIMIT ?? 8)
};

const urlPattern = /https?:\/\/[^\s<>"']+/gi;
const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const durationPropertyPattern = /duration|runtime|length|\u65f6\u957f|\u65f6\u95f4/i;
const posterPropertyPattern = /\u6d77\u62a5|poster|cover|image|\u56fe\u7247/i;
const descriptionPropertyPattern = /\u7b80\u4ecb|summary|description|synopsis|plot/i;
const infoPropertyPattern = /\u57fa\u672c\u4fe1\u606f|info|metadata/i;
const releaseDatePropertyPattern = /\u4e0a\u6620|release|premiere|date/i;
const genrePropertyPattern = /\u65e8\u8da3|\u7c7b\u578b|genre|tag/i;
const directorPropertyPattern = /\u5bfc\u6f14|\bdirectors?\b/i;
const peoplePropertyPattern = /\u4e3b\u6f14|\bcast\b|\bactors?\b|\bpeople\b/i;
const ratingLevelPropertyPattern = /\u5206\u7ea7|certificate|rating level|rated/i;
const typePropertyPattern = /\u5f71\u522b|type|kind/i;
const imdbPropertyPattern = /^imdb$/i;
const ratingPropertyPattern = /\u8c46\u74e3\u8bc4\u5206|imdb\u8bc4\u5206|metascore|\u70c2\u756a\u8304|rating|score/i;
const cjkPattern = /[\u3400-\u9fff]/;
const specTitlePattern =
  /\d+(?:\.\d+)?\s*(?:GB|MB)|\b(?:4k|2160p|1080p|720p|480p)\b|\u56fd\u914d|\u666e\u901a\u8bdd|\u7e41\u7b80\u82f1|\u7e41\u7b80|\u7b80\u82f1|\u7b80\u4e2d|\u7e41\u82f1|\u53cc\u8bed|\u4e2d\u5b57|\u5b57\u5e55|\u539f\u76d8|\u84dd\u5149|BD|BluRay|WEB[- ]?DL|HDRip/i;
const sourceGroupTitlePattern = /\u7247\u6e90|\u8d44\u6e90|\bsource\b|\bmedia\b|\bfiles?\b/i;
const ignoredTitlePrefixPattern = /^(?:\u4ec5\u4f9b\u4e0b\u8f7d|\u656c\u8bf7\u671f\u5f85)$/;
const metadataLabelPattern =
  /\u6d77\u62a5|poster|\u57fa\u672c\u4fe1\u606f|\u7b80\u4ecb|imdb|\u8c46\u74e3|douban|rotten|metascore/i;
const imageFilePattern = /\.(webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i;
const nonPlayableFilePattern = /\.(?:7z|zip|rar|tar|gz|bz2|xz|srt|ass|ssa|nfo|txt|pdf)(?:\.\d+)?(?:[?#].*)?$/i;

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

function cleanLabel(label: string) {
  return label
    .replace(/^property:/, "")
    .replace(/^block:/, "")
    .replace(/\s+/g, " ")
    .trim();
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
    label: cleanLabel(label) || kind,
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

function fileNameFromObject(value: unknown) {
  return asString(asRecord(value)?.name);
}

function collectPropertyCandidates(properties: JsonRecord, candidates: MediaCandidate[]) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    const type = asString(property.type);
    if (type === "url") {
      pushCandidate(candidates, asString(property.url), name, 42, "url");
    }

    if (type === "files") {
      for (const file of asArray(property.files)) {
        const fileName = fileNameFromObject(file);
        pushCandidate(
          candidates,
          mediaUrlFromObject(file),
          fileName ? `${name}: ${fileName}` : name,
          72,
          "file"
        );
      }
    }

    if (type === "title" || type === "rich_text") {
      urlsFromRichText(property[type], name, candidates, 32);
    }

    if (type === "formula") {
      const formula = asRecord(property.formula);
      const stringValue = asString(formula?.string);
      for (const url of stringValue.match(urlPattern) ?? []) {
        pushCandidate(candidates, url, `${name} formula`, 30, "text");
      }
    }
  }
}

function propertyText(value: unknown) {
  const property = asRecord(value);
  if (!property) {
    return "";
  }

  const type = asString(property.type);
  if (type === "title" || type === "rich_text") {
    return plainTextFromRichText(property[type]);
  }

  if (type === "url") {
    return asString(property.url);
  }

  if (type === "files") {
    return asArray(property.files)
      .map((file) => [fileNameFromObject(file), mediaUrlFromObject(file)].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" ");
  }

  if (type === "select" || type === "status") {
    return asString(asRecord(property[type])?.name);
  }

  if (type === "multi_select") {
    return asArray(property.multi_select)
      .map((item) => asString(asRecord(item)?.name))
      .filter(Boolean)
      .join(" ");
  }

  if (type === "number" && typeof property.number === "number") {
    return `${property.number}`;
  }

  if (type === "date") {
    const date = asRecord(property.date);
    return [date?.start, date?.end].map(asString).filter(Boolean).join(" ");
  }

  if (type === "formula") {
    const formula = asRecord(property.formula);
    return [
      formula?.string,
      formula?.number,
      formula?.boolean,
      asRecord(formula?.date)?.start,
      asRecord(formula?.date)?.end
    ].map((item) => `${item ?? ""}`).filter(Boolean).join(" ");
  }

  return "";
}

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function clipText(value: string, limit: number) {
  const cleaned = cleanText(value);
  if (cleaned.length <= limit) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function namesFromProperty(value: unknown) {
  const property = asRecord(value);
  if (!property) {
    return [];
  }

  const type = asString(property.type);
  if (type === "select" || type === "status") {
    return [asString(asRecord(property[type])?.name)].filter(Boolean);
  }

  if (type === "multi_select") {
    return asArray(property.multi_select)
      .map((item) => asString(asRecord(item)?.name))
      .filter(Boolean);
  }

  const text = propertyText(property);
  return text ? [text] : [];
}

function dateStartFromProperty(value: unknown) {
  const property = asRecord(value);
  if (!property || property.type !== "date") {
    return "";
  }

  return asString(asRecord(property.date)?.start);
}

function numberFromProperty(value: unknown) {
  const property = asRecord(value);
  if (!property) {
    return undefined;
  }

  if (property.type === "number" && typeof property.number === "number") {
    return property.number;
  }

  const formula = asRecord(property.formula);
  return typeof formula?.number === "number" ? formula.number : undefined;
}

function textFromNamedProperty(properties: JsonRecord, pattern: RegExp, limit: number) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const text = propertyText(rawProperty);
    if (text) {
      return clipText(text, limit);
    }
  }

  return undefined;
}

function listFromNamedProperty(properties: JsonRecord, pattern: RegExp, limit: number) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const names = namesFromProperty(rawProperty).map(cleanText).filter(Boolean);
    if (names.length > 0) {
      return names.slice(0, limit);
    }
  }

  return undefined;
}

function dateFromNamedProperty(properties: JsonRecord, pattern: RegExp) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const date = dateStartFromProperty(rawProperty) || propertyText(rawProperty);
    if (date) {
      return cleanText(date);
    }
  }

  return undefined;
}

function ratingLabel(name: string) {
  if (/\u8c46\u74e3/i.test(name)) {
    return "Douban";
  }

  if (/imdb/i.test(name)) {
    return "IMDb";
  }

  if (/metascore/i.test(name)) {
    return "Meta";
  }

  if (/\u70c2\u756a\u8304|rotten/i.test(name)) {
    return "RT";
  }

  return name;
}

function ratingsFromProperties(properties: JsonRecord) {
  const ratings: RatingValue[] = [];
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!ratingPropertyPattern.test(name)) {
      continue;
    }

    const number = numberFromProperty(rawProperty);
    const text = number === undefined ? propertyText(rawProperty) : `${number}`;
    if (!text) {
      continue;
    }

    ratings.push({
      label: ratingLabel(name),
      value: cleanText(text)
    });
  }

  return ratings.slice(0, 4);
}

function yearFromTitleOrDate(title: string, releaseDate?: string) {
  const titleYear = title.match(/\((\d{4})\)/)?.[1] ?? title.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  if (titleYear) {
    return titleYear;
  }

  return releaseDate?.match(/^\d{4}/)?.[0];
}

function posterUrlFromProperties(page: JsonRecord, properties: JsonRecord) {
  const coverUrl = mediaUrlFromObject(page.cover);
  if (coverUrl) {
    return coverUrl;
  }

  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!posterPropertyPattern.test(name)) {
      continue;
    }

    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    const type = asString(property.type);
    if (type === "files") {
      for (const file of asArray(property.files)) {
        const url = mediaUrlFromObject(file);
        if (url) {
          return url;
        }
      }
    }

    if (type === "url" && asString(property.url)) {
      return asString(property.url);
    }

    if (type === "rich_text") {
      const url = plainTextFromRichText(property.rich_text).match(urlPattern)?.[0];
      if (url) {
        return normalizeUrl(url);
      }
    }
  }

  return undefined;
}

function movieMetadataFromPage(page: JsonRecord, properties: JsonRecord, title: string): MovieMetadata {
  const releaseDate = dateFromNamedProperty(properties, releaseDatePropertyPattern);
  const metadata: MovieMetadata = {
    posterUrl: posterUrlFromProperties(page, properties),
    type: listFromNamedProperty(properties, typePropertyPattern, 1)?.[0],
    releaseDate,
    year: yearFromTitleOrDate(title, releaseDate),
    genres: listFromNamedProperty(properties, genrePropertyPattern, 4),
    directors: listFromNamedProperty(properties, directorPropertyPattern, 3),
    people: listFromNamedProperty(properties, peoplePropertyPattern, 4),
    ratings: ratingsFromProperties(properties),
    ratingLevel: listFromNamedProperty(properties, ratingLevelPropertyPattern, 3),
    info: textFromNamedProperty(properties, infoPropertyPattern, 180),
    description: textFromNamedProperty(properties, descriptionPropertyPattern, 360),
    imdbId: textFromNamedProperty(properties, imdbPropertyPattern, 40)
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    })
  ) as MovieMetadata;
}

function propertiesSearchText(properties: JsonRecord) {
  return Object.values(properties)
    .map(propertyText)
    .filter(Boolean)
    .join(" ");
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
    const label = cleanText(plainTextFromRichText(payload.caption)) || fileNameFromObject(payload) || "video";
    pushCandidate(candidates, mediaUrlFromObject(payload.video ?? payload), label, 90, "video");
  }

  if (type === "file" || type === "audio" || type === "pdf") {
    const label = cleanText(plainTextFromRichText(payload.caption)) || fileNameFromObject(payload) || type;
    pushCandidate(candidates, mediaUrlFromObject(payload), label, 76, "file");
  }

  if (type === "embed" || type === "bookmark" || type === "link_preview") {
    pushCandidate(candidates, asString(payload.url), type, 52, "embed");
  }

  if ("rich_text" in payload) {
    urlsFromRichText(payload.rich_text, type, candidates, 34);
  }

  if (type === "table_row") {
    for (const cell of asArray(payload.cells)) {
      urlsFromRichText(cell, "table row", candidates, 28);
    }
  }
}

function uniqueCandidates(candidates: MediaCandidate[]) {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    })
    .sort((left, right) => right.score - left.score);
}

function chooseBestCandidate(candidates: MediaCandidate[]) {
  return uniqueCandidates(candidates)[0];
}

function stableUrlForKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split(/[?#]/)[0];
  }
}

function variantAssetKey(pageId: string, candidate: MediaCandidate, index: number) {
  const hash = createHash("sha1")
    .update(`${pageId}\n${candidate.label}\n${stableUrlForKey(candidate.url)}`)
    .digest("hex")
    .slice(0, 12);
  return `notion-page-${pageId}-variant-${index + 1}-${hash}`;
}

function candidateSummary(candidate: MediaCandidate) {
  return `${looksDirect(candidate.url) ? "Direct media candidate" : "Intermediate link candidate"} from ${candidate.label}.`;
}

function isLikelyPlayableCandidate(candidate: MediaCandidate) {
  if (metadataLabelPattern.test(candidate.label) || imageFilePattern.test(candidate.url)) {
    return false;
  }

  if (nonPlayableFilePattern.test(candidate.label) || nonPlayableFilePattern.test(candidate.url)) {
    return false;
  }

  return candidate.kind === "video" ||
    looksDirect(candidate.url) ||
    specTitlePattern.test(candidate.label);
}

function primaryCjkTitle(title: string) {
  const matches = title.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  return matches.find((match) => !ignoredTitlePrefixPattern.test(match)) ?? matches[0] ?? "";
}

function isLikelySpecPage(title: string, movieTitle: string) {
  if (sourceGroupTitlePattern.test(title)) {
    return true;
  }

  if (specTitlePattern.test(title)) {
    return true;
  }

  const cjkTitle = primaryCjkTitle(movieTitle);
  return Boolean(cjkTitle && title.includes(cjkTitle));
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function textMatches(text: string, query: string) {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  return normalizedText.includes(normalizedQuery) ||
    compactSearchText(normalizedText).includes(compactSearchText(normalizedQuery));
}

function isPageResult(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  return record?.object === "page" && typeof record.id === "string";
}

function isChildDatabaseBlock(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  return record?.object === "block" && record.type === "child_database" && typeof record.id === "string";
}

export class NotionSearchSource {
  readonly description: string;
  private readonly notion = new Client({
    auth: process.env.NOTION_READ_ONLY_TOKEN
  });
  private readonly libraryRootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
  private readonly configuredLibraryDataSourceId =
    process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
  private readonly configuredLibraryDatabaseId =
    process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;
  private libraryMetadata?: Promise<LibraryMetadata | undefined>;

  constructor(private readonly options = defaultOptions) {
    this.description = this.hasLibraryConfig()
      ? "notion library database search"
      : "notion read-only search";
  }

  async search(query: string): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    const library = await this.getLibraryMetadata();
    if (library) {
      return this.searchLibrary(library, normalizedQuery);
    }

    return this.searchGlobal(normalizedQuery);
  }

  private hasLibraryConfig() {
    return Boolean(
      this.libraryRootPageId ||
      this.configuredLibraryDataSourceId ||
      this.configuredLibraryDatabaseId
    );
  }

  private async getLibraryMetadata() {
    this.libraryMetadata ??= this.loadLibraryMetadata();
    return this.libraryMetadata;
  }

  private async loadLibraryMetadata(): Promise<LibraryMetadata | undefined> {
    if (this.configuredLibraryDataSourceId) {
      return this.loadDataSourceMetadata(this.configuredLibraryDataSourceId);
    }

    if (this.configuredLibraryDatabaseId) {
      return this.loadDatabaseMetadata(this.configuredLibraryDatabaseId);
    }

    if (!this.libraryRootPageId) {
      return undefined;
    }

    const response = await this.notion.blocks.children.list({
      block_id: this.libraryRootPageId,
      page_size: 100
    });
    const databases = response.results.filter(isChildDatabaseBlock);

    if (databases.length === 0) {
      throw new Error("Library root page is set, but no direct child database was found.");
    }

    if (databases.length > 1) {
      throw new Error("Library root page has more than one direct child database; configure NOTION_LIBRARY_DATABASE_ID.");
    }

    const databaseBlock = asRecord(databases[0]) ?? {};
    const databaseTitle = asString(asRecord(databaseBlock.child_database)?.title);
    return this.loadDatabaseMetadata(asString(databaseBlock.id), databaseTitle);
  }

  private async loadDatabaseMetadata(databaseId: string, databaseTitle?: string): Promise<LibraryMetadata> {
    const database = await this.notion.databases.retrieve({ database_id: databaseId });
    const dataSources = asArray(asRecord(database)?.data_sources);
    const dataSourceId = asString(asRecord(dataSources[0])?.id) || databaseId;
    return this.loadDataSourceMetadata(dataSourceId, databaseTitle);
  }

  private async loadDataSourceMetadata(dataSourceId: string, databaseTitle?: string): Promise<LibraryMetadata> {
    try {
      const dataSource = await this.notion.dataSources.retrieve({ data_source_id: dataSourceId });
      const properties = asRecord(asRecord(dataSource)?.properties) ?? {};
      return {
        dataSourceId,
        titleProperty: this.findTitleProperty(properties),
        databaseTitle
      };
    } catch {
      return {
        dataSourceId,
        databaseTitle
      };
    }
  }

  private findTitleProperty(properties: JsonRecord) {
    for (const [name, property] of Object.entries(properties)) {
      if (asRecord(property)?.type === "title") {
        return name;
      }
    }

    return undefined;
  }

  private async searchLibrary(library: LibraryMetadata, query: string): Promise<SearchResult[]> {
    const pagesById = new Map<string, JsonRecord>();

    if (query && library.titleProperty) {
      const exactMatches = await this.queryDataSourcePages(library, {
        limit: Math.max(this.options.searchPageSize, this.options.titleMatchLimit),
        titleContains: query
      });
      exactMatches.forEach((page) => pagesById.set(asString(page.id), page));

      const fallbackTerms = exactMatches.length === 0 ? this.querySegments(query) : [];
      for (const term of fallbackTerms) {
        const matches = await this.queryDataSourcePages(library, {
          limit: Math.max(this.options.searchPageSize, this.options.titleMatchLimit),
          titleContains: term
        });
        matches.forEach((page) => pagesById.set(asString(page.id), page));
      }
    }

    const scanLimit = query ? this.options.libraryQueryLimit : this.options.searchPageSize;
    const scannedPages = await this.queryDataSourcePages(library, { limit: scanLimit });
    for (const page of scannedPages) {
      if (!query || this.pageMatches(page, query)) {
        pagesById.set(asString(page.id), page);
      }
    }

    const pages = this.rankPages([...pagesById.values()], query).slice(0, this.options.searchPageSize);
    const results: SearchResult[] = [];
    for (const page of pages) {
      results.push(await this.pageToSearchResult(page, { libraryMode: true }));
    }

    return results;
  }

  private async queryDataSourcePages(
    library: LibraryMetadata,
    options: { limit: number; titleContains?: string }
  ) {
    const pages: JsonRecord[] = [];
    let startCursor: string | undefined;

    do {
      const request: JsonRecord = {
        data_source_id: library.dataSourceId,
        page_size: Math.min(100, Math.max(1, options.limit - pages.length)),
        start_cursor: startCursor,
        result_type: "page",
        sorts: [
          {
            timestamp: "last_edited_time",
            direction: "descending"
          }
        ]
      };

      if (options.titleContains && library.titleProperty) {
        request.filter = {
          property: library.titleProperty,
          title: {
            contains: options.titleContains
          }
        };
      }

      const response = await this.notion.dataSources.query(request as never);
      for (const page of response.results.filter(isPageResult)) {
        pages.push(page);
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (startCursor && pages.length < options.limit);

    return pages.slice(0, options.limit);
  }

  private pageMatches(page: JsonRecord, query: string) {
    const properties = asRecord(page.properties) ?? {};
    return textMatches(titleFromProperties(properties), query) ||
      textMatches(propertiesSearchText(properties), query);
  }

  private rankPages(pages: JsonRecord[], query: string) {
    if (!query) {
      return pages;
    }

    return pages
      .map((page) => {
        const properties = asRecord(page.properties) ?? {};
        const title = titleFromProperties(properties);
        const text = propertiesSearchText(properties);
        let score = 0;
        if (textMatches(title, query)) {
          score += 100;
        }
        if (textMatches(text, query)) {
          score += 20;
        }
        for (const segment of this.querySegments(query)) {
          if (textMatches(title, segment)) {
            score += 8;
          }
        }
        return { page, score };
      })
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.page);
  }

  private async searchGlobal(query: string): Promise<SearchResult[]> {
    const response = await this.notion.search({
      query: query || undefined,
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

    if (query) {
      pages.push(...await this.findSegmentMatches(query, pages));
      pages.push(...await this.findTitleMatches(query, pages));
    }

    const results: SearchResult[] = [];
    for (const page of pages) {
      results.push(await this.pageToSearchResult(page));
    }

    return this.rankResults(results, query);
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
        const title = titleFromProperties(properties);
        if (textMatches(title, query)) {
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

    return results.sort((left, right) => {
      const leftExact = textMatches(left.title, query) ? 1 : 0;
      const rightExact = textMatches(right.title, query) ? 1 : 0;
      return rightExact - leftExact;
    });
  }

  private async pageToSearchResult(
    page: JsonRecord,
    context: { libraryMode?: boolean } = {}
  ): Promise<SearchResult> {
    const properties = asRecord(page.properties) ?? {};
    const candidates: MediaCandidate[] = [];
    const childPages: ChildPageCandidate[] = [];
    collectPropertyCandidates(properties, candidates);

    try {
      const maxDepth = context.libraryMode
        ? Math.min(this.options.blockDepth, 1)
        : this.options.blockDepth;
      await this.collectBlockTree(
        asString(page.id),
        0,
        { count: 0 },
        candidates,
        maxDepth,
        context.libraryMode ? childPages : undefined
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "block parse failed";
      candidates.push({
        url: asString(page.url),
        label: `parse warning: ${message}`,
        score: 1,
        kind: "text"
      });
    }

    const unique = uniqueCandidates(candidates);
    const best = unique[0];
    const title = titleFromProperties(properties);
    const metadata = movieMetadataFromPage(page, properties, title);
    const pageUrl = asString(page.url);
    const variants = context.libraryMode
      ? await this.libraryVariants(asString(page.id), title, unique, childPages)
      : this.candidatesToVariants(asString(page.id), unique);
    const sourceUrl = variants[0]?.sourceUrl || best?.url || pageUrl;
    const summary = context.libraryMode
      ? this.librarySummary(variants)
      : this.globalSummary(best);

    return {
      assetKey: `notion-page-${asString(page.id)}`,
      title,
      source: context.libraryMode ? "Notion library" : "Notion",
      sourceUrl,
      durationLabel: durationFromProperties(properties),
      updatedAt: asString(page.last_edited_time) || new Date().toISOString(),
      summary,
      metadata,
      variants
    };
  }

  private async libraryVariants(
    pageId: string,
    title: string,
    directCandidates: MediaCandidate[],
    childPages: ChildPageCandidate[]
  ) {
    const variants: MediaVariant[] = [];
    const seenUrls = new Set<string>();

    for (const childPage of childPages.filter((item) => isLikelySpecPage(item.title, title))) {
      const candidates: MediaCandidate[] = [];
      const nestedChildPages: ChildPageCandidate[] = [];
      await this.collectBlockTree(
        childPage.id,
        0,
        { count: 0 },
        candidates,
        Math.min(this.options.blockDepth, 1),
        nestedChildPages
      );
      const best = uniqueCandidates(candidates).find(isLikelyPlayableCandidate);
      if (best && !seenUrls.has(best.url)) {
        seenUrls.add(best.url);
        variants.push(this.candidateToVariant(childPage.id, best, variants.length, childPage.title));
        if (variants.length >= this.options.variantLimit) {
          return variants;
        }
      }

      for (const episodePage of nestedChildPages) {
        const episodeCandidates: MediaCandidate[] = [];
        await this.collectBlockTree(
          episodePage.id,
          0,
          { count: 0 },
          episodeCandidates,
          Math.min(this.options.blockDepth, 1)
        );
        const playableCandidates = uniqueCandidates(episodeCandidates).filter(isLikelyPlayableCandidate);
        for (const episodeCandidate of playableCandidates) {
          if (seenUrls.has(episodeCandidate.url)) {
            continue;
          }

          seenUrls.add(episodeCandidate.url);
          variants.push(this.candidateToVariant(
            episodePage.id,
            episodeCandidate,
            variants.length,
            playableCandidates.length === 1
              ? `${childPage.title} / ${episodePage.title}`
              : `${childPage.title} / ${episodePage.title} / ${episodeCandidate.label}`
          ));
          if (variants.length >= this.options.variantLimit) {
            return variants;
          }
        }
      }
    }

    const directVariants = this.candidatesToVariants(
      pageId,
      directCandidates.filter(isLikelyPlayableCandidate),
      variants.length
    ).filter((variant) => {
      if (seenUrls.has(variant.sourceUrl)) {
        return false;
      }
      seenUrls.add(variant.sourceUrl);
      return true;
    });

    return [...variants, ...directVariants].slice(0, this.options.variantLimit);
  }

  private candidatesToVariants(
    pageId: string,
    candidates: MediaCandidate[],
    indexOffset = 0
  ): MediaVariant[] {
    return candidates
      .filter((candidate) => candidate.score >= 20)
      .slice(0, Math.max(0, this.options.variantLimit - indexOffset))
      .map((candidate, index) => this.candidateToVariant(pageId, candidate, index + indexOffset));
  }

  private candidateToVariant(
    pageId: string,
    candidate: MediaCandidate,
    index: number,
    label?: string
  ): MediaVariant {
    return {
      assetKey: variantAssetKey(pageId, candidate, index),
      label: label || candidate.label || `Option ${index + 1}`,
      sourceUrl: candidate.url,
      kind: candidate.kind,
      summary: candidateSummary(candidate)
    };
  }

  private librarySummary(variants: MediaVariant[]) {
    if (variants.length === 0) {
      return "No playable specs were found in this movie entry.";
    }

    return `${variants.length} playable spec${variants.length === 1 ? "" : "s"} found in this movie entry.`;
  }

  private globalSummary(best?: MediaCandidate) {
    if (!best) {
      return "No media URL found by the rule parser yet; cache will need browser or AI resolution.";
    }

    return `Parsed ${best.label}; ${looksDirect(best.url) ? "direct media candidate" : "intermediate link candidate"}.`;
  }

  private async collectBlockTree(
    blockId: string,
    depth: number,
    counter: { count: number },
    candidates: MediaCandidate[],
    maxDepth: number,
    childPages?: ChildPageCandidate[]
  ) {
    if (!blockId || depth > maxDepth || counter.count >= this.options.blockLimit) {
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

        const type = asString(record.type);
        if (type === "child_page") {
          childPages?.push({
            id: asString(record.id),
            title: asString(asRecord(record.child_page)?.title)
          });
        }

        const isNestedPage = type === "child_page" || type === "child_database";
        if (record.has_children === true && depth < maxDepth && !isNestedPage) {
          await this.collectBlockTree(
            asString(record.id),
            depth + 1,
            counter,
            candidates,
            maxDepth,
            childPages
          );
        }
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (startCursor && counter.count < this.options.blockLimit);
  }
}
