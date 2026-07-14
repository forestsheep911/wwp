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

function stableSpecKey(workPageId, specPageId, episodePageId) {
  return `migration-${createHash("sha256").update(JSON.stringify({ workPageId, specPageId, episodePageId })).digest("hex").slice(0, 16)}`;
}

function completedProductionSpecKey(workPageId, specPageId, episodePageId = null) {
  return `production-${createHash("sha256").update(JSON.stringify({ workPageId, specPageId, episodePageId })).digest("hex").slice(0, 16)}`;
}

function validateProductionManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("production manifest must be an object");
  for (const field of ["work", "output", "outputSpec", "workPageId", "targetSpecPageId"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim().length === 0) throw new TypeError(`production manifest ${field} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(manifest.outputBytes) || manifest.outputBytes <= 0) throw new TypeError("production manifest outputBytes must be a positive safe integer");
  if (manifest.evidence != null && (typeof manifest.evidence !== "object" || Array.isArray(manifest.evidence))) {
    throw new TypeError("production manifest evidence must be an object when provided");
  }
}

function validateOrganizerReport(reportPayload) {
  if (!reportPayload || typeof reportPayload !== "object" || Array.isArray(reportPayload) || !Array.isArray(reportPayload.pages)) {
    throw new TypeError("organizer report must be an object with a pages array");
  }
  for (const [pageIndex, page] of reportPayload.pages.entries()) {
    const pagePath = `organizer report pages[${pageIndex}]`;
    if (!page || typeof page !== "object" || Array.isArray(page)) throw new TypeError(`${pagePath} must be an object`);
    if (typeof page.pageId !== "string" || page.pageId.length === 0) throw new TypeError(`${pagePath}.pageId must be a non-empty string`);
    if (typeof page.title !== "string") throw new TypeError(`${pagePath}.title must be a string`);
    if (!Array.isArray(page.rootLandingMedia)) throw new TypeError(`${pagePath}.rootLandingMedia must be an array`);
    for (const [mediaIndex, media] of page.rootLandingMedia.entries()) {
      const mediaPath = `${pagePath}.rootLandingMedia[${mediaIndex}]`;
      if (!media || typeof media !== "object" || Array.isArray(media)) throw new TypeError(`${mediaPath} must be an object`);
      if (!media.suggestedTarget || typeof media.suggestedTarget !== "object" || Array.isArray(media.suggestedTarget)) {
        throw new TypeError(`${mediaPath}.suggestedTarget must be an object`);
      }
    }
  }
}

function organizerRecords(reportPayload) {
  validateOrganizerReport(reportPayload);
  const records = [];
  for (const page of reportPayload.pages) {
    for (const media of page.rootLandingMedia) {
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
      specKey: stableSpecKey(page.pageId, specPageId, episodePageId),
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

export function importProductionManifest(repo, manifest) {
  validateProductionManifest(manifest);
  const identity = titleIdentity(manifest.work);
  const work = repo.ensureWork({ ...identity, workType: manifest.workType ?? "movie", notionWorkPageId: manifest.workPageId });
  const variant = repo.ensureVariant({
    workId: work.id,
    specKey: completedProductionSpecKey(manifest.workPageId, manifest.targetSpecPageId, manifest.episodePageId ?? null),
    displayTitle: manifest.outputSpec,
    audioVariant: manifest.audioVariant,
    subtitleVariant: manifest.subtitleVariant,
    cutVariant: manifest.cutVariant,
    outputPath: manifest.output,
    targetSizeBytes: manifest.outputBytes,
    probePath: manifest.evidence?.probe
  });
  const imported = variant.production_state !== "qc_passed";
  if (imported) {
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) {
      repo.transitionProduction(variant.id, state, state === "qc_passed" ? {
        outputPath: manifest.output,
        outputSizeBytes: manifest.outputBytes,
        probePath: manifest.evidence?.probe,
        qcArtifactPath: manifest.evidence?.contactSheet ?? manifest.evidence?.sampleFrame
      } : {});
    }
  } else {
    repo.refreshProductionEvidence(variant.id, {
      outputPath: manifest.output,
      outputSizeBytes: manifest.outputBytes,
      probePath: manifest.evidence?.probe,
      qcArtifactPath: manifest.evidence?.contactSheet ?? manifest.evidence?.sampleFrame
    });
  }
  const target = repo.registerNotionTarget(variant.id, {
    workPageId: manifest.workPageId,
    specPageId: manifest.targetSpecPageId,
    episodePageId: manifest.episodePageId ?? null,
    expectedFilename: manifest.expectedFilename ?? path.basename(manifest.output)
  });
  const current = repo.findVariantByOutputPath(manifest.output);
  if (current?.publication_state === "not_ready") repo.transitionPublication(variant.id, "structure_pending", { targetRegistered: true, importedManifest: true });
  return { status: imported ? "imported" : "already_imported", variant: repo.findVariantByOutputPath(manifest.output), target };
}

export function applyCorrectionsManifest(repo, manifest) {
  if (!manifest || !Array.isArray(manifest.variants)) throw new TypeError("corrections manifest variants must be an array");
  let corrected = 0;
  for (const correction of manifest.variants) {
    if (!correction?.outputPath) throw new TypeError("every correction requires outputPath");
    const variant = repo.findVariantByOutputPath(path.normalize(correction.outputPath));
    if (!variant) throw new Error(`correction outputPath is not registered: ${correction.outputPath}`);
    const evidence = `${correction.failureCode ?? ""} ${correction.failureDetail ?? ""} ${correction.colorRisk ?? ""}`;
    const hasColorFailureEvidence = /green|dolby.?vision|\bdv\b|colou?r/i.test(evidence);
    const normalized = hasColorFailureEvidence && correction.productionState == null
      ? { ...correction, productionState: "qc_failed" }
      : correction;
    if (repo.applyMigrationCorrection(variant.id, normalized).applied) corrected += 1;
  }
  return { corrected };
}
