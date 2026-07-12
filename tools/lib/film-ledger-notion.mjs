import { isSyncReady, nextRetryAt, normalizeLimit } from "./film-ledger-domain.mjs";

const BREAKER_KEY = "notion_backoff_until";
const NEXT_PUBLICATION_STATE = Object.freeze({
  structure_pending: "upload_pending",
  upload_pending: "upload_seen",
  upload_seen: "assets_pending",
  assets_pending: "verification_pending",
  verification_pending: "sync_ready"
});

function errorCode(error) {
  if (error?.status === 429 || error?.code === "rate_limited") return "rate_limited";
  if ([401, 403].includes(error?.status) || ["unauthorized", "restricted_resource", "authentication_error"].includes(error?.code)) return "authentication_failed";
  return error?.code || "inspection_failed";
}

function advancePublication(repo, target, evidence) {
  const gates = {
    upload_pending: evidence.structureVerified === true,
    upload_seen: evidence.structureVerified === true && evidence.mediaVerified === true,
    assets_pending: evidence.structureVerified === true && evidence.mediaVerified === true,
    verification_pending: evidence.structureVerified === true && evidence.mediaVerified === true && evidence.assetsVerified === true,
    sync_ready: isSyncReady({ qcPassed: target.production_state === "qc_passed", ...evidence })
  };
  let state = target.publication_state;
  while (NEXT_PUBLICATION_STATE[state] && gates[NEXT_PUBLICATION_STATE[state]]) {
    state = repo.transitionPublication(target.variant_id, NEXT_PUBLICATION_STATE[state], { source: "notion_reconciliation" }).publication_state;
  }
  return state;
}

export async function reconcileDueTargets(repo, notionAdapter, { limit = 3, now = new Date().toISOString(), forceAfter429 = false } = {}) {
  const boundedLimit = normalizeLimit(limit, 3, 3);
  const breakerUntil = repo.getSchedulerState(BREAKER_KEY);
  if (!forceAfter429 && breakerUntil && now < breakerUntil) throw new Error(`Notion circuit breaker open until ${breakerUntil}`);

  const result = { checked: 0, completed: 0, pending: 0, failed: 0, rateLimited: false, authFailed: false };
  for (const target of repo.listDueNotionTargets({ limit: boundedLimit, now })) {
    try {
      const evidence = await notionAdapter.inspectTarget(target);
      result.checked += 1;
      const finalReady = isSyncReady({ qcPassed: target.production_state === "qc_passed", ...evidence });
      const nextCheckAt = finalReady ? null : nextRetryAt({ now, attemptCount: target.attempt_count + 1, rateLimited: false });
      repo.recordNotionInspection(target.variant_id, evidence, now, nextCheckAt);
      const state = advancePublication(repo, target, evidence);
      if (state === "sync_ready") result.completed += 1;
      else result.pending += 1;
    } catch (error) {
      result.checked += 1;
      result.failed += 1;
      const code = errorCode(error);
      const rateLimited = code === "rate_limited";
      const nextCheckAt = nextRetryAt({ now, attemptCount: target.attempt_count + 1, rateLimited });
      repo.recordNotionFailure(target.variant_id, { code, detail: error instanceof Error ? error.message : String(error), nextCheckAt }, now);
      if (rateLimited) {
        repo.setSchedulerState(BREAKER_KEY, nextCheckAt, now);
        result.rateLimited = true;
        break;
      }
      if (code === "authentication_failed") {
        result.authFailed = true;
        break;
      }
    }
  }
  return result;
}

function mediaUrl(block) {
  const value = block?.[block?.type];
  return value?.file?.url || value?.external?.url || "";
}

async function listRecordedPageChildren(client, pageId) {
  const results = [];
  let cursor;
  do {
    const request = { block_id: pageId, page_size: 100 };
    if (cursor) request.start_cursor = cursor;
    const response = await client.blocks.children.list(request);
    results.push(...(response.results ?? []));
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
}

export function createNotionTargetAdapter(client, {
  mediaAssetsDataSourceId = process.env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID,
  relationProperties = { work: "Work", spec: "Spec", episode: "Episode" }
} = {}) {
  if (!client?.pages?.retrieve || !client?.blocks?.children?.list || !client?.dataSources?.query) throw new TypeError("Notion client lacks required targeted APIs");
  if (!mediaAssetsDataSourceId) throw new Error("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID is required");
  return {
    async inspectTarget(target) {
      const recordedIds = [target.work_page_id, target.spec_page_id, target.episode_page_id].filter(Boolean);
      await Promise.all(recordedIds.map(pageId => client.pages.retrieve({ page_id: pageId })));
      const contentPageId = target.episode_page_id || target.spec_page_id;
      const blocks = await listRecordedPageChildren(client, contentPageId);
      const media = blocks.find(block => ["video", "file", "audio"].includes(block.type) && mediaUrl(block));
      const relations = [
        [relationProperties.work, target.work_page_id],
        [relationProperties.spec, target.spec_page_id],
        [relationProperties.episode, target.episode_page_id]
      ].filter(([, id]) => Boolean(id)).map(([property, id]) => ({ property, relation: { contains: id } }));
      const assets = await client.dataSources.query({ data_source_id: mediaAssetsDataSourceId, page_size: 10, filter: { or: relations } });
      const asset = assets.results?.[0] ?? null;
      return {
        structureVerified: recordedIds.length >= 2,
        mediaBlockId: media?.id ?? null,
        mediaVerified: Boolean(media),
        mediaAssetPageId: asset?.id ?? null,
        assetsVerified: Boolean(asset),
        evidence: { inspectedPageIds: recordedIds, contentPageId, mediaAssetRelationCount: relations.length }
      };
    }
  };
}
