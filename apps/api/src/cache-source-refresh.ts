import type { CacheJob, SearchResult } from "@wwpdw/shared";
import type { RefreshAssetInput } from "./search-source.js";

type SourceTraceMetadata = {
  mediaBlockId?: string;
  mediaAssetPageId?: string;
};

function sourceTraceFromResult(result: Pick<SearchResult, "metadata"> | undefined) {
  const metadata = (result?.metadata ?? {}) as SourceTraceMetadata;
  return {
    mediaBlockId: metadata.mediaBlockId,
    mediaAssetPageId: metadata.mediaAssetPageId
  };
}

export function refreshAssetInputFromResult(result: SearchResult): RefreshAssetInput {
  return {
    assetKey: result.assetKey,
    sourcePageId: result.sourcePageId,
    title: result.title,
    sourceBreadcrumb: result.sourceBreadcrumb,
    ...sourceTraceFromResult(result)
  };
}

export function refreshAssetInputFromJob(
  job: CacheJob,
  hint?: SearchResult
): RefreshAssetInput {
  const hintTrace = sourceTraceFromResult(hint);
  return {
    assetKey: job.assetKey,
    sourcePageId: hint?.sourcePageId ?? job.sourcePageId,
    title: hint?.title ?? job.title,
    sourceBreadcrumb: hint?.sourceBreadcrumb ?? job.sourceBreadcrumb,
    mediaBlockId: job.sourceMediaBlockId ?? hintTrace.mediaBlockId,
    mediaAssetPageId: job.sourceMediaAssetPageId ?? hintTrace.mediaAssetPageId
  };
}
