import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

const VIEW_ID = "22920ac1-2f0a-801d-bcf4-000cc6950264";
const DEFAULT_DELAY_MS = 6000;
const DEFAULT_PAGE_SIZE = 25;
const PROGRESS_PATH = ".local-data/notion-metadata-backfill-progress.jsonl";
const REPORT_PATH = ".local-data/notion-metadata-backfill-report.json";
const DOUBAN_COOKIE_PATH = ".douban.cookie";

const genreOptions = new Set([
  "剧情",
  "冒险",
  "动作",
  "犯罪",
  "惊悚",
  "喜剧",
  "科幻",
  "动画",
  "浪漫",
  "武侠",
  "古装",
  "悬疑",
  "奇幻",
  "家庭",
  "战争",
  "传记",
  "历史",
  "恐怖",
  "记录",
  "音乐",
  "运动",
  "西部",
  "短片",
  "歌舞",
  "黑色",
  "灾难",
  "真人秀",
  "成人",
  "游戏节目",
  "新闻",
  "脱口秀"
]);

const genreAliases = new Map([
  ["爱情", "浪漫"]
]);

const ratingLevelOptions = new Set([
  "G",
  "PG",
  "PG-13",
  "R",
  "TV-MA",
  "X",
  "(Banned)",
  "未分级",
  "Approved",
  "TV-Y",
  "TV-Y7",
  "TV-G",
  "TV-PG",
  "TV-14",
  "Passed",
  "NC-17",
  "DE:16",
  "DE:18",
  "KR:15",
  "GB:PG",
  "GB:12A",
  "GB:15",
  "GB:18",
  "JP:G",
  "IT:T",
  "JP:R18+",
  "JP:PG-12",
  "18+"
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    pageIds: [],
    doubanSubjects: new Map(),
    limit: Infinity,
    delayMs: DEFAULT_DELAY_MS,
    pageSize: DEFAULT_PAGE_SIZE,
    imdbTimeoutMs: 4000,
    dryRun: false,
    noExternal: false,
    forceProcessed: false,
    forcePoster: false,
    forceDoubanFields: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") {
      options.pageIds.push(args[++index]);
    } else if (arg === "--douban-subject") {
      const [pageId, subjectId] = `${args[++index] ?? ""}`.split("=", 2);
      if (!pageId || !subjectId) throw new Error("--douban-subject expects pageId=subjectId.");
      options.doubanSubjects.set(pageId, subjectId);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-external") {
      options.noExternal = true;
    } else if (arg === "--force-processed") {
      options.forceProcessed = true;
    } else if (arg === "--force-poster") {
      options.forcePoster = true;
    } else if (arg === "--force-douban-fields") {
      options.forceDoubanFields = true;
    } else if (arg === "--limit") {
      options.limit = Number(args[++index]);
    } else if (arg === "--delay-ms") {
      options.delayMs = Number(args[++index]);
    } else if (arg === "--page-size") {
      options.pageSize = Number(args[++index]);
    } else if (arg === "--imdb-timeout-ms") {
      options.imdbTimeoutMs = Number(args[++index]);
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

function installNotionDnsOverride() {
  const notionApiIp = dotenv("NOTION_API_RESOLVE_IP");
  if (!notionApiIp) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, notionApiIp, 4);
      if (options?.all) return callback(null, [{ address: notionApiIp, family: 4 }]);
      return callback(null, notionApiIp, 4);
    }
    return originalLookup(hostname, options, callback);
  };
  console.log(`dns override: api.notion.com -> ${notionApiIp}`);
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

function richText(content, href) {
  const chunks = `${content ?? ""}`.match(/[\s\S]{1,1900}/g) ?? [""];
  return chunks.map((chunk) => (
    {
      type: "text",
      text: {
        content: chunk,
        ...(href ? { link: { url: href } } : {})
      }
    }
  ));
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
  if (property.type === "files") {
    return property.files.length > 0 ? "files" : "";
  }
  if (property.type === "url") {
    return property.url ?? "";
  }
  if (property.type === "checkbox") {
    return property.checkbox ? "true" : "";
  }
  return "";
}

function hasValue(properties, name) {
  return Boolean(propText(properties[name]));
}

function numericPropertyValue(property) {
  return property?.type === "number" && Number.isFinite(property.number) ? property.number : undefined;
}

function propertyExists(properties, name) {
  return Object.prototype.hasOwnProperty.call(properties, name);
}

function uniqueNonEmpty(values = []) {
  const result = [];
  for (const value of values) {
    const cleaned = `${value ?? ""}`.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned && !result.includes(cleaned)) {
      result.push(cleaned);
    }
  }
  return result;
}

function splitListValue(value, limit = Infinity) {
  return uniqueNonEmpty(`${value ?? ""}`.split(/\s*(?:\/|,|，)\s*/u)).slice(0, limit);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function parseRuntimeMinutes(value) {
  const match = `${value ?? ""}`.match(/(\d{2,4})\s*(?:分钟|分鐘|min|m\b)/iu);
  if (!match) {
    return undefined;
  }
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

function releaseYearFromText(value) {
  const match = `${value ?? ""}`.match(/\b(18|19|20)\d{2}\b/u);
  return match ? Number(match[0]) : undefined;
}

function multiSelect(values = []) {
  const names = uniqueNonEmpty(values);
  return names.length ? { multi_select: names.map((name) => ({ name })) } : undefined;
}

function select(name) {
  return name ? { select: { name } } : undefined;
}

function currentMultiSelectNames(property) {
  return property?.type === "multi_select" ? property.multi_select.map((item) => item.name).filter(Boolean) : [];
}

function combinedMultiSelect(property, values = []) {
  return multiSelect([...currentMultiSelectNames(property), ...values]);
}

function richTextValue(value) {
  const cleaned = `${value ?? ""}`.trim();
  return cleaned ? { rich_text: richText(cleaned) } : undefined;
}

function joinList(values = []) {
  return uniqueNonEmpty(values).join(" / ");
}

function mapGenres(genres = []) {
  const raw = uniqueNonEmpty(genres);
  const canonical = uniqueNonEmpty(raw.map((genre) => genreAliases.get(genre) ?? genre).filter((genre) => genreOptions.has(genre)));
  const unmapped = raw.filter((genre) => !genreOptions.has(genre) && !genreAliases.has(genre));
  return { raw, canonical, unmapped };
}

function extractRegionalTitles(aliasText) {
  const titles = {};
  for (const alias of splitListValue(aliasText)) {
    const match = alias.match(/^(.*?)\s*[\(（]\s*([^()（）]+?)\s*[\)）]\s*$/u);
    if (!match) continue;
    const title = match[1].trim();
    const region = match[2].trim();
    if (!title) continue;
    if (/^(?:台|臺|台湾|臺灣)$/u.test(region) && !titles.taiwan) {
      titles.taiwan = title;
    }
    if (/^(?:港|香港)$/u.test(region) && !titles.hongKong) {
      titles.hongKong = title;
    }
  }
  return titles;
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
  return decodeHtmlEntities(title)
    .replace(/^(?:【敬请期待】|【仅供下载】)\s*/, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function canonicalTitleFromStructuredIdentity(properties, metadata = {}) {
  const hasIdentityEvidence = Boolean(
    metadata.subjectId ||
    metadata.imdbId ||
    propText(properties["Douban Subject ID"]) ||
    propText(properties["IMDb ID"]) ||
    propText(properties.imdb) ||
    propText(properties["TMDB ID"])
  );
  if (!hasIdentityEvidence) return undefined;

  // A verified Douban display title is authoritative. Keep a separately
  // structured foreign/original title when present, but never use a source
  // subtitle or AKA as the primary Chinese title.
  const doubanDisplayTitle = cleanTitle(metadata.doubanDisplayTitle ?? "");
  const year = propText(properties["Release Year"]) || `${metadata.releaseYear ?? ""}`;
  if (metadata.subjectId && doubanDisplayTitle && /^\d{4}$/.test(year)) {
    const chineseTitle = titleWithoutMatchingReleaseYear(doubanDisplayTitle, year);
    const foreignTitle = cleanTitle(
      propText(properties["English Title"]) || propText(properties["Original Title"])
    );
    const parts = [chineseTitle];
    const doubanHasLatinTitle = /[A-Za-z]/u.test(chineseTitle);
    const doubanHasOriginalScript = /[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/u.test(chineseTitle);
    const foreignIsLatinTitle = /[A-Za-z]/u.test(foreignTitle);
    if (foreignTitle && foreignIsLatinTitle && !doubanHasLatinTitle && !doubanHasOriginalScript && titleKey(chineseTitle) !== titleKey(foreignTitle)) {
      parts.push(foreignTitle);
    }
    return `${parts.join(" ")} (${year})`;
  }

  const chineseTitle = cleanTitle(
    propText(properties["Simplified Chinese Title"]) || propText(properties["Chinese Title"])
  );
  const foreignTitle = cleanTitle(
    propText(properties["English Title"]) || propText(properties["Original Title"])
  );
  if (!chineseTitle || !foreignTitle || !/^\d{4}$/.test(year)) return undefined;

  const parts = [chineseTitle];
  if (titleKey(chineseTitle) !== titleKey(foreignTitle)) parts.push(foreignTitle);
  return `${parts.join(" ")} (${year})`;
}

function canSafelyCompleteStructuredTitle(currentTitle, properties, metadata = {}) {
  const currentKey = titleKey(currentTitle);
  const chineseTitle = propText(properties["Simplified Chinese Title"]) || propText(properties["Chinese Title"]);
  const foreignTitle = propText(properties["English Title"]) || propText(properties["Original Title"]);
  const year = propText(properties["Release Year"]) || `${metadata.releaseYear ?? ""}`;
  if (!chineseTitle || !foreignTitle || !/^\d{4}$/.test(year)) return false;
  const containsChinese = currentKey.includes(titleKey(chineseTitle));
  const containsForeign = currentKey.includes(titleKey(foreignTitle));
  const currentYear = titleYear(currentTitle);
  return (containsChinese || containsForeign) && (!currentYear || currentYear === year);
}

function titleWithoutYear(title) {
  return cleanTitle(title)
    .replace(/\s*[\(（]\d{4}[\)）]\s*$/, "")
    .replace(/\s+\d{4}$/, "")
    .trim();
}

function titleWithoutMatchingReleaseYear(title, releaseYear) {
  const cleaned = cleanTitle(title);
  const year = `${releaseYear ?? ""}`.match(/^\d{4}$/)?.[0];
  if (!year) return titleWithoutYear(cleaned);
  return cleaned
    .replace(new RegExp(`\\s*[\\(（]${year}[\\)）]\\s*$`), "")
    .replace(new RegExp(`\\s+${year}$`), "")
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
  const chineseSeason = cleaned.match(/第([零一二三四五六七八九十]+)季/u)?.[1];
  const chineseSeasonNumber = chineseSeason
    ? ({ 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[chineseSeason] ?? undefined)
    : undefined;
  return (
    cleaned.match(/\bs0?(\d+)\b/i)?.[1] ??
    cleaned.match(/\bseason\s*(\d+)\b/i)?.[1] ??
    cleaned.match(/\bbig\s*bang\s+(\d+)\b/i)?.[1] ??
    cleaned.match(/\bhouse\s+s?0?(\d+)\b/i)?.[1] ??
    cleaned.match(/第(\d+)季/u)?.[1] ??
    chineseSeasonNumber?.toString()
  );
}

function normalizedSeasonLabel(title) {
  const number = seasonNumber(title);
  return number ? `第${chineseNumber(number)}季` : "";
}

function preserveSeasonIdentity(currentTitle, canonicalTitle) {
  if (!canonicalTitle) return canonicalTitle;
  const number = seasonNumber(currentTitle);
  if (!number || seasonNumber(canonicalTitle)) return canonicalTitle;
  const year = titleYear(canonicalTitle);
  const base = titleWithoutYear(canonicalTitle);
  const chineseLabel = `第${chineseNumber(number)}季`;
  const foreignStart = base.search(/\s+(?=[A-Za-z\u3040-\u30ff])/u);
  const decorated = foreignStart >= 0
    ? `${base.slice(0, foreignStart)} ${chineseLabel}${base.slice(foreignStart)}`
    : `${base} ${chineseLabel}`;
  return year ? `${decorated} (${year})` : decorated;
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
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
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

function firstCookie(setCookie) {
  return setCookie?.split(";")[0] ?? "";
}

function solveSha512Prefix(challenge, difficulty = 4) {
  const target = "0".repeat(difficulty);
  for (let nonce = 1; ; nonce += 1) {
    const hash = crypto.createHash("sha512").update(`${challenge}${nonce}`).digest("hex");
    if (hash.startsWith(target)) return nonce;
  }
}

async function fetchDoubanSubjectHtml(url, headers = {}) {
  const baseHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://movie.douban.com/",
    ...headers
  };

  let cookie = "";
  let response = await fetch(url, {
    redirect: "manual",
    headers: baseHeaders
  });
  cookie = firstCookie(response.headers.get("set-cookie"));
  let html = await response.text();

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    response = await fetch(location, {
      redirect: "manual",
      headers: {
        ...baseHeaders,
        Cookie: cookie,
        Referer: url
      }
    });
    html = await response.text();
  }

  const token = html.match(/name="tok" value="([^"]+)"/)?.[1];
  const challenge = html.match(/name="cha" value="([^"]+)"/)?.[1];
  const redirectUrl = html.match(/name="red" value="([^"]+)"/)?.[1];
  if (!token || !challenge || !redirectUrl) {
    return html;
  }

  const form = new URLSearchParams({
    tok: token,
    cha: challenge,
    sol: `${solveSha512Prefix(challenge)}`,
    red: redirectUrl
  });
  const challengeResponse = await fetch("https://sec.douban.com/c", {
    method: "POST",
    redirect: "manual",
    headers: {
      ...baseHeaders,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: response.url
    },
    body: form
  });
  cookie = [cookie, firstCookie(challengeResponse.headers.get("set-cookie"))].filter(Boolean).join("; ");

  const finalResponse = await fetch(redirectUrl, {
    headers: {
      ...baseHeaders,
      Cookie: cookie,
      Referer: "https://sec.douban.com/"
    }
  });
  return finalResponse.text();
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

export function candidateYearConflict(expectedYear, candidates = []) {
  const expected = `${expectedYear ?? ""}`.match(/\d{4}/)?.[0];
  if (!expected) return false;
  const candidateYears = candidates
    .map((candidate) => `${candidate?.year ?? ""}`.match(/\d{4}/)?.[0])
    .filter(Boolean);
  return candidateYears.length > 0 && !candidateYears.includes(expected);
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
    if (yearMatched.length === 0 && candidateYearConflict(year, candidates)) {
      return {
        status: "skipped",
        reason: "douban_year_mismatch",
        suggestions: candidates.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          year: item.year,
          subTitle: item.sub_title
        }))
      };
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

  if (candidates.length > 1 && !info) {
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

  if (candidates.length > 1 && info) {
    const infoMatched = candidates.filter((item) => info.includes(titleKey(item.year ?? "")) || info.includes(titleKey(item.sub_title ?? "")));
    if (infoMatched.length === 1) {
      return { status: "ok", subject: infoMatched[0] };
    }
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

export function metadataIdentityConflict(properties = {}, metadata = {}, context = {}) {
  const existingImdbId = (propText(properties["IMDb ID"]) || propText(properties.imdb)).match(/tt\d+/i)?.[0]?.toLowerCase();
  const metadataImdbId = `${metadata.imdbId ?? ""}`.match(/tt\d+/i)?.[0]?.toLowerCase();
  if (existingImdbId && metadataImdbId && existingImdbId !== metadataImdbId) {
    // Douban season pages occasionally expose one episode's IMDb ID. Once a
    // season page already has a verified series-level ID, preserve that ID and
    // continue filling the season metadata instead of treating the episode ID
    // as a remake/identity collision.
    const seasonTitle = `${context.title ?? ""}`;
    if (!seasonNumber(seasonTitle)) {
      return { field: "IMDb ID", expected: existingImdbId, actual: metadataImdbId };
    }
  }

  const expectedYear = `${propText(properties["Release Year"]) ?? ""}`.match(/\d{4}/)?.[0];
  const metadataYear = `${metadata.releaseYear ?? ""}`.match(/\d{4}/)?.[0];
  if (expectedYear && metadataYear && expectedYear !== metadataYear) {
    return { field: "Release Year", expected: expectedYear, actual: metadataYear };
  }
  return null;
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

function names(values = [], limit = Infinity) {
  return asArray(values)
    .map((item) => (typeof item === "string" ? item : item.name))
    .filter(Boolean)
    .slice(0, limit);
}

function parseInfoPairs(infoText) {
  const pairs = {};
  const labels = [
    "导演",
    "编剧",
    "主演",
    "类型",
    "制片国家/地区",
    "语言",
    "上映日期",
    "首播",
    "片长",
    "又名",
    "IMDb"
  ];
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedLabels.join("|")})\\s*:\\s*`, "giu");
  const matches = [...infoText.matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const label = match[1];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? infoText.length;
    const value = infoText.slice(start, end).trim();
    if (value) pairs[label] = value;
  }
  return pairs;
}

function isoDurationToMinutes(value) {
  const match = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) {
    return undefined;
  }
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

async function fetchDoubanMetadata(subjectId, cookie, posterQuery = "") {
  const url = `https://movie.douban.com/subject/${subjectId}/`;
  const html = await fetchDoubanSubjectHtml(url, {
    Cookie: cookie,
    Referer: "https://movie.douban.com/"
  });
  if (/检测到有异常请求|captcha|安全验证/i.test(html)) {
    throw new Error("Douban returned a security challenge");
  }

  const ld = parseJsonLd(html);
  const doubanDisplayTitle = cleanTitle(
    stripHtml(html.match(/<span[^>]*property=["']v:itemreviewed["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") ||
      `${ld.name ?? ""}`
  );
  // Douban may return its browser security challenge instead of the subject
  // HTML. The suggest endpoint still exposes a poster for an exact subject ID.
  let suggestedPoster;
  if (!ld.image) {
    const posterQueries = [...new Set([
      posterQuery,
      titleWithoutYear(posterQuery),
      doubanDisplayTitle,
      subjectId
    ].filter(Boolean))];
    for (const query of posterQueries) {
      const suggestions = await fetchDoubanSuggestions(query, cookie).catch(() => []);
      suggestedPoster = suggestions.find((item) => `${item.id ?? ""}` === `${subjectId}`)?.img;
      if (suggestedPoster) break;
    }
  }
  const infoText = stripHtml(html.match(/<div id="info">([\s\S]*?)<\/div>/)?.[1] ?? "");
  const infoPairs = parseInfoPairs(infoText);
  const summary = stripHtml(html.match(/<span property="v:summary"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  const rating = Number(ld.aggregateRating?.ratingValue ?? html.match(/<strong class="ll rating_num" property="v:average">([\s\S]*?)<\/strong>/)?.[1]?.trim());
  const imdbId = infoPairs.IMDb?.match(/tt\d+/i)?.[0];
  const releaseText = infoPairs["上映日期"] || infoPairs["首播"] || "";
  const releaseDate = ld.datePublished || releaseText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const releaseYear = releaseYearFromText(releaseDate) ?? releaseYearFromText(releaseText);
  const ldGenres = asArray(ld.genre).map((genre) => `${genre ?? ""}`);
  const genres = splitListValue(infoPairs["类型"]).length > 0 ? splitListValue(infoPairs["类型"]) : uniqueNonEmpty(ldGenres);
  const durationMinutes = parseRuntimeMinutes(infoPairs["片长"]) ?? isoDurationToMinutes(ld.duration);
  const directors = splitListValue(infoPairs["导演"]).length > 0 ? splitListValue(infoPairs["导演"], 20) : names(ld.director, 20);
  const writers = splitListValue(infoPairs["编剧"]).length > 0 ? splitListValue(infoPairs["编剧"], 30) : names(ld.author, 30);
  const cast = splitListValue(infoPairs["主演"]).length > 0 ? splitListValue(infoPairs["主演"], 80) : names(ld.actor, 80);
  const countries = splitListValue(infoPairs["制片国家/地区"], 12);
  const languages = splitListValue(infoPairs["语言"], 12);
  const mappedGenres = mapGenres(genres);
  const regionalTitles = extractRegionalTitles(infoPairs["又名"]);

  const basicInfoLines = [
    ["导演", infoPairs["导演"] || joinList(directors)],
    ["编剧", infoPairs["编剧"] || joinList(writers)],
    ["主演", infoPairs["主演"] || joinList(cast.slice(0, 12))],
    ["类型", infoPairs["类型"] || joinList(genres)],
    ["制片国家/地区", infoPairs["制片国家/地区"] || joinList(countries)],
    ["语言", infoPairs["语言"] || joinList(languages)],
    ["上映日期", infoPairs["上映日期"] || infoPairs["首播"] || releaseDate],
    ["片长", infoPairs["片长"] || (durationMinutes ? `${durationMinutes}分钟` : "")],
    ["又名", infoPairs["又名"]],
    ["IMDb", imdbId]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`);

  return {
    subjectId,
    metadataSource: "douban",
    subjectUrl: url,
    doubanDisplayTitle: doubanDisplayTitle || undefined,
    posterUrl: ld.image || suggestedPoster,
    doubanRating: Number.isFinite(rating) ? rating : undefined,
    releaseDate,
    releaseYear,
    genres,
    externalGenreText: joinList(mappedGenres.raw),
    unmappedGenres: mappedGenres.unmapped,
    imdbId,
    countries,
    languages,
    regionalTitles,
    runtimeMinutes: durationMinutes,
    directors,
    writers,
    cast,
    description: bestDescription(ld.description, summary),
    basicInfo: basicInfoLines.join("\n")
  };
}

async function fetchImdbRating(imdbId, timeoutMs, { omdbApiKey = dotenv("OMDB_API_KEY") } = {}) {
  if (!imdbId) {
    return undefined;
  }
  if (omdbApiKey) {
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("apikey", omdbApiKey);
    url.searchParams.set("i", imdbId);
    const payload = await fetchJson(url.toString());
    const rating = Number(payload.imdbRating);
    if (Number.isFinite(rating)) return rating;
    // OMDb can lag behind newly released series; continue to the IMDb page fallback.
  }
  // IMDb blocks direct automation; use one Jina reader hop as the HTML fallback.
  const markdown = await fetchText(`https://r.jina.ai/http://www.imdb.com/title/${imdbId}/ratings/`, {
    "Accept-Language": "en-US,en;q=0.9"
  }, timeoutMs);
  const rating = markdown.match(/IMDb RATING\s+([0-9.]+)\/10/i)?.[1] ?? markdown.match(/⭐\s*([0-9.]+)/)?.[1];
  return rating ? Number(rating) : undefined;
}

async function fetchOmdbMetadata(imdbId, timeoutMs, { omdbApiKey = dotenv("OMDB_API_KEY") } = {}) {
  if (!imdbId || !omdbApiKey) return undefined;
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", omdbApiKey);
  url.searchParams.set("i", imdbId);
  url.searchParams.set("plot", "full");
  const payload = await fetchJson(url.toString());
  if (payload.Response !== "True" || `${payload.imdbID ?? ""}`.toLowerCase() !== imdbId.toLowerCase()) return undefined;

  const list = (value) => `${value ?? ""}`.split(/\s*,\s*/u).filter(Boolean).filter((item) => item !== "N/A");
  const rawRuntimeMinutes = Number(`${payload.Runtime ?? ""}`.match(/\d+/u)?.[0]);
  // OMDb currently returns "1 min" for some TV-series records even though
  // the value is not a meaningful series runtime. Keep the field empty and
  // force review instead of persisting a visibly false value.
  const suspiciousSeriesRuntime = payload.Type === "series" && Number.isFinite(rawRuntimeMinutes) && rawRuntimeMinutes < 10;
  const runtimeMinutes = suspiciousSeriesRuntime ? undefined : rawRuntimeMinutes;
  const genres = list(payload.Genre);
  const countries = list(payload.Country);
  const languages = list(payload.Language);
  const directors = list(payload.Director);
  const writers = list(payload.Writer);
  const cast = list(payload.Actors);
  const productionCompanies = list(payload.Production);
  const releaseYear = Number(`${payload.Year ?? ""}`.match(/\d{4}/u)?.[0]);
  const basicInfoLines = [
    ["导演", joinList(directors)],
    ["编剧", joinList(writers)],
    ["主演", joinList(cast)],
    ["制作公司", joinList(productionCompanies)],
    ["类型", joinList(genres)],
    ["制片国家/地区", joinList(countries)],
    ["语言", joinList(languages)],
    ["片长", Number.isFinite(runtimeMinutes) ? `${runtimeMinutes}分钟` : ""],
    ["IMDb", imdbId]
  ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`);
  return {
    imdbId,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
    posterUrl: payload.Poster && payload.Poster !== "N/A" ? payload.Poster : undefined,
    genres,
    externalGenreText: joinList(genres),
    countries,
    languages,
    runtimeMinutes: Number.isFinite(runtimeMinutes) ? runtimeMinutes : undefined,
    directors,
    writers,
    cast,
    productionCompanies,
    description: payload.Plot && payload.Plot !== "N/A" ? payload.Plot : undefined,
    basicInfo: basicInfoLines.join("\n"),
    warnings: suspiciousSeriesRuntime ? ["omdb_suspicious_series_runtime"] : [],
    metadataSource: "omdb"
  };
}

async function fetchImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://movie.douban.com/"
    }
  });
  if (!response.ok) {
    throw new Error(`image download HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

async function uploadPoster(notion, metadata, title) {
  if (!metadata.posterUrl) {
    return undefined;
  }
  let image;
  try {
    image = await fetchImage(metadata.posterUrl);
  } catch (error) {
    metadata.warnings = [...(metadata.warnings ?? []), "poster_download_failed"];
    console.warn(`poster download skipped for ${title}: ${error.message}`);
    return undefined;
  }
  const { bytes, contentType } = image;
  const filename = notionFileName(`${cleanTitle(title)} poster - Douban.jpg`);
  const upload = await notion.fileUploads.create({
    mode: "single_part",
    filename,
    content_type: contentType
  });
  const sent = await notion.fileUploads.send({
    file_upload_id: upload.id,
    file: {
      filename,
      data: new Blob([bytes], { type: contentType })
    }
  });
  return {
    name: filename,
    type: "file_upload",
    file_upload: {
      id: sent.id
    }
  };
}

function notionFileName(name) {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  if (safe.length <= 100) return safe;
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  return `${stem.slice(0, Math.max(1, 100 - extension.length))}${extension}`;
}

function buildPatch(page, metadata, imdbRating, posterFile, options = {}) {
  const properties = page.properties;
  const patch = {};
  const genres = mapGenres(metadata.genres ?? []);
  const existingImdbId = (propText(properties["IMDb ID"]) || propText(properties.imdb)).match(/tt\d+/i)?.[0];
  const effectiveImdbId = existingImdbId || metadata.imdbId;

  if (!hasValue(properties, "豆瓣评分") && metadata.doubanRating !== undefined) {
    patch["豆瓣评分"] = { number: metadata.doubanRating };
  }
  if (!hasValue(properties, "IMDB评分") && imdbRating !== undefined) {
    patch["IMDB评分"] = { number: imdbRating };
  }
  if (propertyExists(properties, "Release Year") && !hasValue(properties, "Release Year") && metadata.releaseYear) {
    patch["Release Year"] = { number: metadata.releaseYear };
  }
  if (!hasValue(properties, "上映日期") && metadata.releaseDate) {
    patch["上映日期"] = { date: { start: metadata.releaseDate } };
  }
  if (propertyExists(properties, "Countries") && !hasValue(properties, "Countries") && metadata.countries?.length) {
    patch.Countries = multiSelect(metadata.countries);
  }
  if (propertyExists(properties, "Languages") && !hasValue(properties, "Languages") && metadata.languages?.length) {
    patch.Languages = multiSelect(metadata.languages);
  }
  if (propertyExists(properties, "Traditional Chinese Title (Taiwan)") && !hasValue(properties, "Traditional Chinese Title (Taiwan)") && metadata.regionalTitles?.taiwan) {
    patch["Traditional Chinese Title (Taiwan)"] = richTextValue(metadata.regionalTitles.taiwan);
  }
  if (propertyExists(properties, "Traditional Chinese Title (Hong Kong)") && !hasValue(properties, "Traditional Chinese Title (Hong Kong)") && metadata.regionalTitles?.hongKong) {
    patch["Traditional Chinese Title (Hong Kong)"] = richTextValue(metadata.regionalTitles.hongKong);
  }
  if (propertyExists(properties, "旨趣") && genres.canonical.length) {
    const currentGenres = currentMultiSelectNames(properties["旨趣"]);
    const nextGenres = uniqueNonEmpty([...currentGenres, ...genres.canonical]);
    if (nextGenres.length !== currentGenres.length) {
      patch["旨趣"] = multiSelect(nextGenres);
    }
  }
  if (propertyExists(properties, "外部类型原文") && !hasValue(properties, "外部类型原文")) {
    const externalGenreText = metadata.externalGenreText || joinList(genres.raw);
    if (externalGenreText) {
      patch["外部类型原文"] = richTextValue(externalGenreText);
    }
  }
  if (propertyExists(properties, "未映射类型")) {
    const unmappedGenres = uniqueNonEmpty(metadata.unmappedGenres?.length ? metadata.unmappedGenres : genres.unmapped);
    const currentUnmappedText = propText(properties["未映射类型"]);
    const currentUnmappedGenres = splitListValue(currentUnmappedText);
    const stillUnmapped = mapGenres([...currentUnmappedGenres, ...unmappedGenres]).unmapped;
    if (stillUnmapped.length && joinList(stillUnmapped) !== currentUnmappedText) {
      patch["未映射类型"] = richTextValue(joinList(stillUnmapped));
    } else if (!stillUnmapped.length && currentUnmappedGenres.length) {
      patch["未映射类型"] = { rich_text: [] };
    } else if (unmappedGenres.length && !currentUnmappedGenres.length) {
      patch["未映射类型"] = richTextValue(joinList(unmappedGenres));
    }
  }
  if (propertyExists(properties, "Runtime Minutes") && !hasValue(properties, "Runtime Minutes") && metadata.runtimeMinutes) {
    patch["Runtime Minutes"] = { number: metadata.runtimeMinutes };
  }
  if (propertyExists(properties, "Directors") && !hasValue(properties, "Directors") && metadata.directors?.length) {
    patch.Directors = richTextValue(joinList(metadata.directors));
  }
  if (propertyExists(properties, "Writers") && !hasValue(properties, "Writers") && metadata.writers?.length) {
    patch.Writers = richTextValue(joinList(metadata.writers));
  }
  if (propertyExists(properties, "Cast") && !hasValue(properties, "Cast") && metadata.cast?.length) {
    patch.Cast = richTextValue(joinList(metadata.cast));
  }
  if (propertyExists(properties, "Production Companies") && !hasValue(properties, "Production Companies") && metadata.productionCompanies?.length) {
    patch["Production Companies"] = richTextValue(joinList(metadata.productionCompanies));
  }
  if (propertyExists(properties, "Distributors") && !hasValue(properties, "Distributors") && metadata.distributors?.length) {
    patch.Distributors = richTextValue(joinList(metadata.distributors));
  }
  if (propertyExists(properties, "Studios") && !hasValue(properties, "Studios") && metadata.studios?.length) {
    patch.Studios = richTextValue(joinList(metadata.studios));
  }
  if (!hasValue(properties, "imdb") && effectiveImdbId) {
    patch.imdb = {
      rich_text: richText(effectiveImdbId, `https://www.imdb.com/title/${effectiveImdbId}/`)
    };
  }
  if (!hasValue(properties, "IMDb ID") && effectiveImdbId) {
    patch["IMDb ID"] = { rich_text: richText(effectiveImdbId) };
  }
  if (propertyExists(properties, "IMDb URL") && effectiveImdbId) {
    const currentImdbUrl = propText(properties["IMDb URL"]);
    const expectedImdbUrl = `https://www.imdb.com/title/${effectiveImdbId}/`;
    if (!currentImdbUrl || !currentImdbUrl.toLowerCase().includes(effectiveImdbId.toLowerCase())) {
      patch["IMDb URL"] = { url: expectedImdbUrl };
    }
  }
  if (!hasValue(properties, "Douban Subject ID") && metadata.subjectId) {
    patch["Douban Subject ID"] = { rich_text: richText(metadata.subjectId) };
  }
  if (!hasValue(properties, "Douban URL") && metadata.subjectUrl) {
    patch["Douban URL"] = { url: metadata.subjectUrl };
  }
  if ((options.forcePoster || !hasValue(properties, "Poster URL")) && metadata.posterUrl) {
    patch["Poster URL"] = { url: metadata.posterUrl };
  }
  const currentDescription = propText(properties["简介"]);
  if ((options.forceDoubanFields && metadata.metadataSource === "douban" && metadata.description)
    || ((!currentDescription || (looksTruncated(currentDescription) && metadata.description?.length > currentDescription.length)) && metadata.description)) {
    patch["简介"] = { rich_text: richText(metadata.description) };
  }
  if ((options.forceDoubanFields && metadata.metadataSource === "douban" && metadata.basicInfo)
    || (!hasValue(properties, "基本信息") && metadata.basicInfo)) {
    patch["基本信息"] = { rich_text: richText(metadata.basicInfo) };
  }
  if ((options.forcePoster || !hasValue(properties, "海报")) && posterFile) {
    patch["海报"] = { files: [posterFile] };
  }
  if (propertyExists(properties, "Match Status") && !hasValue(properties, "Match Status")) {
    patch["Match Status"] = select("candidate");
  }
  const metadataStatus = propText(properties["Metadata Status"]);
  if (propertyExists(properties, "Metadata Status") && (!metadataStatus || metadataStatus === "draft")) {
    patch["Metadata Status"] = select("partial");
  }
  if (propertyExists(properties, "Metadata Source")) {
    const nextSources = combinedMultiSelect(properties["Metadata Source"], [metadata.metadataSource ?? "douban"]);
    const currentSources = currentMultiSelectNames(properties["Metadata Source"]);
    if (nextSources && nextSources.multi_select.length !== currentSources.length) {
      patch["Metadata Source"] = nextSources;
    }
  }
  const metadataConfidence = numericPropertyValue(properties["Metadata Confidence"]);
  if (propertyExists(properties, "Metadata Confidence") && metadata.subjectId && (metadataConfidence === undefined || metadataConfidence < 0.9)) {
    patch["Metadata Confidence"] = { number: 0.9 };
  }
  const unresolvedGenres = uniqueNonEmpty(metadata.unmappedGenres?.length ? metadata.unmappedGenres : genres.unmapped);
  if (propertyExists(properties, "Needs Review") && (unresolvedGenres.length > 0 || metadata.warnings?.length > 0)) {
    patch["Needs Review"] = { checkbox: true };
  }

  const currentTitle = propText(properties.Title);
  const cleanedTitle = cleanTitle(currentTitle);
  const canonicalTitle = preserveSeasonIdentity(
    cleanedTitle,
    canonicalTitleFromStructuredIdentity(properties, metadata)
  );
  if (canonicalTitle && titleKey(cleanedTitle) !== titleKey(canonicalTitle)) {
    if (canSafelyCompleteStructuredTitle(cleanedTitle, properties, metadata)) {
      patch.Title = { title: richText(canonicalTitle) };
    } else if (propertyExists(properties, "Needs Review")) {
      patch["Needs Review"] = { checkbox: true };
    }
  } else if (currentTitle !== cleanedTitle && Object.keys(patch).length > 0) {
    patch.Title = { title: richText(cleanedTitle) };
  }
  if (propertyExists(properties, "Metadata Updated At") && Object.keys(patch).length > 0) {
    patch["Metadata Updated At"] = { date: { start: options.now ?? new Date().toISOString().slice(0, 10) } };
  }

  return patch;
}

async function collectViewPages(notion, pageSize, limit) {
  const initial = await notion.views.queries.create({ view_id: VIEW_ID, page_size: Math.min(pageSize, 100) });
  const pages = [...initial.results];
  let nextCursor = initial.next_cursor;

  while (nextCursor && pages.length < limit) {
    const response = await notion.views.queries.results({
      view_id: VIEW_ID,
      query_id: initial.id,
      start_cursor: nextCursor,
      page_size: Math.min(pageSize, 100)
    });
    pages.push(...response.results);
    nextCursor = response.next_cursor;
  }

  return pages.slice(0, limit);
}

async function collectTargetPages(notion, options) {
  if (options.pageIds.length > 0) {
    return options.pageIds.map((id) => ({ id }));
  }
  return collectViewPages(notion, options.pageSize, options.limit);
}

function preferredDoubanSubjectId(properties, pageId, options = {}) {
  const cliSubjectId =
    options.doubanSubjects?.get(pageId) ??
    options.doubanSubjects?.get(pageId.replace(/-/g, ""));
  if (cliSubjectId) return cliSubjectId;

  const existingSubjectId = propText(properties["Douban Subject ID"]) || propText(properties["Douban"]);
  return existingSubjectId.match(/\d{4,12}/)?.[0];
}

function snapshotProperty(property) {
  if (!property?.type) return null;
  const value = property[property.type];
  if (property.type === "title" || property.type === "rich_text") {
    return plainText(value);
  }
  if (property.type === "checkbox" || property.type === "number" || property.type === "url") {
    return value ?? null;
  }
  if (property.type === "date") return value?.start ?? null;
  if (property.type === "select") return value?.name ?? null;
  if (property.type === "multi_select") return (value ?? []).map(item => item.name);
  if (property.type === "files") return (value ?? []).map(item => item.name ?? item.file?.url ?? item.external?.url ?? null);
  return value ?? null;
}

async function processOmdbFallback(notion, page, options, title, existingImdbId) {
  const omdbMetadata = options.noExternal
    ? undefined
    : await fetchOmdbMetadata(existingImdbId, options.imdbTimeoutMs).catch(() => undefined);
  if (!omdbMetadata) return undefined;

  const identityConflict = metadataIdentityConflict(page.properties, omdbMetadata, { title });
  if (identityConflict) {
    return { pageId: page.id, title, status: "skipped", reason: "metadata_identity_conflict", identityConflict };
  }
  const imdbRating = await fetchImdbRating(existingImdbId, options.imdbTimeoutMs).catch(() => undefined);
  const needsPosterUpload = (options.forcePoster || !hasValue(page.properties, "海报")) && omdbMetadata.posterUrl;
  const posterFile = needsPosterUpload && options.dryRun
    ? { name: notionFileName(`${cleanTitle(title)} poster - OMDb.jpg`), type: "file_upload", file_upload: { id: "dry-run" } }
    : needsPosterUpload
      ? await uploadPoster(notion, omdbMetadata, title)
      : undefined;
  const patch = buildPatch(page, omdbMetadata, imdbRating, posterFile, options);
  if (Object.keys(patch).length === 0) {
    return { pageId: page.id, title, status: "skipped", reason: "nothing_to_update", source: "omdb" };
  }
  let readback;
  if (!options.dryRun) {
    await notion.pages.update({ page_id: page.id, properties: patch });
    const verifiedPage = await notion.pages.retrieve({ page_id: page.id });
    readback = Object.fromEntries(Object.keys(patch).map(name => [name, snapshotProperty(verifiedPage.properties?.[name])]));
  }
  return {
    pageId: page.id,
    title,
    status: options.dryRun ? "dry_run" : "updated",
    source: "omdb",
    fields: Object.keys(patch),
    updatedFieldSources: Object.fromEntries(Object.keys(patch).map((field) => [field, "omdb"])),
    ...(readback ? { readback } : {})
  };
}

async function processPage(notion, pageRef, options, cookie) {
  const page = await notion.pages.retrieve({ page_id: pageRef.id });
  const title = propText(page.properties.Title);
  const chineseTitle = propText(page.properties["Simplified Chinese Title"]);
  const releaseYear = propText(page.properties["Release Year"]);
  const searchTitle = chineseTitle && releaseYear ? `${chineseTitle} (${releaseYear})` : chineseTitle || title;
  const existingInfo = [propText(page.properties["基本信息"]), propText(page.properties.note)].join(" ");
  const expectedType = propText(page.properties["影别"]);
  const forcedSubjectId = preferredDoubanSubjectId(page.properties, page.id, options);
  const subjectResult = forcedSubjectId
    ? { status: "ok", subject: { id: forcedSubjectId } }
    : await findDoubanSubject(searchTitle, existingInfo, expectedType, cookie);

  if (subjectResult.status !== "ok") {
    const existingImdbId = (propText(page.properties["IMDb ID"]) || propText(page.properties.imdb)).match(/tt\d+/i)?.[0];
    const fallback = await processOmdbFallback(notion, page, options, title, existingImdbId);
    if (fallback) return fallback;
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: subjectResult.reason,
      suggestions: subjectResult.suggestions
    };
  }

  await sleep(options.delayMs);
  let metadata;
  try {
    metadata = await fetchDoubanMetadata(subjectResult.subject.id, cookie, searchTitle);
  } catch (error) {
    const existingImdbId = (propText(page.properties["IMDb ID"]) || propText(page.properties.imdb)).match(/tt\d+/i)?.[0];
    const fallback = await processOmdbFallback(notion, page, options, title, existingImdbId);
    if (fallback) return { ...fallback, doubanError: error.message };
    return { pageId: page.id, title, status: "error", message: error.message, source: "douban" };
  }
  const identityConflict = metadataIdentityConflict(page.properties, metadata, { title });
  if (identityConflict) {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: "metadata_identity_conflict",
      identityConflict,
      subjectId: metadata.subjectId
    };
  }
  await sleep(options.delayMs);
  const imdbRating = options.noExternal
    ? undefined
    : await fetchImdbRating(metadata.imdbId, options.imdbTimeoutMs).catch(() => undefined);
  await sleep(options.delayMs);
  const needsPosterUpload = (options.forcePoster || !hasValue(page.properties, "海报")) && metadata.posterUrl;
  const posterFile =
    needsPosterUpload && options.dryRun
      ? {
          name: notionFileName(`${cleanTitle(title)} poster - Douban.jpg`),
          type: "file_upload",
          file_upload: {
            id: "dry-run"
          }
        }
      : needsPosterUpload
        ? await uploadPoster(notion, metadata, title)
        : undefined;
  const patch = buildPatch(page, metadata, imdbRating, posterFile, options);

  if (Object.keys(patch).length === 0) {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: "nothing_to_update",
      subjectId: metadata.subjectId
    };
  }

  let readback;
  if (!options.dryRun) {
    await notion.pages.update({ page_id: page.id, properties: patch });
    const verifiedPage = await notion.pages.retrieve({ page_id: page.id });
    readback = Object.fromEntries(
      Object.keys(patch).map(name => [name, snapshotProperty(verifiedPage.properties?.[name])])
    );
  }

  return {
    pageId: page.id,
    title,
    newTitle: patch.Title?.title?.[0]?.text?.content,
    status: options.dryRun ? "dry_run" : "updated",
    subjectId: metadata.subjectId,
    fields: Object.keys(patch),
    updatedFieldSources: Object.fromEntries(Object.keys(patch).map((field) => [field, metadata.metadataSource ?? "douban"])),
    ...(readback ? { readback } : {})
  };
}

async function main() {
  ensureLocalData();
  const options = parseArgs();
  installNotionDnsOverride();
  const notion = new Client({ auth: dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN"), timeoutMs: 120000 });
  const cookie = cookieHeader();
  const processed = options.forceProcessed ? new Set() : readProcessed();
  const pages = await collectTargetPages(notion, options);
  const report = {
    startedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    totalCandidates: pages.length,
    records: []
  };

  console.log(options.pageIds.length > 0
    ? `Loaded ${pages.length} target pages from --page-id.`
    : `Loaded ${pages.length} candidate pages from view ${VIEW_ID}.`);

  for (const pageRef of pages) {
    if (processed.has(pageRef.id)) {
      console.log(`skip processed ${pageRef.id}`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const record = await processPage(notion, pageRef, options, cookie);
      record.elapsedMs = Date.now() - startedAt;
      report.records.push(record);
      if (!options.dryRun) {
        appendProgress({ ...record, recordedAt: new Date().toISOString() });
      }
      console.log(JSON.stringify(record));
    } catch (error) {
      const record = {
        pageId: pageRef.id,
        status: "error",
        message: error.message,
        elapsedMs: Date.now() - startedAt
      };
      report.records.push(record);
      if (!options.dryRun) {
        appendProgress({ ...record, recordedAt: new Date().toISOString() });
      }
      console.log(JSON.stringify(record));

      if (/security challenge|captcha|HTTP 403|HTTP 429/i.test(error.message)) {
        console.log("Stopping because the remote service appears to be rate-limiting or challenging the session.");
        break;
      }
    }

    await sleep(options.delayMs);
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Report written to ${REPORT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  buildPatch,
  parseInfoPairs,
  parseRuntimeMinutes,
  preferredDoubanSubjectId,
  fetchImdbRating,
  splitListValue
};
