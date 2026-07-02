import {
  type ResolveResult,
  type SearchResult,
  mockSearchResults
} from "@wwpdw/shared";
import { resolveWithAiFallback } from "./ai-resolver.js";

const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;

function observedAt() {
  return new Date().toISOString();
}

function resultFor(
  input: Omit<ResolveResult, "observedAt">
): ResolveResult {
  return {
    ...input,
    observedAt: observedAt()
  };
}

function resolveByRule(asset: SearchResult): ResolveResult {
  if (directFilePattern.test(asset.sourceUrl) || notionHostedFilePattern.test(asset.sourceUrl)) {
    return resultFor({
      kind: "direct_file",
      layer: "rule",
      confidence: 0.92,
      url: asset.sourceUrl,
      notes: "Source URL matched a known playable file extension or Notion-hosted file URL."
    });
  }

  if (asset.sourceUrl.includes("/preview/")) {
    return resultFor({
      kind: "needs_browser",
      layer: "rule",
      confidence: 0.7,
      url: asset.sourceUrl,
      reason: "The source looks like an intermediate preview page, not a direct media file.",
      notes: "A browser resolver should inspect redirects, iframes, and media requests."
    });
  }

  if (/^https?:\/\//i.test(asset.sourceUrl)) {
    return resultFor({
      kind: "needs_browser",
      layer: "rule",
      confidence: 0.55,
      url: asset.sourceUrl,
      reason: "The source is a web page or external player URL, not a direct media file.",
      notes: "A browser resolver should inspect redirects, iframes, and media requests."
    });
  }

  return resultFor({
    kind: "failed",
    layer: "rule",
    confidence: 0.2,
    url: asset.sourceUrl,
    reason: "No rule matched this source URL."
  });
}

export async function resolveAssetSource(assetKey: string): Promise<ResolveResult> {
  const asset = mockSearchResults.find((item) => item.assetKey === assetKey);

  if (!asset) {
    return resultFor({
      kind: "failed",
      layer: "rule",
      confidence: 0,
      reason: "Asset metadata was not found in the local catalog."
    });
  }

  const ruleResult = resolveByRule(asset);
  if (ruleResult.kind === "needs_browser" || ruleResult.kind === "needs_ai") {
    return await resolveWithAiFallback(asset, ruleResult) ?? ruleResult;
  }

  return ruleResult;
}

export async function resolveJobSource(input: {
  assetKey: string;
  sourceUrl?: string;
}): Promise<ResolveResult> {
  if (input.sourceUrl) {
    const asset: SearchResult = {
      assetKey: input.assetKey,
      title: input.assetKey,
      source: "cache job",
      sourceUrl: input.sourceUrl,
      durationLabel: "",
      updatedAt: new Date().toISOString(),
      summary: ""
    };
    const ruleResult = resolveByRule(asset);
    if (ruleResult.kind === "needs_browser" || ruleResult.kind === "needs_ai") {
      return await resolveWithAiFallback(asset, ruleResult) ?? ruleResult;
    }

    return ruleResult;
  }

  return resolveAssetSource(input.assetKey);
}
