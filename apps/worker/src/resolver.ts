import {
  type ResolveResult,
  type SearchResult,
  mockSearchResults
} from "@wwpdw/shared";

const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;

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
  if (directFilePattern.test(asset.sourceUrl)) {
    return resultFor({
      kind: "direct_file",
      layer: "rule",
      confidence: 0.92,
      url: asset.sourceUrl,
      notes: "Source URL matched a known playable file extension."
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

  return resolveByRule(asset);
}
