import type { SearchResult } from "@wwpdw/shared";
import type { BrowseChannel } from "./types";

function normalizedMetadataText(result: SearchResult) {
  const metadata = result.metadata;
  const work = metadata?.work;
  return [
    result.title,
    result.sourceBreadcrumb?.join(" "),
    metadata?.kind,
    work?.kind,
    metadata?.type,
    metadata?.ratingLevel?.join(" "),
    metadata?.genres?.join(" "),
    work?.genres?.join(" "),
    metadata?.display?.title,
    metadata?.display?.subtitle,
    work?.display?.title,
    work?.display?.subtitle,
    metadata?.titles?.map((title) => title.title).join(" "),
    work?.titles?.map((title) => title.title).join(" "),
    metadata?.info,
    metadata?.description,
    metadata?.external?.omdb?.type,
    metadata?.external?.omdb?.genres?.join(" "),
    metadata?.external?.omdb?.plot
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function explicitBrowseKind(result: SearchResult): "movie" | "tv" | undefined {
  const kind = result.metadata?.work?.kind ?? result.metadata?.kind;
  if (kind === "series" || kind === "season" || kind === "episode") {
    return "tv";
  }
  if (kind === "movie" || kind === "short" || kind === "special") {
    return "movie";
  }

  const type = result.metadata?.type?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }

  if (/\bmovie\b|\bfilm\b|电影/.test(type)) {
    return "movie";
  }

  if (/\btv\b|\bseries\b|\bseason\b|\bshow\b|电视|电视剧|剧集|影集/.test(type)) {
    return "tv";
  }

  return undefined;
}

export function resultMatchesBrowseChannel(result: SearchResult, channel: BrowseChannel) {
  if (channel === "recommended") {
    return true;
  }

  const text = normalizedMetadataText(result);
  if (channel === "animation") {
    return /动画|動畫|动漫|動漫|番剧|番劇|anime|animation|animated/.test(text);
  }

  const explicitKind = explicitBrowseKind(result);
  if (explicitKind) {
    return channel === explicitKind;
  }

  if (channel === "tv") {
    return /电视|电视剧|剧集|影集|tv|series|season|show/.test(text);
  }

  return /电影|movie|film/.test(text) && !/电视|电视剧|剧集|影集|tv series|series/.test(text);
}
