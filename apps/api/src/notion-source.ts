import { createHash } from "node:crypto";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import type {
  MediaAssetType,
  MediaAvailability,
  MediaVariant,
  MediaVariantMetadata,
  MovieCreditEntry,
  MovieBoxOffice,
  MovieMetadata,
  MoviePoster,
  MovieTitleEntry,
  MovieWorkKind,
  RatingValue,
  SearchResult
} from "@wwpdw/shared";
import {
  collectMetadataHintsFromText,
  createMetadataHints,
  doubanSubjectUrl,
  imdbTitleUrl,
  normalizeDoubanSubjectId,
  normalizeImdbId,
  normalizeTmdbId,
  stableMovieWorkIdFromNotion,
  tmdbMovieUrl,
  type NotionMetadataHints
} from "./notion-metadata-schema.js";

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
  properties?: JsonRecord;
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
  requestTimeoutMs: number;
  scanPageParseTimeoutMs: number;
  scanPageParseRetries: number;
  scanPageParseRetryDelayMs: number;
}

export interface NotionLibraryScanOptions {
  since?: string;
  limit?: number;
  delayMs?: number;
  pageSize?: number;
}

export interface NotionLibraryScanItem {
  pageId: string;
  title?: string;
  lastEditedTime: string;
  result?: SearchResult;
  deleteAssetKey?: string;
  skipped?: "hidden_from_website" | "no_playable_media";
  error?: string;
}

const defaultOptions: ParseOptions = {
  searchPageSize: Number(process.env.NOTION_SEARCH_PAGE_SIZE ?? 8),
  parseMaxPages: Number(process.env.NOTION_PARSE_MAX_PAGES ?? 6),
  blockDepth: Number(process.env.NOTION_PARSE_BLOCK_DEPTH ?? 2),
  blockLimit: Number(process.env.NOTION_PARSE_BLOCK_LIMIT ?? 120),
  titleScanLimit: Number(process.env.NOTION_TITLE_SCAN_LIMIT ?? 120),
  titleMatchLimit: Number(process.env.NOTION_TITLE_MATCH_LIMIT ?? 6),
  libraryQueryLimit: Number(process.env.NOTION_LIBRARY_QUERY_LIMIT ?? 300),
  variantLimit: Number(process.env.NOTION_VARIANT_LIMIT ?? 8),
  requestTimeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000),
  scanPageParseTimeoutMs: Number(process.env.NOTION_SCAN_PAGE_PARSE_TIMEOUT_MS ?? 60000),
  scanPageParseRetries: Number(process.env.NOTION_SCAN_PAGE_PARSE_RETRIES ?? 2),
  scanPageParseRetryDelayMs: Number(process.env.NOTION_SCAN_PAGE_PARSE_RETRY_DELAY_MS ?? 2000)
};

const defaultNotionPublicSiteUrl = "https://wwpdw.notion.site";
const urlPattern = /https?:\/\/[^\s<>"']+/gi;
const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const durationPropertyPattern = /duration|runtime|length|\u65f6\u957f|\u65f6\u95f4/i;
const posterPropertyPattern = /\u6d77\u62a5|poster|cover|image|\u56fe\u7247/i;
const descriptionPropertyPattern = /\u7b80\u4ecb|summary|description|synopsis|plot/i;
const infoPropertyPattern = /^(?:\u57fa\u672c\u4fe1\u606f|basic\s*info(?:rmation)?|info)$/i;
const releaseDatePropertyPattern = /^(?:\u4e0a\u6620\u65e5\u671f|\u9996\u64ad\u65e5\u671f)$/i;
const genrePropertyPattern = /^(?:\u65e8\u8da3)$/i;
const directorPropertyPattern = /\u5bfc\u6f14|\bdirectors?\b/i;
const peoplePropertyPattern = /\u4e3b\u6f14|\bcast\b|\bactors?\b|\bpeople\b/i;
const ratingLevelPropertyPattern = /\u5206\u7ea7|certificate|rating level|rated/i;
const aiSuggestedMinimumAgePropertyPattern = /AI\s*(?:suggested\s*)?(?:minimum\s*)?age|AI建议最低年龄|ai\s*age/i;
const aiAgeConfidencePropertyPattern = /AI年龄建议置信度|AI\s*age\s*confidence|age\s*confidence/i;
const contentRiskTagsPropertyPattern = /内容风险标签|content\s*risk|risk\s*tags/i;
const aiAgeReasonPropertyPattern = /AI年龄建议理由|AI\s*age\s*reason|age\s*reason/i;
const manualAgeOverridePropertyPattern = /人工年龄覆盖|manual\s*age\s*override|age\s*override/i;
const typePropertyPattern = /\u5f71\u522b|type|kind/i;
const imdbPropertyPattern = /^imdb$/i;
const simplifiedChineseTitlePropertyPattern = /^(?:simplified\s*chinese\s*title|chinese\s*title\s*\(simplified\)|zh[-_\s]*cn\s*title|\u7b80\u4f53\u4e2d\u6587(?:\s*(?:title|\u540d|\u7247\u540d))?|\u7b80\u4e2d(?:\s*(?:title|\u540d|\u7247\u540d))?)$/i;
const traditionalChineseTaiwanTitlePropertyPattern = /^(?:traditional\s*chinese\s*title\s*\((?:taiwan|tw)\)|taiwan(?:ese)?\s*chinese\s*title|zh[-_\s]*tw\s*title|\u7e41\u4f53\u4e2d\u6587.*(?:\u53f0\u6e7e|\u53f0\u7063)|\u53f0(?:\u8bd1|\u8b6f)(?:\u540d|\u7247\u540d)?|\u53f0\u6e7e(?:\u8bd1\u540d|\u7247\u540d)|\u53f0\u7063(?:\u8b6f\u540d|\u7247\u540d))$/i;
const traditionalChineseHongKongTitlePropertyPattern = /^(?:traditional\s*chinese\s*title\s*\((?:hong\s*kong|hk)\)|hong\s*kong\s*chinese\s*title|zh[-_\s]*hk\s*title|\u7e41\u4f53\u4e2d\u6587.*(?:\u9999\u6e2f|\u6e2f)|\u6e2f(?:\u8bd1|\u8b6f)(?:\u540d|\u7247\u540d)?|\u9999\u6e2f(?:\u8bd1\u540d|\u8b6f\u540d|\u7247\u540d))$/i;
const originalTitlePropertyPattern = /^(?:original\s*title|\u539f\u540d|\u539f\u7247\u540d|\u539f\u59cb\u7247\u540d)$/i;
const englishTitlePropertyPattern = /^(?:english\s*title|\u82f1\u6587(?:\s*(?:title|\u540d|\u7247\u540d))?|\u82f1\u6587\u7247\u540d|\u82f1\u6587\u540d)$/i;
const hideFromWebsitePropertyPattern =
  /^(?:hide\s*from\s*website|do\s*not\s*sync\s*to\s*website|exclude\s*from\s*website|website\s*hidden|\u4e0d\u540c\u6b65\u5230\u7f51\u7ad9|\u4e0d\u540c\u6b65\u5230\u7db2\u7ad9|\u7f51\u7ad9\u4e0b\u7ebf|\u7db2\u7ad9\u4e0b\u7dda|\u4e0b\u7ebf|\u4e0b\u7dda)$/i;
const mediaAvailabilityPropertyPattern =
  /^(?:media\s*availability|playback\s*status|availability|\u5a92\u4f53\u53ef\u7528\u6027|\u64ad\u653e\u72b6\u6001|\u64ad\u653e\u72c0\u614b)$/i;
const mediaAssetTypePropertyPattern = /^(?:asset\s*type|\u8d44\u4ea7\u7c7b\u578b|\u8cc7\u7522\u985e\u578b)$/i;
const displayLabelPropertyPattern = /^(?:display\s*label|\u663e\u793a\u6807\u7b7e|\u986f\u793a\u6a19\u7c64)$/i;
const editionPropertyPattern = /^(?:edition\s*\/?\s*version|edition|version|cut|\u7248\u672c|\u526a\u8f91\u7248)$/i;
const episodeNumberPropertyPattern = /^(?:episode\s*number|episode|ep|\u96c6\u6570|\u96c6\u5e8f)$/i;
const episodeEndNumberPropertyPattern = /^(?:episode\s*end(?:\s*number)?|end\s*episode|\u7ed3\u675f\u96c6\u6570|\u7d50\u675f\u96c6\u6578|\u622a\u6b62\u96c6\u6570)$/i;
const resolutionPropertyPattern = /^(?:resolution|\u5206\u8fa8\u7387|\u89e3\u50cf\u5ea6)$/i;
const videoCodecPropertyPattern = /^(?:video\s*codec|codec|\u89c6\u9891\u7f16\u7801|\u8996\u983b\u7de8\u78bc)$/i;
const containerPropertyPattern = /^(?:container|format|\u5c01\u88c5|\u683c\u5f0f)$/i;
const approximateSizeGbPropertyPattern = /^(?:approx(?:imate)?\s*size\s*gb|size\s*gb|\u5927\u5c0f\s*gb)$/i;
const exactByteSizePropertyPattern = /^(?:exact\s*(?:byte\s*)?size|file\s*size\s*bytes|bytes|\u5b57\u8282\u6570|\u5b57\u7bc0\u6578)$/i;
const durationSecondsPropertyPattern = /^(?:duration\s*seconds|duration\s*s|seconds|\u65f6\u957f\u79d2|\u6642\u9577\u79d2)$/i;
const frameRatePropertyPattern = /^(?:frame\s*rate|fps|\u5e27\u7387)$/i;
const videoDynamicRangePropertyPattern = /^(?:hdr\s*\/?\s*sdr|dynamic\s*range|hdr|\u52a8\u6001\u8303\u56f4|\u52d5\u614b\u7bc4\u570d)$/i;
const qualityTagPropertyPattern = /^(?:quality\s*tag|cq|crf|\u8d28\u91cf\u6807\u7b7e|\u756b\u8cea\u6a19\u7c64)$/i;
const audioCodecPropertyPattern = /^(?:audio\s*codec|\u97f3\u9891\u7f16\u7801|\u97f3\u983b\u7de8\u78bc)$/i;
const audioChannelLayoutPropertyPattern = /^(?:audio\s*channels?|channel\s*layout|\u58f0\u9053|\u8072\u9053)$/i;
const audioLanguagesPropertyPattern = /^(?:audio\s*languages?|\u97f3\u8f68\u8bed\u8a00|\u97f3\u8ecc\u8a9e\u8a00)$/i;
const subtitleLanguagesPropertyPattern = /^(?:subtitle\s*languages?|\u5b57\u5e55\u8bed\u8a00|\u5b57\u5e55\u8a9e\u8a00)$/i;
const subtitleRegionsPropertyPattern = /^(?:subtitle\s*regions?|\u5b57\u5e55\u5730\u533a|\u5b57\u5e55\u5730\u5340)$/i;
const sourceLineagePropertyPattern = /^(?:source\s*lineage|lineage|source|\u6765\u6e90\u94fe\u8def|\u4f86\u6e90\u93c8\u8def)$/i;
const playbackVerifiedPropertyPattern = /^(?:playback\s*verified|\u64ad\u653e\u5df2\u9a8c\u8bc1|\u64ad\u653e\u5df2\u9a57\u8b49)$/i;
const originalFileNamePropertyPattern = /^(?:original\s*file\s*name|file\s*name|\u539f\u59cb\u6587\u4ef6\u540d)$/i;
const assetUrlPropertyPattern = /^(?:asset\s*url|media\s*url|url|\u8d44\u4ea7\s*url|\u8cc7\u7522\s*url)$/i;
const sourcePageIdPropertyPattern = /^(?:source\s*page\s*id|\u6e90\u9875\u9762\s*id|\u6e90\u9801\u9762\s*id)$/i;
const mediaBlockIdPropertyPattern = /^(?:media\s*block\s*id|\u5a92\u4f53\u5757\s*id|\u5a92\u9ad4\u584a\s*id)$/i;
const developerMemoPropertyPattern = /^(?:developer\s*memo|operator\s*memo|memo|\u5907\u6ce8|\u5099\u8a3b)$/i;
const boxOfficeDisplayPropertyPattern = /^(?:box\s*office|box\s*office\s*display|\u7968\u623f|\u7968\u623f\u663e\u793a)$/i;
const boxOfficeAmountPropertyPattern = /box\s*office\s*amount|\u7968\u623f.*(?:amount|\u91d1\u989d|\u6570\u503c)/i;
const boxOfficeCurrencyPropertyPattern = /box\s*office\s*currency|\u7968\u623f.*(?:currency|\u8d27\u5e01|\u5e01\u79cd)/i;
const boxOfficeSourcePropertyPattern = /box\s*office\s*source|\u7968\u623f.*(?:source|\u6765\u6e90)/i;
const ratingPropertyPattern = /\u8c46\u74e3\u8bc4\u5206|imdb\u8bc4\u5206|metascore|\u70c2\u756a\u8304|rating|score/i;
const cjkPattern = /[\u3400-\u9fff]/;
const specTitlePattern =
  /\d+(?:\.\d+)?\s*(?:GB|MB)|\b(?:4k|2160p|1080p|720p|480p)\b|\u56fd\u914d|\u666e\u901a\u8bdd|\u7e41\u7b80\u82f1|\u7e41\u7b80|\u7b80\u82f1|\u7b80\u4e2d|\u7e41\u82f1|\u53cc\u8bed|\u4e2d\u5b57|\u5b57\u5e55|\u539f\u76d8|\u84dd\u5149|BD|BluRay|WEB[- ]?DL|HDRip/i;
const subtitleSpecPagePattern =
  /(?:\u666e\u901a\u8bdd|\u56fd\u8bed|\u56fd\u914d|\u7b80|\u7e41|\u82f1|chs|cht|eng|gb)(?:[\s/+\-_.]*(?:\u7b80|\u7e41|\u82f1|\u666e\u901a\u8bdd|\u56fd\u8bed|\u56fd\u914d|chs|cht|eng|gb)){1,}/i;
const sourceGroupTitlePattern = /\u7247\u6e90|\u8d44\u6e90|\bsource\b|\bmedia\b|\bfiles?\b/i;
const ignoredTitlePrefixPattern = /^(?:\u4ec5\u4f9b\u4e0b\u8f7d|\u656c\u8bf7\u671f\u5f85)$/;
const metadataLabelPattern =
  /\u6d77\u62a5|poster|\u57fa\u672c\u4fe1\u606f|\u7b80\u4ecb|imdb|\u8c46\u74e3|douban|rotten|metascore/i;
const imageFilePattern = /\.(webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i;
const nonPlayableFilePattern = /\.(?:7z|zip|rar|tar|gz|bz2|xz|srt|ass|ssa|nfo|txt|pdf)(?:\.\d+)?(?:[?#].*)?$/i;
const notionAssetPageIdPattern =
  /^notion-page-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})(?:-|$)/;
const notionMediaAssetPageIdPattern = /-media-asset-([0-9a-fA-F]{32})(?:-|$)/;

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

function notionPublicSiteUrl() {
  try {
    const url = new URL(process.env.NOTION_PUBLIC_SITE_URL ?? defaultNotionPublicSiteUrl);
    return url.protocol === "https:" ? url : new URL(defaultNotionPublicSiteUrl);
  } catch {
    return new URL(defaultNotionPublicSiteUrl);
  }
}

function spaceIdFromSignedFileUrl(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0];
  } catch {
    return undefined;
  }
}

function notionSignedFileUrl(rawUrl: string, input: { blockId: string; fileName?: string; download?: boolean }) {
  const spaceId = spaceIdFromSignedFileUrl(rawUrl);
  const baseUrl = notionPublicSiteUrl();
  baseUrl.pathname = `/signed/${encodeURIComponent(rawUrl)}`;
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.searchParams.set("table", "block");
  baseUrl.searchParams.set("id", input.blockId);
  if (spaceId) {
    baseUrl.searchParams.set("spaceId", spaceId);
  }
  if (input.fileName) {
    baseUrl.searchParams.set("name", input.fileName);
  }
  if (input.download) {
    baseUrl.searchParams.set("download", "true");
  }
  return baseUrl.toString();
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

function urlsFromRichText(
  value: unknown,
  label: string,
  candidates: MediaCandidate[],
  baseScore: number,
  metadataHints?: NotionMetadataHints
) {
  const textParts: string[] = [];

  for (const item of asArray(value)) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const href = asString(record.href);
    pushCandidate(candidates, href, `${label} link`, baseScore + 8, "url");
    collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), href);
    const plainText = asString(record.plain_text);
    if (plainText) {
      textParts.push(plainText);
    }
  }

  for (const url of textParts.join(" ").match(urlPattern) ?? []) {
    pushCandidate(candidates, url, `${label} text`, baseScore, "text");
  }
  collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), textParts.join(" "));

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
  const directName = asString(asRecord(value)?.name);
  if (directName) {
    return directName;
  }

  const url = mediaUrlFromObject(value);
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : "";
  } catch {
    return "";
  }
}

function collectPropertyCandidates(
  properties: JsonRecord,
  candidates: MediaCandidate[],
  metadataHints?: NotionMetadataHints
) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), `${name} ${propertyText(property)}`);

    const type = asString(property.type);
    if (type === "url") {
      pushCandidate(candidates, asString(property.url), name, 42, "url");
      collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), asString(property.url));
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
      urlsFromRichText(property[type], name, candidates, 32, metadataHints);
    }

    if (type === "formula") {
      const formula = asRecord(property.formula);
      const stringValue = asString(formula?.string);
      for (const url of stringValue.match(urlPattern) ?? []) {
        pushCandidate(candidates, url, `${name} formula`, 30, "text");
      }
      collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), stringValue);
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

function publicTitleFromNotionTitle(title: string) {
  return cleanText(title.replace(/^(?:【敬请期待】|【仅供下载】)\s*/u, ""));
}

function chineseEpisodeNumber(value: string) {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char === "百") {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    const digit = digits[char];
    if (digit === undefined) {
      return undefined;
    }
    current = digit;
  }

  const number = total + current;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function episodeNumberFromLabel(value: string) {
  const cleaned = cleanText(value);
  const patterns = [
    /^(\d{1,3})$/,
    /\bS\d{1,2}E(\d{1,3})\b/i,
    /\b\d{1,2}x(\d{1,3})\b/i,
    /\b(?:Episode|Ep)[\s._-]*(\d{1,3})\b/i,
    /\bE(?:P)?[\s._-]*(\d{1,3})\b/i,
    /第\s*(\d{1,3})\s*[集话話]/u
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const number = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isInteger(number) && number > 0) {
      return number;
    }
  }

  const chineseNumber = chineseEpisodeNumber(cleaned.match(/第\s*([一二两三四五六七八九十百零〇]+)\s*[集话話]/u)?.[1] ?? "");
  if (chineseNumber) {
    return chineseNumber;
  }

  return undefined;
}

function episodeRangeFromText(value: string) {
  const patterns = [
    /\bS\d{1,2}E(\d{1,3})\s*[-~–—至到]\s*(?:S\d{1,2})?E?(\d{1,3})\b/i,
    /\b(?:Episode|Ep)[\s._-]*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\b/i,
    /第\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\s*[集话話]/u
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  return undefined;
}

function canonicalEpisodeLabel(value: string) {
  const number = episodeNumberFromLabel(value);
  return number ? `Episode ${String(number).padStart(2, "0")}` : cleanText(value);
}

function pushUnique(target: string[], value: string | undefined) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const text = match?.[1] ?? match?.[0];
    if (text) {
      return cleanText(text);
    }
  }
  return undefined;
}

function normalizeVideoCodec(value: string) {
  if (/\b(?:h265|h\.265|hevc|x265)\b/i.test(value)) return "HEVC";
  if (/\b(?:h264|h\.264|avc|x264)\b/i.test(value)) return "H.264";
  if (/\bav1\b/i.test(value)) return "AV1";
  return undefined;
}

function extensionFromFileName(value: string) {
  return value.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i)?.[1]?.toLowerCase();
}

function mediaVariantMetadataFromText(label: string, fileName: string | undefined): MediaVariantMetadata | undefined {
  const sourceLabel = cleanText(label);
  const cleanedFileName = cleanText(fileName ?? "");
  const combined = `${sourceLabel} ${cleanedFileName}`.trim();
  const normalized = combined.toLowerCase();
  const audioLanguages: string[] = [];
  const subtitleLanguages: string[] = [];
  const subtitleRegions: string[] = [];

  if (/普通话|普通話|国语|國語|mandarin/.test(combined)) pushUnique(audioLanguages, "zh-Mandarin");
  if (/粤语|粵語|cantonese/.test(combined)) pushUnique(audioLanguages, "zh-Cantonese");
  if (/日语发音|日語發音|japanese audio|\.japanese\.|japanese\.audio/i.test(combined)) pushUnique(audioLanguages, "ja");
  if (/英语发音|英語發音|english audio|\.english\.|english\.audio/i.test(combined)) pushUnique(audioLanguages, "en");
  if (/评论|評論|commentary|\bcmt\b|\bdc\d+\b/i.test(combined)) pushUnique(audioLanguages, "commentary");

  if (/繁简英|繁簡英|chtchseng|chschteng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "en");
  } else if (/简英|簡英|chseng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "en");
  } else if (/繁英|chteng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleLanguages, "en");
  } else if (/简日|簡日|chsjp/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "ja");
  } else {
    if (/简|簡|\bchs\b/i.test(combined)) pushUnique(subtitleLanguages, "zh-Hans");
    if (/繁|cht/i.test(combined)) pushUnique(subtitleLanguages, "zh-Hant");
  }
  if (/繁港|chth/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleRegions, "HK");
  }
  if (/繁台|chtt/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleRegions, "TW");
  }
  if (/日语字幕|日語字幕|\bjp\b/i.test(combined)) pushUnique(subtitleLanguages, "ja");
  if (/英语字幕|英語字幕|\beng\b/i.test(combined)) pushUnique(subtitleLanguages, "en");

  const size = Number(sourceLabel.match(/(\d+(?:\.\d+)?)\s*GB/i)?.[1]);
  const qualityTag = combined.match(/\b((?:I?CQ|CRF)[\s._-]?\d{1,2})\b/i)?.[1]?.replace(/[\s._-]+/g, "").toUpperCase();
  const metadata: MediaVariantMetadata = {
    availability: "playable",
    edition: firstMatch(combined, [
      /Open Matte/i,
      /The Final Cut/i,
      /Extended Collectors? Edition/i,
      /Extended (?:Edition|Cut)/i,
      /Theatrical/i,
      /IMAX/i,
      /公映比例/u,
      /剧场版/u,
      /加长版/u,
      /蓝光加长版/u
    ]),
    resolution: firstMatch(combined, [/\b(?:2160p|1080p|720p|480p)\b/i, /\b4K\b/i])?.toLowerCase(),
    videoCodec: normalizeVideoCodec(combined),
    container: extensionFromFileName(cleanedFileName),
    approximateSizeGb: Number.isFinite(size) ? size : undefined,
    qualityTag,
    audioLanguages: audioLanguages.length > 0 ? audioLanguages : undefined,
    subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
    subtitleRegions: subtitleRegions.length > 0 ? subtitleRegions : undefined,
    commentary: audioLanguages.includes("commentary") || undefined,
    noSubtitles: /无字幕|無字幕|no subtitles/i.test(combined) || undefined,
    sourceLabel,
    fileName: cleanedFileName || undefined
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    })
  ) as MediaVariantMetadata;
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

function checkboxFromNamedProperty(properties: JsonRecord, pattern: RegExp) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const property = asRecord(rawProperty);
    if (property?.type === "checkbox" && typeof property.checkbox === "boolean") {
      return property.checkbox;
    }
  }

  return undefined;
}

function pageHiddenFromWebsite(page: JsonRecord) {
  return checkboxFromNamedProperty(asRecord(page.properties) ?? {}, hideFromWebsitePropertyPattern) === true;
}

function normalizeMediaAvailability(value: string | undefined): MediaAvailability | undefined {
  const normalized = cleanText(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return undefined;
  }
  if (normalized === "playable" || normalized === "可播放") {
    return "playable";
  }
  if (normalized === "source_only" || normalized === "download_only" || normalized === "raw_only" || normalized === "仅供下载" || normalized === "只有原盘") {
    return "source_only";
  }
  if (normalized === "needs_processing" || normalized === "needs_transcode" || normalized === "待加工" || normalized === "待处理") {
    return "needs_processing";
  }
  if (normalized === "blocked" || normalized === "unusable" || normalized === "暂缓" || normalized === "不可用") {
    return "blocked";
  }
  if (normalized === "unknown" || normalized === "未知") {
    return "unknown";
  }
  return undefined;
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

function numberFromNamedProperty(properties: JsonRecord, pattern: RegExp) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const number = numberFromProperty(rawProperty);
    if (number !== undefined) {
      return number;
    }
  }

  return undefined;
}

function urlFromNamedProperty(properties: JsonRecord, pattern: RegExp) {
  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!pattern.test(name)) {
      continue;
    }

    const property = asRecord(rawProperty);
    if (!property) {
      continue;
    }

    if (property.type === "url" && asString(property.url)) {
      return asString(property.url);
    }

    const text = propertyText(property);
    const url = text.match(urlPattern)?.[0];
    if (url) {
      return normalizeUrl(url);
    }
  }

  return undefined;
}

function normalizeMediaAssetType(value: string | undefined): MediaAssetType | undefined {
  const normalized = cleanText(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return undefined;
  }
  if (normalized === "playable_video" || normalized === "video" || normalized === "playable") {
    return "playable_video";
  }
  if (normalized === "source_archive" || normalized === "source" || normalized === "archive") {
    return "source_archive";
  }
  if (normalized === "original_disc" || normalized === "disc" || normalized === "iso") {
    return "original_disc";
  }
  if (normalized === "subtitle_package" || normalized === "subtitle" || normalized === "subtitles") {
    return "subtitle_package";
  }
  if (normalized === "extra" || normalized === "other") {
    return "extra";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return undefined;
}

function normalizeMediaAssetCodec(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return normalizeVideoCodec(value) ?? cleanText(value);
}

function mediaAssetMetadataFromProperties(
  assetPageId: string,
  properties: JsonRecord
): MediaVariantMetadata {
  const availability = normalizeMediaAvailability(
    listFromNamedProperty(properties, mediaAvailabilityPropertyPattern, 1)?.[0]
  );
  const assetType = normalizeMediaAssetType(
    listFromNamedProperty(properties, mediaAssetTypePropertyPattern, 1)?.[0]
  );
  const subtitleLanguages = listFromNamedProperty(properties, subtitleLanguagesPropertyPattern, 12);
  const developerMemo = textFromNamedProperty(properties, developerMemoPropertyPattern, 600);
  const originalFileName = textFromNamedProperty(properties, originalFileNamePropertyPattern, 600);
  const displayLabel = textFromNamedProperty(properties, displayLabelPropertyPattern, 180);
  const episodeRange = episodeRangeFromText(`${displayLabel ?? ""} ${originalFileName ?? ""}`);
  const metadata: MediaVariantMetadata = {
    assetType,
    mediaAssetPageId: assetPageId,
    availability,
    edition: textFromNamedProperty(properties, editionPropertyPattern, 120),
    episodeNumber: numberFromNamedProperty(properties, episodeNumberPropertyPattern) ?? episodeRange?.start,
    episodeEndNumber: numberFromNamedProperty(properties, episodeEndNumberPropertyPattern) ?? episodeRange?.end,
    resolution: listFromNamedProperty(properties, resolutionPropertyPattern, 1)?.[0],
    videoCodec: normalizeMediaAssetCodec(listFromNamedProperty(properties, videoCodecPropertyPattern, 1)?.[0]),
    container: listFromNamedProperty(properties, containerPropertyPattern, 1)?.[0]?.toLowerCase(),
    exactByteSize: numberFromNamedProperty(properties, exactByteSizePropertyPattern),
    approximateSizeGb: numberFromNamedProperty(properties, approximateSizeGbPropertyPattern),
    durationSeconds: numberFromNamedProperty(properties, durationSecondsPropertyPattern),
    frameRate: textFromNamedProperty(properties, frameRatePropertyPattern, 40),
    videoDynamicRange: listFromNamedProperty(properties, videoDynamicRangePropertyPattern, 1)?.[0],
    qualityTag: textFromNamedProperty(properties, qualityTagPropertyPattern, 40),
    audioCodec: listFromNamedProperty(properties, audioCodecPropertyPattern, 1)?.[0],
    audioChannelLayout: textFromNamedProperty(properties, audioChannelLayoutPropertyPattern, 80),
    audioLanguages: listFromNamedProperty(properties, audioLanguagesPropertyPattern, 12),
    subtitleLanguages,
    subtitleRegions: listFromNamedProperty(properties, subtitleRegionsPropertyPattern, 8),
    sourceLineage: listFromNamedProperty(properties, sourceLineagePropertyPattern, 12),
    noSubtitles: subtitleLanguages?.some((value) => /^(?:none|no subtitles|无字幕|無字幕)$/i.test(value)) ||
      /无字幕|無字幕|no subtitles/i.test(`${developerMemo ?? ""} ${originalFileName ?? ""}`) ||
      undefined,
    playbackVerified: checkboxFromNamedProperty(properties, playbackVerifiedPropertyPattern),
    hideFromWebsite: checkboxFromNamedProperty(properties, hideFromWebsitePropertyPattern),
    sourceLabel: displayLabel,
    fileName: originalFileName,
    originalFileName,
    mediaBlockId: textFromNamedProperty(properties, mediaBlockIdPropertyPattern, 120),
    developerMemo,
    structuredSource: "media_assets"
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    })
  ) as MediaVariantMetadata;
}

function parseBoxOfficeAmount(value?: string) {
  if (!value || /^N\/A$/i.test(value.trim())) {
    return undefined;
  }

  const match = value.match(/(?:[$£€¥]\s*)?([\d,]+(?:\.\d+)?)/);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function currencyFromBoxOffice(value?: string) {
  if (!value) {
    return undefined;
  }

  if (/\$|USD|US\$|U\.S\./i.test(value)) {
    return "USD";
  }
  if (/£|GBP/i.test(value)) {
    return "GBP";
  }
  if (/€|EUR/i.test(value)) {
    return "EUR";
  }
  if (/¥|JPY/i.test(value)) {
    return "JPY";
  }

  return undefined;
}

function boxOfficeFromProperties(properties: JsonRecord, updatedAt: string): MovieBoxOffice | undefined {
  const display = textFromNamedProperty(properties, boxOfficeDisplayPropertyPattern, 120);
  const amount = numberFromNamedProperty(properties, boxOfficeAmountPropertyPattern) ?? parseBoxOfficeAmount(display);
  const currency = textFromNamedProperty(properties, boxOfficeCurrencyPropertyPattern, 16) ?? currencyFromBoxOffice(display);
  const source = textFromNamedProperty(properties, boxOfficeSourcePropertyPattern, 32);
  if (!display && amount === undefined && !currency && !source) {
    return undefined;
  }

  return {
    display,
    amount,
    currency,
    source: source?.toLowerCase() === "omdb" ? "omdb" : source ? "notion" : undefined,
    updatedAt
  };
}

function titleKey(entry: MovieTitleEntry) {
  return `${entry.kind}:${entry.lang ?? ""}:${entry.region ?? ""}:${cleanText(entry.title).toLowerCase()}`;
}

function uniqueTitleEntries(entries: MovieTitleEntry[]) {
  const seen = new Set<string>();
  const titles: MovieTitleEntry[] = [];
  for (const entry of entries) {
    const title = cleanText(entry.title);
    if (!title) {
      continue;
    }

    const next = { ...entry, title };
    const key = titleKey(next);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    titles.push(next);
  }

  return titles;
}

function movieTitleEntriesFromProperties(title: string, properties: JsonRecord) {
  const simplifiedChineseTitle = textFromNamedProperty(properties, simplifiedChineseTitlePropertyPattern, 180);
  const traditionalTaiwanTitle = textFromNamedProperty(properties, traditionalChineseTaiwanTitlePropertyPattern, 180);
  const traditionalHongKongTitle = textFromNamedProperty(properties, traditionalChineseHongKongTitlePropertyPattern, 180);
  const originalTitle = textFromNamedProperty(properties, originalTitlePropertyPattern, 180);
  const englishTitle = textFromNamedProperty(properties, englishTitlePropertyPattern, 180);
  const entries: Array<MovieTitleEntry | undefined> = [
    { title, kind: "primary", source: "notion" },
    simplifiedChineseTitle ? { title: simplifiedChineseTitle, kind: "localized", lang: "zh-Hans", source: "notion" } : undefined,
    traditionalTaiwanTitle ? { title: traditionalTaiwanTitle, kind: "localized", lang: "zh-Hant", region: "TW", source: "notion" } : undefined,
    traditionalHongKongTitle ? { title: traditionalHongKongTitle, kind: "localized", lang: "zh-Hant", region: "HK", source: "notion" } : undefined,
    originalTitle ? { title: originalTitle, kind: "original", source: "notion" } : undefined,
    englishTitle ? { title: englishTitle, kind: "alternate", lang: "en", source: "notion" } : undefined
  ];

  return uniqueTitleEntries(entries.filter((entry): entry is MovieTitleEntry => Boolean(entry)));
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

function movieWorkKindFromType(type?: string): MovieWorkKind {
  const normalized = type?.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (/episode|\u96c6/.test(normalized)) {
    return "episode";
  }
  if (/season|\u5b63/.test(normalized)) {
    return "season";
  }
  if (/series|tv|\u5267|\u756a/.test(normalized)) {
    return "series";
  }
  if (/short|\u77ed\u7247/.test(normalized)) {
    return "short";
  }
  if (/special|\u7279\u522b/.test(normalized)) {
    return "special";
  }
  if (/movie|film|\u7535\u5f71/.test(normalized)) {
    return "movie";
  }

  return "unknown";
}

function creditEntries(directors: string[], people: string[]) {
  const credits: MovieCreditEntry[] = [];

  directors.forEach((name, index) => {
    credits.push({
      name,
      department: "directing",
      job: "Director",
      order: index,
      source: "notion"
    });
  });

  people.forEach((name, index) => {
    credits.push({
      name,
      department: "acting",
      job: "Actor",
      order: index,
      source: "notion"
    });
  });

  return credits;
}

function pushPoster(posters: MoviePoster[], seen: Set<string>, url: string | undefined) {
  if (!url || seen.has(url)) {
    return;
  }

  seen.add(url);
  posters.push({
    url,
    source: "notion",
    originalUrl: url
  });
}

function postersFromProperties(page: JsonRecord, properties: JsonRecord) {
  const posters: MoviePoster[] = [];
  const seen = new Set<string>();
  const coverUrl = mediaUrlFromObject(page.cover);
  const fileUrls: string[] = [];
  const textUrls: string[] = [];
  pushPoster(posters, seen, coverUrl);

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
          fileUrls.push(url);
        }
      }
    }

    if (type === "url" && asString(property.url)) {
      textUrls.push(asString(property.url) as string);
    }

    if (type === "rich_text") {
      for (const match of plainTextFromRichText(property.rich_text).matchAll(urlPattern)) {
        textUrls.push(normalizeUrl(match[0]));
      }
    }
  }

  fileUrls.forEach((url) => pushPoster(posters, seen, url));
  textUrls.forEach((url) => pushPoster(posters, seen, url));

  return posters;
}

function movieMetadataFromPage(
  page: JsonRecord,
  properties: JsonRecord,
  title: string,
  metadataHints = createMetadataHints()
): MovieMetadata {
  const releaseDate = dateFromNamedProperty(properties, releaseDatePropertyPattern);
  const imdbId = normalizeImdbId(textFromNamedProperty(properties, imdbPropertyPattern, 120)) ?? metadataHints.externalIds.imdb;
  const doubanSubjectId = normalizeDoubanSubjectId(metadataHints.externalIds.douban);
  const tmdbId = normalizeTmdbId(metadataHints.externalIds.tmdb);
  const posters = postersFromProperties(page, properties);
  const type = listFromNamedProperty(properties, typePropertyPattern, 1)?.[0];
  const year = yearFromTitleOrDate(title, releaseDate);
  const genres = listFromNamedProperty(properties, genrePropertyPattern, 4) ?? [];
  const directors = listFromNamedProperty(properties, directorPropertyPattern, 3) ?? [];
  const people = listFromNamedProperty(properties, peoplePropertyPattern, 4) ?? [];
  const ratings = ratingsFromProperties(properties);
  const credits = creditEntries(directors, people);
  const kind = movieWorkKindFromType(type);
  const updatedAt = asString(page.last_edited_time) || new Date().toISOString();
  const pageId = asString(page.id);
  const pageUrl = asString(page.url);
  const boxOffice = boxOfficeFromProperties(properties, updatedAt);
  const hideFromWebsite = checkboxFromNamedProperty(properties, hideFromWebsitePropertyPattern) === true;
  const mediaAvailability = normalizeMediaAvailability(
    listFromNamedProperty(properties, mediaAvailabilityPropertyPattern, 1)?.[0]
  );
  const aiSuggestedMinimumAge = numberFromNamedProperty(properties, aiSuggestedMinimumAgePropertyPattern);
  const manualAgeOverride = numberFromNamedProperty(properties, manualAgeOverridePropertyPattern);
  const effectiveMinimumAge = manualAgeOverride ?? aiSuggestedMinimumAge;
  const titles = movieTitleEntriesFromProperties(title, properties);
  const displayTitle =
    titles.find((entry) => entry.kind === "localized" && entry.lang === "zh-Hans")?.title ??
    titles.find((entry) => entry.kind === "localized" && entry.lang === "zh-Hant" && entry.region === "TW")?.title ??
    titles.find((entry) => entry.kind === "localized" && entry.lang === "zh-Hant" && entry.region === "HK")?.title ??
    title;
  const workId = stableMovieWorkIdFromNotion(pageId, title, year);
  const externalIds = Object.fromEntries(
    Object.entries({
      imdb: imdbId,
      douban: doubanSubjectId,
      tmdb: tmdbId,
      rottenTomatoes: metadataHints.externalIds.rottenTomatoes,
      metacritic: metadataHints.externalIds.metacritic
    }).filter(([, value]) => Boolean(value))
  );
  const hasExternalIds = Object.keys(externalIds).length > 0;
  const metadata: MovieMetadata = {
    workId,
    kind,
    titles,
    release: {
      year,
      date: releaseDate,
      source: "notion"
    },
    credits,
    boxOffice,
    sourceRefs: [{
      source: "notion",
      id: pageId,
      url: pageUrl,
      title,
      observedAt: updatedAt
    }],
    dataQuality: {
      status: hasExternalIds && credits.length > 0 ? "partial" : "draft",
      missing: [
        !hasExternalIds ? "externalIds" : undefined,
        !releaseDate && !year ? "release" : undefined,
        credits.length === 0 ? "credits" : undefined,
        posters.length === 0 ? "poster" : undefined
      ].filter((value): value is "externalIds" | "release" | "credits" | "poster" => Boolean(value)),
      updatedAt
    },
    display: {
      title: displayTitle,
      year,
      directorLine: directors.join(" / ") || undefined,
      castLine: people.join(" / ") || undefined
    },
    work: {
      workId,
      kind,
      titles,
      release: {
        year,
        date: releaseDate,
        source: "notion"
      },
      externalIds: hasExternalIds ? externalIds : undefined,
      genres,
      credits,
      ratings: ratings.map((rating) => ({ ...rating, source: "notion" })),
      boxOffice,
      media: {
        posters
      },
      sourceRefs: [{
        source: "notion",
        id: pageId,
        url: pageUrl,
        title,
        observedAt: updatedAt
      }],
      dataQuality: {
        status: hasExternalIds && credits.length > 0 ? "partial" : "draft",
        missing: [
          !hasExternalIds ? "externalIds" : undefined,
          !releaseDate && !year ? "release" : undefined,
          credits.length === 0 ? "credits" : undefined,
          posters.length === 0 ? "poster" : undefined
        ].filter((value): value is "externalIds" | "release" | "credits" | "poster" => Boolean(value)),
        updatedAt
      },
      display: {
        title: displayTitle,
        year,
        directorLine: directors.join(" / ") || undefined,
        castLine: people.join(" / ") || undefined
      },
      updatedAt
    },
    posterUrl: posters[0]?.url,
    posters,
    type,
    releaseDate,
    year,
    genres,
    directors,
    people,
    ratings,
    boxOfficeDisplay: boxOffice?.display,
    boxOfficeAmount: boxOffice?.amount,
    boxOfficeCurrency: boxOffice?.currency,
    ratingLevel: listFromNamedProperty(properties, ratingLevelPropertyPattern, 3),
    aiSuggestedMinimumAge,
    aiAgeConfidence: listFromNamedProperty(properties, aiAgeConfidencePropertyPattern, 1)?.[0],
    contentRiskTags: listFromNamedProperty(properties, contentRiskTagsPropertyPattern, 12),
    aiAgeReason: textFromNamedProperty(properties, aiAgeReasonPropertyPattern, 600),
    manualAgeOverride,
    effectiveMinimumAge,
    info: textFromNamedProperty(properties, infoPropertyPattern, 180),
    description: textFromNamedProperty(properties, descriptionPropertyPattern, 4000),
    imdbId,
    mediaAvailability,
    hideFromWebsite,
    externalIds: hasExternalIds ? externalIds : undefined
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
        return publicTitleFromNotionTitle(title);
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

function collectBlockCandidates(
  block: JsonRecord,
  candidates: MediaCandidate[],
  metadataHints?: NotionMetadataHints
) {
  const type = asString(block.type);
  const payload = asRecord(block[type]);
  if (!payload) {
    return;
  }

  if (type === "video") {
    const label = cleanText(plainTextFromRichText(payload.caption)) || fileNameFromObject(payload) || "video";
    const rawUrl = mediaUrlFromObject(payload.video ?? payload);
    const blockId = asString(block.id);
    const url = rawUrl && blockId && notionHostedFilePattern.test(rawUrl)
      ? notionSignedFileUrl(rawUrl, { blockId, fileName: label, download: true })
      : rawUrl;
    pushCandidate(candidates, url, label, 90, "video");
  }

  if (type === "file" || type === "audio" || type === "pdf") {
    const label = cleanText(plainTextFromRichText(payload.caption)) || fileNameFromObject(payload) || type;
    const rawUrl = mediaUrlFromObject(payload);
    const blockId = asString(block.id);
    const url = rawUrl && blockId && notionHostedFilePattern.test(rawUrl)
      ? notionSignedFileUrl(rawUrl, { blockId, fileName: label, download: true })
      : rawUrl;
    pushCandidate(candidates, url, label, 76, "file");
  }

  if (type === "embed" || type === "bookmark" || type === "link_preview") {
    pushCandidate(candidates, asString(payload.url), type, 52, "embed");
    collectMetadataHintsFromText(metadataHints ?? createMetadataHints(), asString(payload.url));
  }

  if ("rich_text" in payload) {
    urlsFromRichText(payload.rich_text, type, candidates, 34, metadataHints);
  }

  if (type === "table_row") {
    for (const cell of asArray(payload.cells)) {
      urlsFromRichText(cell, "table row", candidates, 28, metadataHints);
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

function mediaAssetVariantAssetKey(sourcePageId: string | undefined, mediaAssetPageId: string) {
  const pageId = sourcePageId || mediaAssetPageId;
  return `notion-page-${pageId}-media-asset-${mediaAssetPageId.replace(/-/g, "")}`;
}

function pageIdFromAssetKey(assetKey: string) {
  return assetKey.match(notionAssetPageIdPattern)?.[1];
}

function mediaAssetPageIdFromAssetKey(assetKey: string) {
  return assetKey.match(notionMediaAssetPageIdPattern)?.[1];
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
    metadata: {
      ...result.metadata,
      ...variant.metadata
    }
  };
}

function hasPlayableMedia(result: SearchResult) {
  return (result.variants?.length ?? 0) > 0;
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

function textIncludesEither(left: string | undefined, right: string | undefined) {
  const normalizedLeft = left?.trim().toLowerCase();
  const normalizedRight = right?.trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function titleTail(title: string | undefined) {
  const parts = title?.split("/") ?? [];
  return parts[parts.length - 1]?.trim();
}

function fallbackResultForPage(result: SearchResult, pageId: string, inputTitle?: string) {
  const pageVariants = result.variants?.filter((variant) => variant.sourcePageId === pageId) ?? [];
  const wantedTail = titleTail(inputTitle);
  const labelMatch = pageVariants.find((variant) => textIncludesEither(variant.label, wantedTail));

  if (labelMatch) {
    return variantToSearchResult(result, labelMatch);
  }

  if (pageVariants.length === 1) {
    return variantToSearchResult(result, pageVariants[0]);
  }

  if (result.sourcePageId === pageId) {
    return result;
  }

  return undefined;
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

  if (specTitlePattern.test(title) || subtitleSpecPagePattern.test(title)) {
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

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

function isTransientNotionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = asString(asRecord(error)?.code);
  const status = Number(asRecord(error)?.status);
  return code === "notionhq_client_response_error" ||
    code === "rate_limited" ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /^Timed out while parsing Notion page\b/.test(message) ||
    /\b(?:429|502|503|504)\b/.test(message);
}

let notionDnsOverrideInstalled = false;

function installNotionDnsOverride() {
  const notionApiIp = process.env.NOTION_API_RESOLVE_IP?.trim();
  if (!notionApiIp || notionDnsOverrideInstalled) {
    return;
  }

  const originalLookup = dns.lookup.bind(dns) as (...args: unknown[]) => unknown;
  dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") {
        options(null, notionApiIp, 4);
        return;
      }
      if (typeof callback === "function") {
        if (options && typeof options === "object" && "all" in options && options.all) {
          callback(null, [{ address: notionApiIp, family: 4 }]);
          return;
        }
        callback(null, notionApiIp, 4);
        return;
      }
    }
    return originalLookup(hostname, options, callback);
  }) as typeof dns.lookup;
  notionDnsOverrideInstalled = true;
}

export class NotionSearchSource {
  readonly description: string;
  private readonly notion: Client;
  private readonly libraryRootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
  private readonly configuredLibraryDataSourceId =
    process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
  private readonly configuredLibraryDatabaseId =
    process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;
  private readonly configuredMediaAssetsDataSourceId = process.env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID;
  private readonly configuredMediaAssetsDatabaseId = process.env.NOTION_MEDIA_ASSETS_DATABASE_ID;
  private libraryMetadata?: Promise<LibraryMetadata | undefined>;
  private mediaAssetsMetadata?: Promise<LibraryMetadata | undefined>;

  constructor(private readonly options = defaultOptions) {
    installNotionDnsOverride();
    this.notion = new Client({
      auth: process.env.NOTION_READ_ONLY_TOKEN,
      timeoutMs: this.options.requestTimeoutMs
    });
    this.description = this.hasLibraryConfig()
      ? this.hasMediaAssetsConfig()
        ? "notion library database search with media assets"
        : "notion library database search"
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

  async *scanLibraryResults(options: NotionLibraryScanOptions = {}): AsyncGenerator<NotionLibraryScanItem> {
    const library = await this.getLibraryMetadata();
    if (!library) {
      throw new Error("A Notion library database is required for metadata index sync.");
    }

    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : Infinity;
    const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 25)));
    const delayMs = Math.max(0, Math.floor(options.delayMs ?? 0));
    const since = options.since ? new Date(options.since).toISOString() : undefined;
    let yielded = 0;
    let startCursor: string | undefined;
    let shouldStop = false;

    do {
      const response = await this.notion.dataSources.query({
        data_source_id: library.dataSourceId,
        page_size: Number.isFinite(limit)
          ? Math.min(pageSize, Math.max(1, limit - yielded))
          : pageSize,
        start_cursor: startCursor,
        result_type: "page",
        sorts: [
          {
            timestamp: "last_edited_time",
            direction: "descending"
          }
        ]
      } as never);

      for (const rawPage of response.results.filter(isPageResult)) {
        const page = rawPage as JsonRecord;
        if (yielded >= limit) {
          shouldStop = true;
          break;
        }

        if (page.archived === true || page.in_trash === true) {
          continue;
        }

        const lastEditedTime = asString(page.last_edited_time) || new Date().toISOString();
        if (since && lastEditedTime <= since) {
          shouldStop = true;
          break;
        }

        const properties = asRecord(page.properties) ?? {};
        const title = titleFromProperties(properties);
        if (pageHiddenFromWebsite(page)) {
          yield {
            pageId: asString(page.id),
            title,
            lastEditedTime,
            deleteAssetKey: `notion-page-${asString(page.id)}`,
            skipped: "hidden_from_website"
          };
          yielded += 1;
          if (delayMs > 0) {
            await sleep(delayMs);
          }
          continue;
        }

        try {
          const result = await this.pageToSearchResultWithRetry(page, { libraryMode: true });
          if (!hasPlayableMedia(result)) {
            yield {
              pageId: asString(page.id),
              title,
              lastEditedTime,
              deleteAssetKey: `notion-page-${asString(page.id)}`,
              skipped: "no_playable_media"
            };
            yielded += 1;
            if (delayMs > 0) {
              await sleep(delayMs);
            }
            continue;
          }

          yield {
            pageId: asString(page.id),
            title,
            lastEditedTime,
            result
          };
        } catch (error) {
          yield {
            pageId: asString(page.id),
            title,
            lastEditedTime,
            error: error instanceof Error ? error.message : "Could not parse Notion library page."
          };
        }

        yielded += 1;
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (!shouldStop && startCursor && yielded < limit);
  }

  async refreshAsset(input: {
    assetKey: string;
    sourcePageId?: string;
    title?: string;
    sourceBreadcrumb?: string[];
    mediaBlockId?: string;
    mediaAssetPageId?: string;
  }): Promise<SearchResult | undefined> {
    const mediaAssetPageId = input.mediaAssetPageId ?? mediaAssetPageIdFromAssetKey(input.assetKey);
    if (mediaAssetPageId) {
      const refreshed = await this.resultFromMediaAssetPageId(mediaAssetPageId, input);
      if (refreshed) {
        return refreshed;
      }
    }

    if (input.mediaBlockId) {
      const candidate = await this.mediaCandidateFromBlockId(input.mediaBlockId, input.sourcePageId);
      if (candidate?.url && isLikelyPlayableCandidate(candidate)) {
        const metadata: MediaVariantMetadata = {
          mediaBlockId: input.mediaBlockId,
          mediaAssetPageId,
          structuredSource: "media_assets"
        };
        return {
          assetKey: input.assetKey,
          title: input.title ?? input.sourceBreadcrumb?.join(" / ") ?? input.assetKey,
          source: "Notion library",
          sourceUrl: candidate.url,
          sourcePageId: input.sourcePageId,
          sourceBreadcrumb: input.sourceBreadcrumb,
          durationLabel: "--",
          updatedAt: new Date().toISOString(),
          summary: candidateSummary(candidate),
          metadata
        };
      }
    }

    const pageId = input.sourcePageId ?? pageIdFromAssetKey(input.assetKey);
    if (!pageId) {
      return undefined;
    }

    const library = await this.getLibraryMetadata();
    const page = await this.notion.pages.retrieve({ page_id: pageId });
    if (pageHiddenFromWebsite(page as JsonRecord)) {
      return undefined;
    }
    const result = await this.pageToSearchResult(page as JsonRecord, {
      libraryMode: Boolean(library)
    });
    if (library && !hasPlayableMedia(result)) {
      return undefined;
    }

    const exact = findResultByAssetKey([result], input.assetKey);
    if (exact) {
      return exact;
    }

    const fallback = fallbackResultForPage(result, pageId, input.title);
    return fallback ? { ...fallback, assetKey: input.assetKey } : undefined;
  }

  private async resultFromMediaAssetPageId(
    mediaAssetPageId: string,
    input: {
      assetKey: string;
      sourcePageId?: string;
      title?: string;
      sourceBreadcrumb?: string[];
    }
  ) {
    try {
      const page = await this.notion.pages.retrieve({ page_id: mediaAssetPageId });
      const workTitle = input.sourceBreadcrumb?.[0] ?? input.title ?? input.assetKey;
      const variant = await this.mediaAssetPageToVariant(page as JsonRecord, 0, workTitle, input.sourcePageId);
      if (!variant) {
        return undefined;
      }

      return {
        assetKey: input.assetKey,
        title: input.title ?? variant.sourceBreadcrumb?.join(" / ") ?? variant.label,
        source: "Notion library",
        sourceUrl: variant.sourceUrl,
        sourcePageId: variant.sourcePageId ?? input.sourcePageId,
        sourceBreadcrumb: variant.sourceBreadcrumb ?? input.sourceBreadcrumb,
        durationLabel: "--",
        updatedAt: asString((page as JsonRecord).last_edited_time) || new Date().toISOString(),
        summary: variant.summary,
        metadata: variant.metadata
      } satisfies SearchResult;
    } catch {
      return undefined;
    }
  }

  private hasLibraryConfig() {
    return Boolean(
      this.libraryRootPageId ||
      this.configuredLibraryDataSourceId ||
      this.configuredLibraryDatabaseId
    );
  }

  private hasMediaAssetsConfig() {
    return Boolean(
      this.configuredMediaAssetsDataSourceId ||
      this.configuredMediaAssetsDatabaseId
    );
  }

  private async getLibraryMetadata() {
    this.libraryMetadata ??= this.loadLibraryMetadata();
    return this.libraryMetadata;
  }

  private async getMediaAssetsMetadata() {
    if (!this.hasMediaAssetsConfig()) {
      return undefined;
    }

    this.mediaAssetsMetadata ??= this.loadMediaAssetsMetadata();
    return this.mediaAssetsMetadata;
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

  private async loadMediaAssetsMetadata(): Promise<LibraryMetadata | undefined> {
    try {
      if (this.configuredMediaAssetsDataSourceId) {
        return this.loadDataSourceMetadata(this.configuredMediaAssetsDataSourceId);
      }

      if (this.configuredMediaAssetsDatabaseId) {
        return this.loadDatabaseMetadata(this.configuredMediaAssetsDatabaseId);
      }
    } catch {
      return undefined;
    }

    return undefined;
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
        databaseTitle,
        properties
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

    const pages = this.rankPages([...pagesById.values()].filter((page) => !pageHiddenFromWebsite(page)), query)
      .slice(0, this.options.searchPageSize);
    const results: SearchResult[] = [];
    for (const page of pages) {
      const result = await this.pageToSearchResult(page, { libraryMode: true });
      if (hasPlayableMedia(result)) {
        results.push(result);
      }
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

  private mediaAssetsWorkPropertyName(mediaAssets: LibraryMetadata) {
    const properties = mediaAssets.properties ?? {};
    if (properties.Work) {
      return "Work";
    }

    for (const [name, property] of Object.entries(properties)) {
      const type = asString(asRecord(property)?.type);
      if (type === "relation" && /^(?:work|\u4f5c\u54c1|\u5f71\u7247)$/i.test(name)) {
        return name;
      }
    }

    return undefined;
  }

  private async queryMediaAssetPagesForWork(workPageId: string) {
    const mediaAssets = await this.getMediaAssetsMetadata();
    const workProperty = mediaAssets ? this.mediaAssetsWorkPropertyName(mediaAssets) : undefined;
    if (!mediaAssets || !workProperty) {
      return [];
    }

    const queryForId = async (pageId: string) => {
      const pages: JsonRecord[] = [];
      let startCursor: string | undefined;

      do {
        const response = await this.notion.dataSources.query({
          data_source_id: mediaAssets.dataSourceId,
          page_size: 100,
          start_cursor: startCursor,
          filter: {
            property: workProperty,
            relation: {
              contains: pageId
            }
          }
        } as never);

        pages.push(...response.results.filter(isPageResult));
        startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
      } while (startCursor);

      return pages;
    };

    try {
      const pages = await queryForId(workPageId);
      if (pages.length > 0 || !workPageId.includes("-")) {
        return pages;
      }

      return queryForId(workPageId.replace(/-/g, ""));
    } catch {
      return [];
    }
  }

  private async mediaCandidateFromBlockFileDownloadUrl(blockId: string, pageBlockId: string | undefined) {
    if (!pageBlockId) {
      return undefined;
    }

    try {
      const apiUrl = new URL("/api/v3/getBlockFileDownloadUrl", notionPublicSiteUrl());
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          blockId,
          pageBlockId,
          meta: {
            name: "downloadSource"
          }
        }),
        signal: AbortSignal.timeout(this.options.requestTimeoutMs)
      });
      if (!response.ok) {
        return undefined;
      }

      const payload = await response.json() as JsonRecord;
      const rawUrl = asString(payload.url);
      if (!rawUrl) {
        return undefined;
      }
      const fileName = asString(payload.fileName);
      return {
        url: notionSignedFileUrl(rawUrl, { blockId, fileName, download: true }),
        label: fileName || "downloadSource",
        score: mediaScore(rawUrl, 100),
        kind: "file" as const
      };
    } catch {
      return undefined;
    }
  }

  private async mediaCandidateFromBlockId(blockId: string | undefined, pageBlockId?: string) {
    if (!blockId) {
      return undefined;
    }

    try {
      const downloadCandidate = await this.mediaCandidateFromBlockFileDownloadUrl(blockId, pageBlockId);
      if (downloadCandidate) {
        return downloadCandidate;
      }

      const block = await this.notion.blocks.retrieve({ block_id: blockId });
      const candidates: MediaCandidate[] = [];
      collectBlockCandidates(block as JsonRecord, candidates);
      return uniqueCandidates(candidates).find(isLikelyPlayableCandidate) ?? chooseBestCandidate(candidates);
    } catch {
      return undefined;
    }
  }

  private async mediaAssetPageToVariant(
    page: JsonRecord,
    index: number,
    workTitle: string,
    fallbackSourcePageId?: string
  ): Promise<MediaVariant | undefined> {
    if (page.archived === true || page.in_trash === true) {
      return undefined;
    }

    const properties = asRecord(page.properties) ?? {};
    const mediaAssetPageId = asString(page.id);
    const metadata = mediaAssetMetadataFromProperties(mediaAssetPageId, properties);
    if (metadata.hideFromWebsite === true || metadata.availability !== "playable" || metadata.assetType !== "playable_video") {
      return undefined;
    }

    const sourcePageId = textFromNamedProperty(properties, sourcePageIdPropertyPattern, 120) ?? fallbackSourcePageId;
    const mediaBlockId = metadata.mediaBlockId;
    const label = metadata.sourceLabel || titleFromProperties(properties);
    const blockCandidate = await this.mediaCandidateFromBlockId(mediaBlockId, sourcePageId);
    const assetUrl = urlFromNamedProperty(properties, assetUrlPropertyPattern);
    const candidate = blockCandidate ?? (
      assetUrl
        ? {
            url: assetUrl,
            label: metadata.originalFileName || label,
            score: mediaScore(assetUrl, 80),
            kind: "file" as const
          }
        : undefined
    );

    if (!candidate?.url || !isLikelyPlayableCandidate(candidate)) {
      return undefined;
    }

    return {
      assetKey: mediaAssetVariantAssetKey(sourcePageId, mediaAssetPageId),
      label: label || `Media asset ${index + 1}`,
      sourceUrl: candidate.url,
      sourcePageId,
      sourceBreadcrumb: [workTitle, label].filter(Boolean),
      kind: candidate.kind,
      summary: `Structured Media Assets row${metadata.playbackVerified ? " with verified playback" : ""}.`,
      metadata: {
        ...metadata,
        mediaBlockId
      }
    };
  }

  private async mediaAssetVariantsForWork(workPageId: string, workTitle: string) {
    const pages = await this.queryMediaAssetPagesForWork(workPageId);
    const variants: MediaVariant[] = [];

    for (const page of pages) {
      const variant = await this.mediaAssetPageToVariant(page, variants.length, workTitle, workPageId);
      if (!variant) {
        continue;
      }

      variants.push(variant);
      if (variants.length >= this.options.variantLimit) {
        break;
      }
    }

    return variants;
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
      if (pageHiddenFromWebsite(page)) {
        continue;
      }
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

  private async pageToSearchResultWithRetry(
    page: JsonRecord,
    context: { libraryMode?: boolean } = {}
  ) {
    const pageId = asString(page.id);
    const retries = Math.max(0, Math.floor(this.options.scanPageParseRetries));
    const baseDelayMs = Math.max(0, Math.floor(this.options.scanPageParseRetryDelayMs));
    let attempt = 0;

    while (true) {
      try {
        return await withTimeout(
          this.pageToSearchResult(page, context),
          this.options.scanPageParseTimeoutMs,
          `Timed out while parsing Notion page ${pageId}.`
        );
      } catch (error) {
        if (attempt >= retries || !isTransientNotionError(error)) {
          throw error;
        }
        attempt += 1;
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  private async pageToSearchResult(
    page: JsonRecord,
    context: { libraryMode?: boolean } = {}
  ): Promise<SearchResult> {
    const properties = asRecord(page.properties) ?? {};
    const candidates: MediaCandidate[] = [];
    const childPages: ChildPageCandidate[] = [];
    const metadataHints = createMetadataHints();
    collectPropertyCandidates(properties, candidates, metadataHints);

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
        context.libraryMode ? childPages : undefined,
        metadataHints
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
    const metadata = movieMetadataFromPage(page, properties, title, metadataHints);
    const pageUrl = asString(page.url);
    const pageId = asString(page.id);
    const sourceBreadcrumb = [title].filter(Boolean);
    const parsedVariants = context.libraryMode
      ? await this.libraryVariants(pageId, title, unique, childPages)
      : this.candidatesToVariants(pageId, unique, 0, sourceBreadcrumb);
    const mediaAssetVariants = context.libraryMode
      ? await this.mediaAssetVariantsForWork(pageId, title)
      : [];
    const variants = mediaAssetVariants.length > 0 ? mediaAssetVariants : parsedVariants;
    const sourceUrl = variants[0]?.sourceUrl || best?.url || pageUrl;
    const summary = context.libraryMode
      ? this.librarySummary(variants)
      : this.globalSummary(best);

    return {
      assetKey: `notion-page-${pageId}`,
      title,
      source: context.libraryMode ? "Notion library" : "Notion",
      sourceUrl,
      sourcePageId: pageId,
      sourceBreadcrumb,
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
        variants.push(this.candidateToVariant(
          childPage.id,
          best,
          variants.length,
          childPage.title,
          [title, childPage.title]
        ));
        if (variants.length >= this.options.variantLimit) {
          return variants;
        }
      }

      for (const episodePage of nestedChildPages) {
        const episodeLabel = canonicalEpisodeLabel(episodePage.title);
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
              ? `${childPage.title} / ${episodeLabel}`
              : `${childPage.title} / ${episodeLabel} / ${episodeCandidate.label}`,
            [title, childPage.title, episodeLabel]
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
      variants.length,
      [title]
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
    indexOffset = 0,
    sourceBreadcrumb?: string[]
  ): MediaVariant[] {
    return candidates
      .filter((candidate) => candidate.score >= 20)
      .slice(0, Math.max(0, this.options.variantLimit - indexOffset))
      .map((candidate, index) =>
        this.candidateToVariant(pageId, candidate, index + indexOffset, undefined, sourceBreadcrumb)
      );
  }

  private candidateToVariant(
    pageId: string,
    candidate: MediaCandidate,
    index: number,
    label?: string,
    sourceBreadcrumb?: string[]
  ): MediaVariant {
    const variantLabel = label || candidate.label || `Option ${index + 1}`;
    const metadata = mediaVariantMetadataFromText(variantLabel, candidate.label);
    return {
      assetKey: variantAssetKey(pageId, candidate, index),
      label: variantLabel,
      sourceUrl: candidate.url,
      sourcePageId: pageId,
      sourceBreadcrumb,
      kind: candidate.kind,
      summary: candidateSummary(candidate),
      metadata: metadata
        ? { ...metadata, structuredSource: "notion_page" }
        : { structuredSource: "notion_page" }
    };
  }

  private librarySummary(variants: MediaVariant[]) {
    if (variants.length === 0) {
      return "这条影片暂时没有可播放规格。";
    }

    return `已整理 ${variants.length} 个可播放规格，可直接选择版本观看。`;
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
    childPages?: ChildPageCandidate[],
    metadataHints?: NotionMetadataHints
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
        collectBlockCandidates(record, candidates, metadataHints);

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
            childPages,
            metadataHints
          );
        }
      }

      startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (startCursor && counter.count < this.options.blockLimit);
  }
}
