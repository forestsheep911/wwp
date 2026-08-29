#!/usr/bin/env node

import "dotenv/config";
import { NotionSearchSource } from "../apps/api/src/notion-source.ts";
import { preserveIndexedPersonCredits } from "../apps/api/src/person-credit-index-merge.ts";
import { createSearchIndexStore } from "@wwpdw/cache-store";

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
  const source = new NotionSearchSource();
  const incoming = await source.refreshAsset({
    assetKey,
    sourcePageId: pageId,
    title: options.title
  });
  if (!incoming) throw new Error(`Could not refresh Notion page ${pageId}.`);
  const result = preserveIndexedPersonCredits(incoming, await searchIndex.getResult(assetKey));
  await searchIndex.upsertResult(result);
  const credits = result.metadata?.work?.credits ?? result.metadata?.credits ?? [];
  console.log(JSON.stringify({
    status: "ok",
    pageId,
    assetKey,
    index: searchIndex.description,
    title: result.title,
    creditCount: credits.length,
    linkedCreditCount: credits.filter((credit) => Boolean(credit.personId)).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
