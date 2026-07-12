import { createHash } from "node:crypto";
import path from "node:path";
import { importScan } from "./film-ledger-discovery.mjs";

export function migrateQueueState(repo, statePayload) {
  return importScan(repo, statePayload);
}

function titleIdentity(value) {
  const title = String(value ?? "").trim();
  const match = title.match(/^(.*?)\s*\((\d{4})\)\s*$/u);
  return { canonicalTitle: match?.[1]?.trim() || title, year: match ? Number(match[2]) : null };
}

function stableSpecKey(workPageId, specPageId, episodePageId, displayTitle) {
  return `migration-${createHash("sha256").update(JSON.stringify({ workPageId, specPageId, episodePageId, displayTitle })).digest("hex").slice(0, 16)}`;
}

function organizerRecords(reportPayload) {
  const records = [];
  for (const page of reportPayload?.pages ?? []) {
    for (const media of page.rootLandingMedia ?? []) {
      const target = media.suggestedTarget;
      if (!page.pageId || target?.status !== "ready") continue;
      const specPageId = target.kind === "episode_page" ? target.specPageId : target.pageId;
      if (!specPageId) continue;
      records.push({ page, media, target, specPageId, episodePageId: target.kind === "episode_page" ? target.pageId : null });
    }
  }
  return records;
}

export function migrateOrganizerReport(repo, reportPayload) {
  let registered = 0;
  let skipped = 0;
  for (const { page, media, specPageId, episodePageId } of organizerRecords(reportPayload)) {
    const identity = titleIdentity(page.title);
    if (!identity.canonicalTitle) { skipped += 1; continue; }
    const work = repo.ensureWork({ ...identity, workType: "movie", notionWorkPageId: page.pageId });
    const displayTitle = media.suggestedSpecTitle || media.name || `Imported target ${specPageId}`;
    const variant = repo.ensureVariant({
      workId: work.id,
      specKey: stableSpecKey(page.pageId, specPageId, episodePageId, displayTitle),
      displayTitle,
      outputPath: media.outputPath
    });
    repo.registerNotionTarget(variant.id, {
      workPageId: page.pageId,
      specPageId,
      episodePageId,
      expectedFilename: media.name ?? null,
      mediaBlockId: media.blockId ?? null
    });
    registered += 1;
  }
  return { registered, skipped };
}

export function applyCorrectionsManifest(repo, manifest) {
  if (!manifest || !Array.isArray(manifest.variants)) throw new TypeError("corrections manifest variants must be an array");
  let corrected = 0;
  for (const correction of manifest.variants) {
    if (!correction?.outputPath) throw new TypeError("every correction requires outputPath");
    const variant = repo.findVariantByOutputPath(path.normalize(correction.outputPath));
    if (!variant) throw new Error(`correction outputPath is not registered: ${correction.outputPath}`);
    repo.applyMigrationCorrection(variant.id, correction);
    corrected += 1;
  }
  return { corrected };
}
