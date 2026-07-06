import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
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
  "真人秀"
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
    forceProcessed: false
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
  return "";
}

function hasValue(properties, name) {
  return Boolean(propText(properties[name]));
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
    .replace(/^(?:【敬请期待】|【仅供下载】)\s*/, "")
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
  return values
    .map((item) => item.name)
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
    "片长",
    "又名",
    "IMDb"
  ];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const next = labels[index + 1];
    const pattern = next
      ? new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)\\s+${next}\\s*:`, "i")
      : new RegExp(`${label}\\s*:\\s*([\\s\\S]*)$`, "i");
    const match = infoText.match(pattern);
    if (match) {
      pairs[label] = match[1].trim();
    }
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

async function fetchDoubanMetadata(subjectId, cookie) {
  const url = `https://movie.douban.com/subject/${subjectId}/`;
  const html = await fetchDoubanSubjectHtml(url, {
    Cookie: cookie,
    Referer: "https://movie.douban.com/"
  });
  if (/检测到有异常请求|captcha|安全验证/i.test(html)) {
    throw new Error("Douban returned a security challenge");
  }

  const ld = parseJsonLd(html);
  const infoText = stripHtml(html.match(/<div id="info">([\s\S]*?)<\/div>/)?.[1] ?? "");
  const infoPairs = parseInfoPairs(infoText);
  const summary = stripHtml(html.match(/<span property="v:summary"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  const rating = Number(ld.aggregateRating?.ratingValue ?? html.match(/<strong class="ll rating_num" property="v:average">([\s\S]*?)<\/strong>/)?.[1]?.trim());
  const imdbId = infoPairs.IMDb?.match(/tt\d+/i)?.[0];
  const releaseDate = ld.datePublished || infoPairs["上映日期"]?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const genres = Array.isArray(ld.genre) ? ld.genre : [];
  const durationMinutes = isoDurationToMinutes(ld.duration);

  const basicInfoLines = [
    ["导演", infoPairs["导演"] || names(ld.director).join(" / ")],
    ["编剧", infoPairs["编剧"] || names(ld.author).join(" / ")],
    ["主演", infoPairs["主演"] || names(ld.actor, 8).join(" / ")],
    ["类型", infoPairs["类型"] || genres.join(" / ")],
    ["制片国家/地区", infoPairs["制片国家/地区"]],
    ["语言", infoPairs["语言"]],
    ["上映日期", infoPairs["上映日期"] || releaseDate],
    ["片长", infoPairs["片长"] || (durationMinutes ? `${durationMinutes}分钟` : "")],
    ["又名", infoPairs["又名"]],
    ["IMDb", imdbId]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`);

  return {
    subjectId,
    subjectUrl: url,
    posterUrl: ld.image,
    doubanRating: Number.isFinite(rating) ? rating : undefined,
    releaseDate,
    genres,
    imdbId,
    description: bestDescription(ld.description, summary),
    basicInfo: basicInfoLines.join("\n")
  };
}

async function fetchImdbRating(imdbId, timeoutMs) {
  if (!imdbId) {
    return undefined;
  }
  const omdbApiKey = dotenv("OMDB_API_KEY");
  if (omdbApiKey) {
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("apikey", omdbApiKey);
    url.searchParams.set("i", imdbId);
    const payload = await fetchJson(url.toString());
    const rating = Number(payload.imdbRating);
    return Number.isFinite(rating) ? rating : undefined;
  }
  const markdown = await fetchText(`https://r.jina.ai/http://r.jina.ai/http://https://www.imdb.com/title/${imdbId}/ratings/`, {
    "Accept-Language": "en-US,en;q=0.9"
  }, timeoutMs);
  const rating = markdown.match(/IMDb RATING\s+([0-9.]+)\/10/i)?.[1] ?? markdown.match(/⭐\s*([0-9.]+)/)?.[1];
  return rating ? Number(rating) : undefined;
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
  const { bytes, contentType } = await fetchImage(metadata.posterUrl);
  const filename = `${cleanTitle(title)} poster - Douban.jpg`.replace(/[\\/:*?"<>|]/g, "_");
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

function buildPatch(page, metadata, imdbRating, posterFile) {
  const properties = page.properties;
  const patch = {};

  if (!hasValue(properties, "豆瓣评分") && metadata.doubanRating !== undefined) {
    patch["豆瓣评分"] = { number: metadata.doubanRating };
  }
  if (!hasValue(properties, "IMDB评分") && imdbRating !== undefined) {
    patch["IMDB评分"] = { number: imdbRating };
  }
  if (!hasValue(properties, "上映日期") && metadata.releaseDate) {
    patch["上映日期"] = { date: { start: metadata.releaseDate } };
  }
  if (!hasValue(properties, "Release Date") && metadata.releaseDate) {
    patch["Release Date"] = { date: { start: metadata.releaseDate } };
  }
  if (!hasValue(properties, "旨趣") && metadata.genres?.length) {
    const selected = metadata.genres.filter((genre) => genreOptions.has(genre));
    if (selected.length > 0) {
      patch["旨趣"] = { multi_select: selected.map((name) => ({ name })) };
    }
  }
  if (!hasValue(properties, "imdb") && metadata.imdbId) {
    patch.imdb = {
      rich_text: richText(metadata.imdbId, `https://www.imdb.com/title/${metadata.imdbId}/`)
    };
  }
  if (!hasValue(properties, "IMDb ID") && metadata.imdbId) {
    patch["IMDb ID"] = { rich_text: richText(metadata.imdbId) };
  }
  if (!hasValue(properties, "IMDb URL") && metadata.imdbId) {
    patch["IMDb URL"] = { url: `https://www.imdb.com/title/${metadata.imdbId}/` };
  }
  if (!hasValue(properties, "Douban Subject ID") && metadata.subjectId) {
    patch["Douban Subject ID"] = { rich_text: richText(metadata.subjectId) };
  }
  if (!hasValue(properties, "Douban URL") && metadata.subjectUrl) {
    patch["Douban URL"] = { url: metadata.subjectUrl };
  }
  if (!hasValue(properties, "Poster URL") && metadata.posterUrl) {
    patch["Poster URL"] = { url: metadata.posterUrl };
  }
  const currentDescription = propText(properties["简介"]);
  if ((!currentDescription || (looksTruncated(currentDescription) && metadata.description.length > currentDescription.length)) && metadata.description) {
    patch["简介"] = { rich_text: richText(metadata.description) };
  }
  if (!hasValue(properties, "基本信息") && metadata.basicInfo) {
    patch["基本信息"] = { rich_text: richText(metadata.basicInfo) };
  }
  if (!hasValue(properties, "海报") && posterFile) {
    patch["海报"] = { files: [posterFile] };
  }

  const currentTitle = propText(properties.Title);
  const cleanedTitle = cleanTitle(currentTitle);
  if (currentTitle !== cleanedTitle && Object.keys(patch).length > 0) {
    patch.Title = { title: richText(cleanedTitle) };
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

async function processPage(notion, pageRef, options, cookie) {
  const page = await notion.pages.retrieve({ page_id: pageRef.id });
  const title = propText(page.properties.Title);
  const chineseTitle = propText(page.properties["Simplified Chinese Title"]);
  const releaseYear = propText(page.properties["Release Year"]);
  const searchTitle = chineseTitle && releaseYear ? `${chineseTitle} (${releaseYear})` : chineseTitle || title;
  const existingInfo = [propText(page.properties["基本信息"]), propText(page.properties.note)].join(" ");
  const expectedType = propText(page.properties["影别"]);
  const forcedSubjectId = options.doubanSubjects.get(page.id) ?? options.doubanSubjects.get(page.id.replace(/-/g, ""));
  const subjectResult = forcedSubjectId
    ? { status: "ok", subject: { id: forcedSubjectId } }
    : await findDoubanSubject(searchTitle, existingInfo, expectedType, cookie);

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
  const metadata = await fetchDoubanMetadata(subjectResult.subject.id, cookie);
  await sleep(options.delayMs);
  const imdbRating = options.noExternal
    ? undefined
    : await fetchImdbRating(metadata.imdbId, options.imdbTimeoutMs).catch(() => undefined);
  await sleep(options.delayMs);
  const posterFile =
    options.dryRun && metadata.posterUrl
      ? {
          name: `${cleanTitle(title)} poster - Douban.jpg`,
          type: "file_upload",
          file_upload: {
            id: "dry-run"
          }
        }
      : await uploadPoster(notion, metadata, title);
  const patch = buildPatch(page, metadata, imdbRating, posterFile);

  if (Object.keys(patch).length === 0) {
    return {
      pageId: page.id,
      title,
      status: "skipped",
      reason: "nothing_to_update",
      subjectId: metadata.subjectId
    };
  }

  if (!options.dryRun) {
    await notion.pages.update({ page_id: page.id, properties: patch });
  }

  return {
    pageId: page.id,
    title,
    newTitle: patch.Title?.title?.[0]?.text?.content,
    status: options.dryRun ? "dry_run" : "updated",
    subjectId: metadata.subjectId,
    fields: Object.keys(patch)
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
