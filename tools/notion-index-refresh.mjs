#!/usr/bin/env node

import "dotenv/config";
import { NotionSearchSource } from "../apps/api/src/notion-source.ts";
import { prepareIndexedAssetRefresh } from "../apps/api/src/indexed-asset-refresh.ts";
import { createSearchIndexStore, createCacheStore } from "@wwpdw/cache-store";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--title") options.title = args[++index];
    else if (arg === "--asset-key") options.assetKey = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId) throw new Error("--page-id is required.");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pageId = `${options.pageId}`.trim();
  const assetKey = `${options.assetKey ?? `notion-page-${pageId}`}`.trim();
  const searchIndex = createSearchIndexStore();
  const posterCache = createCacheStore(searchIndex.backend === "azure" ? "azure" : process.env.CACHE_BACKEND === "filesystem" ? "filesystem" : "local");
  const source = new NotionSearchSource();
  const incoming = await source.refreshAsset({
    assetKey,
    sourcePageId: pageId,
    title: options.title
  });
  if (!incoming) throw new Error(`Could not refresh Notion page ${pageId}.`);
  const result = await prepareIndexedAssetRefresh(incoming, searchIndex, posterCache, {
    refreshPosters: async () => (await source.refreshAsset({ assetKey, sourcePageId: pageId, title: options.title }))?.metadata?.posters
  });
  await searchIndex.upsertResult(result);
  const credits = result.metadata?.work?.credits ?? result.metadata?.credits ?? [];
  console.log(JSON.stringify({
    status: "ok",
    pageId,
    assetKey,
    index: searchIndex.description,
    title: result.title,
    posterCount: result.metadata?.posters?.length ?? 0,
    uncachedPosterCount: result.metadata?.posters?.filter(poster => !poster.blobName && !poster.url.startsWith("/api/posters/")).length ?? 0,
    creditCount: credits.length,
    linkedCreditCount: credits.filter((credit) => Boolean(credit.personId)).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
