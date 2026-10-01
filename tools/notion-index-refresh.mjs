#!/usr/bin/env node

import "./lib/project-env.mjs";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--title") options.title = args[++index];
    else if (arg === "--asset-key") options.assetKey = args[++index];
    else if (arg === "--backend") options.backend = args[++index];
    else if (arg === "--home") options.home = true;
    else if (arg === "--resolve-ip") options.resolveIp = args[++index];
    else if (arg === "--local-address") options.localAddress = args[++index];
    else if (arg === "--no-proxy") options.noProxy = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId) throw new Error("--page-id is required.");
  if (options.backend && !new Set(["local", "azure"]).has(options.backend)) {
    throw new Error("--backend must be local or azure.");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.home) {
    options.backend = "local";
    const path = await import("node:path");
    process.env.WWPDW_LOCAL_DATA_DIR = path.resolve(process.env.WWPDW_HOME_DATA_DIR || ".local-data/home-site");
  }
  if (options.resolveIp) process.env.NOTION_API_RESOLVE_IP = options.resolveIp;
  if (options.localAddress) process.env.NOTION_API_LOCAL_ADDRESS = options.localAddress;
  if (options.noProxy) {
    process.env.NOTION_PROXY_URL = "";
    process.env.HTTP_PROXY = "";
    process.env.HTTPS_PROXY = "";
    process.env.ALL_PROXY = "";
  }
  if (options.backend) process.env.SEARCH_INDEX_BACKEND = options.backend;
  await import("tsx/esm");
  const [notionSource, indexedRefresh, cacheStore] = await Promise.all([
    import("../apps/api/src/notion-source.ts"),
    import("../apps/api/src/indexed-asset-refresh.ts"),
    import("@wwpdw/cache-store")
  ]);
  const { NotionSearchSource } = notionSource;
  const { prepareIndexedAssetRefresh } = indexedRefresh;
  const { createSearchIndexStore, createCacheStore } = cacheStore;
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
