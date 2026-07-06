import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { normalizeImdbId, notionManagedProperties } from "./notion-metadata-schema.js";

type JsonRecord = Record<string, unknown>;

interface AuditOptions {
  limit: number;
  pageSize: number;
  query?: string;
  pageId?: string;
  reportPath?: string;
  dataSourceId?: string;
  databaseId?: string;
  rootPageId?: string;
}

interface LibraryMetadata {
  dataSourceId: string;
  titleProperty?: string;
  properties: JsonRecord;
}

interface PageAudit {
  pageId: string;
  title: string;
  url?: string;
  imdb?: string;
  presentFields: string[];
  missingFields: string[];
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const rootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const configuredDatabaseId = process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;
const notionRequestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);

const auditFields = [
  "WW Work ID",
  "IMDb ID",
  "Douban Subject ID",
  "TMDB ID",
  "Chinese Title",
  "Simplified Chinese Title",
  "Traditional Chinese Title (Taiwan)",
  "Traditional Chinese Title (Hong Kong)",
  "Original Title",
  "English Title",
  "Release Year",
  "Release Date",
  "Countries",
  "Languages",
  "Genres",
  "Runtime Minutes",
  "Directors",
  "Writers",
  "Cast",
  "分级",
  "Poster URL",
  "Box Office",
  "Box Office Amount",
  "Box Office Currency",
  "AI建议最低年龄",
  "AI年龄建议置信度",
  "内容风险标签",
  "AI年龄建议理由",
  "人工年龄覆盖",
  "Media Availability",
  "Hide from Website",
  "Developer Memo"
];

const sourceStrategy: Record<string, string[]> = {
  "WW Work ID": ["notion-metadata-maintenance"],
  "IMDb ID": ["notion page text parse", "TSPDT/IMDb search", "manual review"],
  "Douban Subject ID": ["notion page text parse", "Douban search", "manual review"],
  "TMDB ID": ["TMDb find by IMDb ID", "TMDb title/year search"],
  "Chinese Title": ["legacy Notion field", "Douban", "TMDb zh-CN"],
  "Simplified Chinese Title": ["Douban", "TMDb zh-CN", "manual review"],
  "Traditional Chinese Title (Taiwan)": ["TMDb zh-TW", "Taiwan release data", "manual review"],
  "Traditional Chinese Title (Hong Kong)": ["Hong Kong release data", "manual review"],
  "Original Title": ["TMDb", "Douban", "manual review"],
  "English Title": ["OMDb", "TMDb"],
  "Release Year": ["Notion title parse", "OMDb", "TMDb"],
  "Release Date": ["OMDb", "TMDb", "Douban"],
  "Countries": ["OMDb", "TMDb", "Douban"],
  "Languages": ["OMDb", "TMDb", "Douban"],
  "Genres": ["OMDb", "TMDb", "Douban"],
  "Runtime Minutes": ["OMDb", "TMDb", "Douban"],
  "Directors": ["OMDb", "TMDb credits", "Douban"],
  "Writers": ["OMDb", "TMDb credits"],
  "Cast": ["OMDb", "TMDb credits", "Douban"],
  "分级": ["OMDb Rated", "manual review"],
  "Poster URL": ["OMDb", "TMDb", "Douban"],
  "Box Office": ["OMDb", "manual review"],
  "Box Office Amount": ["OMDb", "manual review"],
  "Box Office Currency": ["OMDb", "manual review"],
  "AI建议最低年龄": ["AI family-age review", "manual override"],
  "AI年龄建议置信度": ["AI family-age review"],
  "内容风险标签": ["AI family-age review", "manual review"],
  "AI年龄建议理由": ["AI family-age review"],
  "人工年龄覆盖": ["manual review"],
  "Media Availability": ["manual media operations"],
  "Hide from Website": ["manual emergency control"],
  "Developer Memo": ["manual media operations"]
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseArgs(): AuditOptions {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) {
      return inline.slice(prefix.length);
    }
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };

  return {
    limit: Math.max(1, Math.floor(Number(value("--limit", "100")))),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(value("--page-size", "50"))))),
    query: value("--query", "").trim() || undefined,
    pageId: extractNotionId(value("--page-id", "") || value("--page-url", "")) ?? undefined,
    reportPath: value("--report", "").trim() || undefined,
    dataSourceId: extractNotionId(value("--data-source-id", "")) ?? undefined,
    databaseId: extractNotionId(value("--database-id", "")) ?? undefined,
    rootPageId: extractNotionId(value("--root-page-id", "")) ?? undefined
  };
}

function extractNotionId(value: string) {
  const compact = value.match(/([0-9a-f]{32})/i)?.[1];
  if (compact) {
    return [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20)
    ].join("-");
  }

  return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

function richTextPlain(value: unknown) {
  return asArray(value)
    .map((item) => asString(asRecord(item)?.plain_text))
    .filter(Boolean)
    .join("");
}

function propertyText(value: unknown) {
  const property = asRecord(value);
  if (!property) {
    return "";
  }

  const type = asString(property.type);
  if (type === "title" || type === "rich_text") {
    return richTextPlain(property[type]);
  }
  if (type === "url") {
    return asString(property.url);
  }
  if (type === "number") {
    return typeof property.number === "number" ? `${property.number}` : "";
  }
  if (type === "date") {
    return asString(asRecord(property.date)?.start);
  }
  if (type === "checkbox") {
    return typeof property.checkbox === "boolean" ? String(property.checkbox) : "";
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

  return "";
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = richTextPlain(record.title);
      if (title) {
        return title;
      }
    }
  }
  return "Untitled Notion page";
}

async function loadLibrary(notion: Client, options: AuditOptions): Promise<LibraryMetadata> {
  if (options.dataSourceId ?? configuredDataSourceId) {
    return loadDataSource(notion, (options.dataSourceId ?? configuredDataSourceId)!);
  }

  const databaseId = options.databaseId ?? configuredDatabaseId;
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSources = asArray(asRecord(database)?.data_sources);
    const dataSourceId = asString(asRecord(dataSources[0])?.id) || databaseId;
    return loadDataSource(notion, dataSourceId);
  }

  const libraryRootPageId = options.rootPageId ?? rootPageId;
  if (!libraryRootPageId) {
    throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID, NOTION_LIBRARY_DATABASE_ID, or NOTION_LIBRARY_ROOT_PAGE_ID.");
  }

  const response = await notion.blocks.children.list({ block_id: libraryRootPageId, page_size: 100 });
  const databases = response.results.filter((block) => asRecord(block)?.type === "child_database");
  if (databases.length !== 1) {
    throw new Error("Library root page must have exactly one direct child database, or configure NOTION_LIBRARY_DATABASE_ID.");
  }

  const childDatabaseId = asString(asRecord(databases[0])?.id);
  const database = await notion.databases.retrieve({ database_id: childDatabaseId });
  const dataSources = asArray(asRecord(database)?.data_sources);
  const dataSourceId = asString(asRecord(dataSources[0])?.id) || childDatabaseId;
  return loadDataSource(notion, dataSourceId);
}

async function loadDataSource(notion: Client, dataSourceId: string): Promise<LibraryMetadata> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = asRecord(asRecord(dataSource)?.properties) ?? {};
  const titleProperty = Object.entries(properties)
    .find(([, property]) => asRecord(property)?.type === "title")?.[0];
  return { dataSourceId, titleProperty, properties };
}

async function queryPages(notion: Client, library: LibraryMetadata, options: AuditOptions) {
  if (options.pageId) {
    return [await notion.pages.retrieve({ page_id: options.pageId }) as JsonRecord];
  }

  const pages: JsonRecord[] = [];
  let startCursor: string | undefined;
  do {
    const request: JsonRecord = {
      data_source_id: library.dataSourceId,
      page_size: Math.min(options.pageSize, options.limit - pages.length),
      start_cursor: startCursor,
      result_type: "page",
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }]
    };

    if (options.query && library.titleProperty) {
      request.filter = {
        property: library.titleProperty,
        title: { contains: options.query }
      };
    }

    const response = await notion.dataSources.query(request as never);
    pages.push(...response.results.map((page) => asRecord(page)).filter((page): page is JsonRecord => Boolean(page)));
    startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (startCursor && pages.length < options.limit);

  return pages.slice(0, options.limit);
}

function auditPage(page: JsonRecord): PageAudit {
  const properties = asRecord(page.properties) ?? {};
  const presentFields = auditFields.filter((field) => propertyText(properties[field]));
  const missingFields = auditFields.filter((field) => !presentFields.includes(field));
  const imdb = normalizeImdbId(propertyText(properties["IMDb ID"]) || propertyText(properties["IMDb"]));
  return {
    pageId: asString(page.id),
    title: titleFromProperties(properties),
    url: asString(page.url) || undefined,
    imdb,
    presentFields,
    missingFields
  };
}

function summarize(pages: PageAudit[]) {
  const fieldCoverage = auditFields.map((field) => {
    const present = pages.filter((page) => page.presentFields.includes(field)).length;
    const missing = pages.length - present;
    return {
      field,
      present,
      missing,
      coverage: pages.length === 0 ? 0 : Number((present / pages.length).toFixed(4)),
      recommendedSources: sourceStrategy[field] ?? []
    };
  });

  const missingByField = Object.fromEntries(auditFields.map((field) => [
    field,
    pages
      .filter((page) => page.missingFields.includes(field))
      .slice(0, 12)
      .map((page) => ({ title: page.title, pageId: page.pageId, url: page.url, imdb: page.imdb }))
  ]));

  const omdbCandidateFields = new Set([
    "English Title",
    "Release Year",
    "Release Date",
    "Countries",
    "Languages",
    "Genres",
    "Runtime Minutes",
    "Directors",
    "Writers",
    "Cast",
    "分级",
    "Poster URL",
    "Box Office",
    "Box Office Amount",
    "Box Office Currency",
    "AI建议最低年龄",
    "AI年龄建议置信度",
    "内容风险标签",
    "AI年龄建议理由"
  ]);
  const tmdbCandidateFields = new Set([
    "TMDB ID",
    "Original Title",
    "Chinese Title",
    "Simplified Chinese Title",
    "Traditional Chinese Title (Taiwan)",
    "Traditional Chinese Title (Hong Kong)",
    "Release Date",
    "Countries",
    "Languages",
    "Genres",
    "Runtime Minutes",
    "Directors",
    "Writers",
    "Cast",
    "Poster URL"
  ]);
  const doubanCandidateFields = new Set([
    "Douban Subject ID",
    "Chinese Title",
    "Simplified Chinese Title",
    "Original Title",
    "Release Date",
    "Countries",
    "Languages",
    "Genres",
    "Runtime Minutes",
    "Directors",
    "Cast",
    "Poster URL"
  ]);

  return {
    totalPages: pages.length,
    pagesWithImdb: pages.filter((page) => page.imdb).length,
    pagesMissingImdb: pages.filter((page) => !page.imdb).length,
    fieldCoverage,
    sourceBuckets: {
      omdbReady: pages.filter((page) => page.imdb && page.missingFields.some((field) => omdbCandidateFields.has(field))).length,
      needsTmdb: pages.filter((page) => page.missingFields.some((field) => tmdbCandidateFields.has(field))).length,
      needsDouban: pages.filter((page) => page.missingFields.some((field) => doubanCandidateFields.has(field))).length,
      needsIdentityWork: pages.filter((page) => !page.imdb || page.missingFields.includes("Douban Subject ID") || page.missingFields.includes("TMDB ID")).length
    },
    missingByField,
    pages: pages.map((page) => ({
      title: page.title,
      pageId: page.pageId,
      url: page.url,
      imdb: page.imdb,
      missingFields: page.missingFields
    }))
  };
}

async function main() {
  const options = parseArgs();
  const notionToken = process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!notionToken) {
    throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");
  }

  const notion = new Client({ auth: notionToken, timeoutMs: notionRequestTimeoutMs });
  const library = await loadLibrary(notion, options);
  const missingSchema = notionManagedProperties
    .map((property) => property.name)
    .filter((name) => !library.properties[name]);
  if (missingSchema.length > 0) {
    throw new Error(`Missing Notion managed schema fields: ${missingSchema.join(", ")}.`);
  }

  const pages = (await queryPages(notion, library, options)).map(auditPage);
  const report = {
    generatedAt: new Date().toISOString(),
    dataSourceId: library.dataSourceId,
    limit: options.limit,
    ...summarize(pages)
  };

  if (options.reportPath) {
    const reportPath = path.isAbsolute(options.reportPath)
      ? options.reportPath
      : path.resolve(repoRoot, options.reportPath);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
