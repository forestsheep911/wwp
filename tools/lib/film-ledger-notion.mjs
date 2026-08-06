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

export async function reconcileDueTargets(repo, notionAdapter, { limit = 3, now = new Date().toISOString(), forceAfter429 = false, variantIds = [] } = {}) {
  const boundedLimit = normalizeLimit(limit, 3, 3);
  const breakerUntil = repo.getSchedulerState(BREAKER_KEY);
  if (!forceAfter429 && breakerUntil && now < breakerUntil) throw new Error(`Notion circuit breaker open until ${breakerUntil}`);

  const result = { checked: 0, completed: 0, pending: 0, failed: 0, rateLimited: false, authFailed: false };
  for (const target of repo.listDueNotionTargets({ limit: boundedLimit, now, variantIds })) {
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

function plainText(items) {
  return (items ?? []).map(item => item?.plain_text ?? item?.text?.content ?? "").join("");
}

function propertyPlainText(property) {
  if (property?.type === "rich_text") return plainText(property.rich_text);
  if (property?.type === "title") return plainText(property.title);
  return "";
}

function relationIds(property) {
  return property?.type === "relation" ? (property.relation ?? []).map(item => item.id) : [];
}

function selectName(property) {
  return property?.type === "select" ? property.select?.name ?? "" : "";
}

function checkboxValue(property) {
  return property?.type === "checkbox" ? property.checkbox : undefined;
}

function mediaFilename(block) {
  const caption = plainText(block?.[block?.type]?.caption).trim();
  if (caption) return caption;
  try { return decodeURIComponent(new URL(mediaUrl(block)).pathname.split("/").at(-1) ?? ""); }
  catch { return ""; }
}

function mediaCaption(block) {
  return plainText(block?.[block?.type]?.caption).trim();
}

function sameNotionId(left, right) {
  return String(left ?? "").replaceAll("-", "").toLowerCase()
    === String(right ?? "").replaceAll("-", "").toLowerCase();
}

function notionIdForms(value) {
  const compact = String(value ?? "").replaceAll("-", "").toLowerCase();
  if (!compact) return [];
  const canonical = /^[0-9a-f]{32}$/u.test(compact)
    ? `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
    : compact;
  return [...new Set([String(value), compact, canonical])];
}

function parentPageId(page) {
  return page?.parent?.type === "page_id" ? page.parent.page_id : null;
}

function recordedStructureMatches(pages, target) {
  const expectedIds = [target.work_page_id, target.season_page_id, target.spec_page_id, target.episode_page_id].filter(Boolean);
  if (pages.some((page, index) => !sameNotionId(page?.id, expectedIds[index]))) return false;
  const season = target.season_page_id ? pages.find(page => sameNotionId(page.id, target.season_page_id)) : null;
  const spec = pages.find(page => sameNotionId(page.id, target.spec_page_id));
  if (season && !sameNotionId(parentPageId(season), target.work_page_id)) return false;
  if (!sameNotionId(parentPageId(spec), target.season_page_id || target.work_page_id)) return false;
  if (target.episode_page_id) {
    const episode = pages.find(page => sameNotionId(page.id, target.episode_page_id));
    if (!sameNotionId(parentPageId(episode), target.spec_page_id)) return false;
  }
  return true;
}

async function recordedLegacyStructureMatches(client, pages, target) {
  const spec = pages.find(page => sameNotionId(page.id, target.spec_page_id));
  if (spec?.parent?.type !== "block_id") return false;
  const workChildren = await listRecordedPageChildren(client, target.work_page_id);
  const containers = workChildren.filter(block => ["callout", "toggle"].includes(block.type));
  for (const container of containers) {
    const children = await listRecordedPageChildren(client, container.id);
    if (!children.some(child => child.type === "child_page" && sameNotionId(child.id, target.spec_page_id))) continue;
    if (!target.episode_page_id) return true;
    const episode = pages.find(page => sameNotionId(page.id, target.episode_page_id));
    if (sameNotionId(parentPageId(episode), target.spec_page_id)) return true;
    const specChildren = await listRecordedPageChildren(client, target.spec_page_id);
    return specChildren.some(child => child.type === "child_page" && sameNotionId(child.id, target.episode_page_id));
  }
  return false;
}

function playbackAssetComplete(page) {
  const properties = page?.properties ?? {};
  return selectName(properties["Asset Type"]) === "playable_video"
    && selectName(properties["Media Availability"]).toLowerCase() === "playable"
    && Boolean(selectName(properties["Video Codec"]))
    && Boolean(selectName(properties.Container))
    && checkboxValue(properties["Playback Verified"]) === true
    && checkboxValue(properties["Hide from Website"]) === false
    && checkboxValue(properties["Needs Review"]) !== true;
}

function playbackAssetGate(page) {
  if (!page) return { code: "media_asset_missing", detail: "No matching Media Assets row was found." };
  const properties = page.properties ?? {};
  if (checkboxValue(properties["Hide from Website"]) === true) {
    return { code: "visibility_gate", detail: "Matching Media Assets row exists, but Hide from Website is true; do not clear it automatically." };
  }
  if (checkboxValue(properties["Needs Review"]) === true) {
    return { code: "needs_review_gate", detail: "Matching Media Assets row exists, but Needs Review is true." };
  }
  if (!playbackAssetComplete(page)) {
    return { code: "asset_fields_incomplete", detail: "Matching Media Assets row exists but required playable fields are incomplete." };
  }
  return null;
}

function matchesRecordedAssetEvidence(page, { workPageId, sourcePageId, mediaBlockId }) {
  const properties = page?.properties ?? {};
  if (!relationIds(properties.Work).some(id => sameNotionId(id, workPageId))) return false;
  const sourceMatches = sameNotionId(propertyPlainText(properties["Source Page ID"]), sourcePageId);
  const mediaMatches = Boolean(mediaBlockId) && sameNotionId(propertyPlainText(properties["Media Block ID"]), mediaBlockId);
  return sourceMatches || mediaMatches;
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

async function queryRecordedAssets(client, dataSourceId, { sourcePageId, mediaBlockId }) {
  const responses = [];
  if (mediaBlockId) {
    for (const value of notionIdForms(mediaBlockId)) {
      const response = await client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 20,
        filter: { property: "Media Block ID", rich_text: { equals: value } }
      });
      responses.push(response);
      if ((response.results ?? []).length > 0) return response.results;
    }
  }
  if (sourcePageId) {
    for (const value of notionIdForms(sourcePageId)) {
      responses.push(await client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 20,
        filter: { property: "Source Page ID", rich_text: { equals: value } }
      }));
    }
  }
  const seen = new Set();
  return responses.flatMap(response => response.results ?? []).filter(page => {
    if (seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

export function createNotionTargetAdapter(client, {
  mediaAssetsDataSourceId = process.env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID
} = {}) {
  if (!client?.pages?.retrieve || !client?.blocks?.children?.list || !client?.dataSources?.query) throw new TypeError("Notion client lacks required targeted APIs");
  if (!mediaAssetsDataSourceId) throw new Error("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID is required");
  return {
    async inspectTarget(target) {
      const recordedIds = [target.work_page_id, target.season_page_id, target.spec_page_id, target.episode_page_id].filter(Boolean);
      const pages = await Promise.all(recordedIds.map(pageId => client.pages.retrieve({ page_id: pageId })));
      const contentPageId = target.episode_page_id || target.spec_page_id;
      const blocks = await listRecordedPageChildren(client, contentPageId);
      const mediaBlocks = blocks.filter(block => ["video", "file", "audio"].includes(block.type) && mediaUrl(block));
      const media = target.media_block_id
        ? mediaBlocks.find(block => sameNotionId(block.id, target.media_block_id))
        : mediaBlocks.find(block => !target.expected_filename
          || mediaFilename(block).toLowerCase() === target.expected_filename.toLowerCase())
          // Manual Notion uploads often omit captions and expose only an opaque S3 key.
          // A sole unnamed block on the exact registered destination is still unambiguous.
          ?? (target.expected_filename && mediaBlocks.length === 1 && !mediaCaption(mediaBlocks[0])
            ? mediaBlocks[0]
            : undefined);
      const assets = {
        results: media
          ? await queryRecordedAssets(client, mediaAssetsDataSourceId, {
            sourcePageId: contentPageId,
            mediaBlockId: media.id
          })
          : []
      };
      const asset = media ? (assets.results ?? []).find(page => matchesRecordedAssetEvidence(page, {
        workPageId: target.work_page_id,
        sourcePageId: contentPageId,
        mediaBlockId: media?.id
      })) ?? null : null;
      const assetGate = media ? playbackAssetGate(asset) : { code: "media_block_missing", detail: "No matching media block was found on the recorded destination page." };
      const structureVerified = recordedStructureMatches(pages, target)
        || await recordedLegacyStructureMatches(client, pages, target);
      return {
        structureVerified: recordedIds.length >= 2 && structureVerified,
        mediaBlockId: media?.id ?? null,
        mediaVerified: Boolean(media),
        mediaAssetPageId: asset?.id ?? null,
        assetsVerified: Boolean(asset && playbackAssetComplete(asset)),
        assetGateCode: assetGate?.code ?? null,
        assetGateDetail: assetGate?.detail ?? null,
        evidence: { inspectedPageIds: recordedIds, contentPageId, mediaBlockId: media?.id ?? null }
      };
    }
  };
}
