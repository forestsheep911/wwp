import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

const DEFAULT_DELAY_MS = 3000;
const DEFAULT_PAGE_SIZE = 100;
const PROGRESS_PATH = ".local-data/notion-description-refresh-progress.jsonl";
const REPORT_PATH = ".local-data/notion-description-refresh-report.json";
const DOUBAN_COOKIE_PATH = ".douban.cookie";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 50,
    delayMs: DEFAULT_DELAY_MS,
    pageSize: DEFAULT_PAGE_SIZE,
    dryRun: false,
    forceProcessed: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force-processed") {
      options.forceProcessed = true;
    } else if (arg === "--limit") {
      options.limit = Number(args[++index]);
    } else if (arg === "--delay-ms") {
      options.delayMs = Number(args[++index]);
    } else if (arg === "--page-size") {
      options.pageSize = Number(args[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function dotenv(name) {
  const raw = fs.readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match?.[1] === name) {
      return match[2].trim();
    }
  }
  return process.env[name];
}

function ensureLocalData() {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
}

function readProcessed() {
  if (!fs.existsSync(PROGRESS_PATH)) {
    return new Set();
  }
  return new Set(
    fs
      .readFileSync(PROGRESS_PATH, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).pageId)
  );
}

function appendProgress(record) {
  fs.appendFileSync(PROGRESS_PATH, `${JSON.stringify(record)}\n`);
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("");
}

function propText(property) {
  if (!property) {
    return "";
  }
  if (property.type === "title") {
    return plainText(property.title);
  }
  if (property.type === "rich_text") {
    return plainText(property.rich_text);
  }
  if (property.type === "number") {
    return property.number === null ? "" : `${property.number}`;
  }
  if (property.type === "date") {
    return property.date?.start ?? "";
  }
  if (property.type === "multi_select") {
    return property.multi_select.map((item) => item.name).join(" ");
  }
  if (property.type === "select") {
    return property.select?.name ?? "";
  }
  if (property.type === "formula") {
    return property.formula?.string ?? (property.formula?.number === null ? "" : `${property.formula?.number ?? ""}`);
  }
  return "";
}

function richText(content) {
  const chunks = `${content ?? ""}`.match(/[\s\S]{1,1900}/g) ?? [""];
  return chunks.map((chunk) => ({
    type: "text",
    text: {
      content: chunk
    }
  }));
}

function looksTruncated(value) {
  return /(?:\.{3}|…)$/u.test(`${value ?? ""}`.trim());
}

function bestDescription(jsonLdDescription, summary) {
  const ldDescription = `${jsonLdDescription ?? ""}`.trim();
  const pageSummary = `${summary ?? ""}`.trim();
  if (looksTruncated(ldDescription) && pageSummary.length > ldDescription.length) {
    return pageSummary;
  }
  return ldDescription || pageSummary;
}

function cleanTitle(title) {
  return title
    .replace(/^【(?:敬请期待|仅供下载)】\s*/, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleWithoutYear(title) {
  return cleanTitle(title)
    .replace(/\s*[\(（]\d{4}[\)）]\s*$/, "")
    .replace(/\s+\d{4}$/, "")
    .trim();
}

function titleYear(title) {
  return cleanTitle(title).match(/[\(（](\d{4})[\)）]\s*$/)?.[1] ?? cleanTitle(title).match(/\s+(\d{4})$/)?.[1];
}

function chineseNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (number <= 10) {
    return numerals[number];
  }
  if (number < 20) {
    return `十${numerals[number - 10]}`;
  }
  return `${number}`;
}

function seasonNumber(title) {
  const cleaned = cleanTitle(title);
  return (
    cleaned.match(/\bs0?(\d+)\b/i)?.[1] ??
    cleaned.match(/\bseason\s*(\d+)\b/i)?.[1] ??
    cleaned.match(/\bbig\s*bang\s+(\d+)\b/i)?.[1] ??
    cleaned.match(/\bhouse\s+s?0?(\d+)\b/i)?.[1] ??
    cleaned.match(/第(\d+)季/)?.[1]
  );
}

function normalizedSeasonLabel(title) {
  const number = seasonNumber(title);
  return number ? `第${chineseNumber(number)}季` : "";
}

function seasonSearchTitle(title) {
  const label = normalizedSeasonLabel(title);
  if (!label) {
    return "";
  }
  if (/\bbig\s*bang\b/i.test(title)) {
    return `生活大爆炸 ${label}`;
  }
  if (/\bhouse\b/i.test(title)) {
    return `豪斯医生 ${label}`;
  }
  return titleWithoutYear(title)
    .replace(/\bs0?\d+\b/i, label)
    .replace(/\bseason\s*\d+\b/i, label)
    .replace(/第\d+季/, label)
    .trim();
}

function titleSearchVariants(title) {
  const full = cleanTitle(title);
  const withoutYear = titleWithoutYear(title);
  const seasonTitle = seasonSearchTitle(title);
  const firstSpacedSegment = withoutYear.split(/\s+/)[0];
  const beforeColonTail = withoutYear.includes("：") ? withoutYear.split("：").at(-1) : "";
  const variants = normalizedSeasonLabel(title)
    ? [seasonTitle, full, withoutYear]
    : [full, withoutYear, firstSpacedSegment, beforeColonTail];
  return [...new Set(variants.filter((item) => item && /[\u3400-\u9fffA-Za-z0-9]/.test(item)))];
}

function titleKey(title) {
  return cleanTitle(title)
    .toLowerCase()
    .replace(/[【】《》\[\]().,，。:：!！?？'"“”‘’\s_-]/g, "");
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function cookieHeader() {
  if (!fs.existsSync(DOUBAN_COOKIE_PATH)) {
    return "";
  }
  const raw = fs.readFileSync(DOUBAN_COOKIE_PATH, "utf8").trim();
  try {
    return JSON.parse(raw)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch {
    return raw;
  }
}

async function fetchText(url, headers = {}, timeoutMs = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...headers
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 120)}`);
  }
  return text;
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function fetchDoubanSuggestions(query, cookie) {
  return fetchJson(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, {
    Cookie: cookie,
    Referer: "https://movie.douban.com/"
  });
}

async function findDoubanSubject(title, existingInfo, expectedType, cookie) {
  const query = cleanTitle(title);
  const queryWithoutYear = titleWithoutYear(title);
  const year = titleYear(title);
  const seasonLabel = normalizedSeasonLabel(title);
  const seasonTitle = seasonSearchTitle(title);
  const queryVariants = titleSearchVariants(title);
  let suggestions = [];
  for (const variant of queryVariants) {
    suggestions = await fetchDoubanSuggestions(variant, cookie);
    if (suggestions.length > 0) {
      break;
    }
  }

  const expected = titleKey(seasonTitle || queryWithoutYear || query);
  const info = titleKey(existingInfo);
  let movieSuggestions = suggestions.filter((item) => item.id && item.type === "movie");
  if (/^Movie$/i.test(expectedType)) {
    const featureCandidates = movieSuggestions.filter((item) => !item.episode);
    if (featureCandidates.length > 0) {
      movieSuggestions = featureCandidates;
    }
  }

  if (seasonLabel) {
    const seasonKey = titleKey(seasonLabel);
    movieSuggestions = movieSuggestions.filter((item) => {
      const combined = titleKey(`${item.title ?? ""} ${item.sub_title ?? ""}`);
      return combined.includes(seasonKey);
    });
  }

  const exact = movieSuggestions.filter((item) => titleKey(item.title) === expected);
  let candidates = exact.length > 0
    ? exact
    : movieSuggestions.filter((item) => {
      const suggestionTitle = titleKey(item.title);
      return expected.includes(suggestionTitle) || suggestionTitle.includes(expected);
    });

  if (year) {
    const yearMatched = candidates.filter((item) => `${item.year ?? ""}` === year);
    if (yearMatched.length === 1) {
      return { status: "ok", subject: yearMatched[0] };
    }
    if (yearMatched.length > 1) {
      candidates = yearMatched;
    }
  }

  if (candidates.length === 0) {
    return { status: "skipped", reason: "no_douban_candidate", suggestions: movieSuggestions.slice(0, 5) };
  }

  if (candidates.length > 1 && /^Movie$/i.test(expectedType)) {
    const featureCandidates = candidates.filter((item) => !item.episode);
    if (featureCandidates.length === 1) {
      return { status: "ok", subject: featureCandidates[0] };
    }
  }

  if (candidates.length > 1 && info) {
    const infoMatched = candidates.filter((item) => info.includes(titleKey(item.year ?? "")) || info.includes(titleKey(item.sub_title ?? "")));
    if (infoMatched.length === 1) {
      return { status: "ok", subject: infoMatched[0] };
    }
  }

  if (candidates.length > 1) {
    return {
      status: "skipped",
      reason: "ambiguous_douban_candidate",
      suggestions: candidates.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        year: item.year,
        subTitle: item.sub_title
      }))
    };
  }

  return { status: "ok", subject: candidates[0] };
}

function parseJsonLd(html) {
  const raw = html
    .match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    ?.replace(/\n/g, "")
    .replace(/\t/g, "")
    .trim();
  if (!raw) {
    throw new Error("Douban JSON-LD not found");
  }
  return JSON.parse(raw);
}

async function fetchDoubanDescription(subjectId, cookie) {
  const url = `https://movie.douban.com/subject/${subjectId}/`;
  const html = await fetchText(url, {
    Cookie: cookie,
    Referer: "https://movie.douban.com/"
  });
  if (/检测到有异常请求|captcha|安全验证|name="sec"|载入中/i.test(html)) {
    throw new Error("Douban returned a security challenge");
  }

  const ld = parseJsonLd(html);
  const summary = stripHtml(html.match(/<span property="v:summary"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  return {
    subjectId,
    subjectUrl: url,
    description: bestDescription(ld.description, summary)
  };
}

async function loadLibrary(notion) {
  const configuredDataSourceId = dotenv("NOTION_LIBRARY_DATA_SOURCE_ID") || process.env.NOTION_LIBRARY_DATA_SOURCE_ID;
  if (configuredDataSourceId) {
    const dataSource = await notion.dataSources.retrieve({ data_source_id: configuredDataSourceId });
    return { dataSourceId: configuredDataSourceId, title: dataSource.name?.[0]?.plain_text ?? configuredDataSourceId };
  }

  const configuredDatabaseId = dotenv("NOTION_LIBRARY_DATABASE_ID") || process.env.NOTION_LIBRARY_DATABASE_ID;
  if (configuredDatabaseId) {
    const database = await notion.databases.retrieve({ database_id: configuredDatabaseId });
    return {
      dataSourceId: database.data_sources?.[0]?.id ?? configuredDatabaseId,
      title: database.title?.map((item) => item.plain_text ?? "").join("") || configuredDatabaseId
    };
  }

  const rootPageId = dotenv("NOTION_LIBRARY_ROOT_PAGE_ID") || process.env.NOTION_LIBRARY_ROOT_PAGE_ID;
  if (!rootPageId) {
    throw new Error("NOTION_LIBRARY_ROOT_PAGE_ID or NOTION_LIBRARY_DATA_SOURCE_ID is required.");
  }

  const response = await notion.blocks.children.list({ block_id: rootPageId, page_size: 100 });
  const databases = response.results.filter((block) => block.type === "child_database");
  if (databases.length !== 1) {
    throw new Error(`Expected one child database under NOTION_LIBRARY_ROOT_PAGE_ID, found ${databases.length}.`);
  }

  const database = await notion.databases.retrieve({ database_id: databases[0].id });
  return {
    dataSourceId: database.data_sources?.[0]?.id ?? databases[0].id,
    title: database.title?.map((item) => item.plain_text ?? "").join("") || databases[0].id
  };
}

async function collectPages(notion, library, pageSize) {
  const pages = [];
  let startCursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: library.dataSourceId,
      page_size: Math.min(100, pageSize),
      start_cursor: startCursor,
      result_type: "page",
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending"
        }
      ]
    });
    pages.push(...response.results);
    startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (startCursor);
  return pages;
}

function titleProperty(properties) {
  return Object.values(properties).find((property) => property?.type === "title");
}

function descriptionEntry(properties) {
  return Object.entries(properties).find(([name]) => /简介|summary|description|synopsis|plot/i.test(name));
}

function needsDescriptionRefresh(page) {
  const entry = descriptionEntry(page.properties ?? {});
  const description = entry ? propText(entry[1]) : "";
  return !description || looksTruncated(description);
}

async function processPage(notion, page, options, cookie) {
  const properties = page.properties ?? {};
  const title = propText(titleProperty(properties));
  const currentDescription = propText(descriptionEntry(properties)?.[1]);
  const existingInfo = [propText(properties["基本信息"]), propText(properties.note)].join(" ");
  const expectedType = propText(properties["影别"]);
  const subjectResult = await findDoubanSubject(title, existingInfo, expectedType, cookie);

  if (subjectResult.status !== "ok") {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: subjectResult.reason,
      suggestions: subjectResult.suggestions
    };
  }

  await sleep(options.delayMs);
  const metadata = await fetchDoubanDescription(subjectResult.subject.id, cookie);
  const nextDescription = metadata.description;
  if (!nextDescription) {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: "empty_douban_description",
      subjectId: metadata.subjectId
    };
  }

  if (currentDescription && nextDescription.length <= currentDescription.length) {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: "current_description_long_enough",
      subjectId: metadata.subjectId,
      currentLength: currentDescription.length,
      nextLength: nextDescription.length
    };
  }

  if (!options.dryRun) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        "简介": {
          rich_text: richText(nextDescription)
        }
      }
    });
  }

  return {
    pageId: page.id,
    title,
    status: options.dryRun ? "dry_run" : "updated",
    subjectId: metadata.subjectId,
    currentLength: currentDescription.length,
    nextLength: nextDescription.length,
    currentTail: currentDescription.slice(-80),
    nextTail: nextDescription.slice(-80)
  };
}

async function main() {
  ensureLocalData();
  const options = parseArgs();
  const notion = new Client({ auth: dotenv("NOTION_TOKEN") });
  const cookie = cookieHeader();
  const processed = options.forceProcessed ? new Set() : readProcessed();
  const library = await loadLibrary(notion);
  const allPages = await collectPages(notion, library, options.pageSize);
  const candidates = allPages
    .filter(needsDescriptionRefresh)
    .filter((page) => !processed.has(page.id));
  const selected = candidates.slice(0, options.limit);
  const report = {
    startedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    library,
    totalPages: allPages.length,
    totalCandidates: candidates.length,
    selected: selected.length,
    records: []
  };

  console.log(`Loaded ${allPages.length} pages from ${library.title}; ${candidates.length} need description refresh; processing ${selected.length}.`);

  for (const page of selected) {
    const startedAt = Date.now();
    try {
      const record = await processPage(notion, page, options, cookie);
      record.elapsedMs = Date.now() - startedAt;
      report.records.push(record);
      if (!options.dryRun) {
        appendProgress({ ...record, recordedAt: new Date().toISOString() });
      }
      console.log(JSON.stringify(record));
    } catch (error) {
      const record = {
        pageId: page.id,
        title: propText(titleProperty(page.properties ?? {})),
        status: "error",
        message: error.message,
        elapsedMs: Date.now() - startedAt
      };
      report.records.push(record);
      if (!options.dryRun) {
        appendProgress({ ...record, recordedAt: new Date().toISOString() });
      }
      console.error(JSON.stringify(record));
      if (/security challenge|HTTP 403|HTTP 429|Too Many Requests/i.test(error.message)) {
        console.error("Stopping because Douban appears to be rate-limiting or challenging the session.");
        break;
      }
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
