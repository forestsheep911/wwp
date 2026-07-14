import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./film-ledger-schema.mjs";
import { createLedgerRepository } from "./film-ledger-repository.mjs";
import { migrateQueueState, migrateOrganizerReport, importProductionManifest, applyCorrectionsManifest } from "./film-ledger-migration.mjs";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-migration-"));
  const db = openLedger(path.join(dir, "ledger.sqlite"));
  const repo = createLedgerRepository(db, { now: () => "2026-07-12T00:00:00.000Z" });
  return { db, repo, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function queue(root, relativePath) {
  return { root, scannedAt: "2026-07-12T00:00:00.000Z", entries: [{
    name: relativePath, relativePath, fileCount: 1, mediaCount: 1, subtitleCount: 0,
    nfoCount: 0, totalBytes: 100, largestMedia: [], flags: { looksSeries: false, looksDv: false, looksHdr: false }
  }] };
}

test("two queue baselines create distinct roots without selecting work", () => {
  const f = fixture();
  try {
    assert.equal(migrateQueueState(f.repo, queue("I:\\MAKE\\queue", "One")).summary.inserted, 1);
    assert.equal(migrateQueueState(f.repo, queue("F:\\queue", "Two")).summary.inserted, 1);
    assert.equal(f.db.prepare("SELECT count(*) count FROM input_roots").get().count, 2);
    assert.equal(f.db.prepare("SELECT count(*) count FROM sources").get().count, 2);
    assert.equal(f.db.prepare("SELECT count(*) count FROM works").get().count, 0);
    assert.deepEqual(f.repo.listProductionCandidates(), []);
  } finally { f.close(); }
});

test("explicit organizer page registration remains not_ready", () => {
  const f = fixture();
  try {
    const result = migrateOrganizerReport(f.repo, { pages: [{
      pageId: "work-page", title: "Example (2025)", rootLandingMedia: [{
        blockId: "media-block", name: "Example.2025.mandarin.mp4", suggestedSpecTitle: "Example Mandarin",
        suggestedTarget: { status: "ready", kind: "spec_page", pageId: "spec-page" }
      }]
    }] });
    assert.equal(result.registered, 1);
    const row = f.db.prepare("SELECT variants.publication_state, notion_targets.* FROM variants JOIN notion_targets ON notion_targets.variant_id=variants.id").get();
    assert.equal(row.work_page_id, "work-page");
    assert.equal(row.spec_page_id, "spec-page");
    assert.equal(row.media_block_id, "media-block");
    assert.equal(row.publication_state, "not_ready");
    assert.equal(row.media_verified_at, null);
    assert.equal(row.assets_verified_at, null);
  } finally { f.close(); }
});

test("organizer migration updates one variant when its display title changes", () => {
  const f = fixture();
  try {
    const report = (suggestedSpecTitle) => ({ pages: [{
      pageId: "work-page", title: "Example (2025)", rootLandingMedia: [{
        blockId: "media-block", name: "Example.2025.mp4", suggestedSpecTitle,
        suggestedTarget: { status: "ready", kind: "spec_page", pageId: "spec-page" }
      }]
    }] });
    migrateOrganizerReport(f.repo, report("Old title"));
    migrateOrganizerReport(f.repo, report("New title"));
    assert.equal(f.db.prepare("SELECT count(*) count FROM variants").get().count, 1);
    assert.equal(f.db.prepare("SELECT display_title FROM variants").get().display_title, "New title");
  } finally { f.close(); }
});

test("correction lookup normalizes Windows case and trailing separators", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Windows path", year: 2025 });
    f.repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Windows path", outputPath: "E:\\Video_Made\\Example.mp4\\" });
    assert.deepEqual(applyCorrectionsManifest(f.repo, { variants: [{
      outputPath: "e:\\video_made\\example.mp4", audioVariant: "cantonese", productionState: "qc_failed"
    }] }), { corrected: 1 });
  } finally { f.close(); }
});

test("human-confirmed Cantonese overrides filename Mandarin and records review", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Example", year: 2025 });
    const variant = f.repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Example mandarin", audioVariant: "mandarin", outputPath: "E:\\video_made\\Example.mandarin.mp4" });
    const result = applyCorrectionsManifest(f.repo, { variants: [{
      outputPath: "E:\\video_made\\Example.mandarin.mp4", audioVariant: "cantonese",
      productionState: "qc_failed", failureCode: "wrong_audio_variant"
    }] });
    assert.equal(result.corrected, 1);
    const corrected = f.repo.findVariantByOutputPath("E:\\video_made\\Example.mandarin.mp4");
    assert.equal(corrected.audio_variant, "cantonese");
    assert.equal(corrected.production_state, "qc_failed");
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: variant.id }).at(-1).event_type, "human_review_correction");
  } finally { f.close(); }
});

test("green Dolby Vision correction never imports as qc_passed", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Green DV", year: 2024 });
    const variant = f.repo.ensureVariant({ workId: work.id, specKey: "dv", displayTitle: "Green DV", outputPath: "E:\\video_made\\green-dv.mp4" });
    assert.throws(() => applyCorrectionsManifest(f.repo, { variants: [{
      outputPath: "E:\\video_made\\green-dv.mp4", productionState: "qc_passed", failureCode: "green_dv_cast"
    }] }), /qc_failed or deferred/);
    assert.notEqual(f.repo.findVariantByOutputPath("E:\\video_made\\green-dv.mp4").production_state, "qc_passed");
    applyCorrectionsManifest(f.repo, { variants: [{
      outputPath: "E:\\video_made\\green-dv.mp4", productionState: "qc_failed", failureCode: "green_dv_cast"
    }] });
    assert.equal(f.repo.findVariantByOutputPath("E:\\video_made\\green-dv.mp4").production_state, "qc_failed");
  } finally { f.close(); }
});

test("green DV evidence defaults qc_passed variants to qc_failed but permits explicit deferred", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Green DV Defaults", year: 2024 });
    const failed = f.repo.ensureVariant({ workId: work.id, specKey: "failed", displayTitle: "Green DV failed", outputPath: "E:\\failed.mp4" });
    const deferred = f.repo.ensureVariant({ workId: work.id, specKey: "deferred", displayTitle: "Green DV deferred", outputPath: "E:\\deferred.mp4" });
    for (const variant of [failed, deferred]) {
      for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) f.repo.transitionProduction(variant.id, state);
    }

    applyCorrectionsManifest(f.repo, { variants: [{ outputPath: "E:\\failed.mp4", failureCode: "green_dv_cast" }] });
    applyCorrectionsManifest(f.repo, { variants: [{ outputPath: "E:\\deferred.mp4", failureCode: "color_failure", productionState: "deferred" }] });

    assert.equal(f.repo.findVariantByOutputPath("E:\\failed.mp4").production_state, "qc_failed");
    assert.equal(f.repo.findVariantByOutputPath("E:\\deferred.mp4").production_state, "deferred");
  } finally { f.close(); }
});

test("organizer report rejects malformed shapes with stable validation errors", () => {
  const f = fixture();
  try {
    assert.throws(() => migrateOrganizerReport(f.repo, null), {
      name: "TypeError", message: "organizer report must be an object with a pages array"
    });
    assert.throws(() => migrateOrganizerReport(f.repo, { pages: [null] }), {
      name: "TypeError", message: "organizer report pages[0] must be an object"
    });
    assert.throws(() => migrateOrganizerReport(f.repo, { pages: [{ pageId: "work", title: "Work", rootLandingMedia: {} }] }), {
      name: "TypeError", message: "organizer report pages[0].rootLandingMedia must be an array"
    });
  } finally { f.close(); }
});

test("repeating an identical correction is a no-op without a duplicate review event", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Idempotent", year: 2025 });
    const variant = f.repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Idempotent", audioVariant: "mandarin", outputPath: "E:\\idempotent.mp4" });
    const manifest = { variants: [{ outputPath: "E:\\idempotent.mp4", audioVariant: "cantonese", productionState: "qc_failed", failureCode: "wrong_audio_variant" }] };

    assert.deepEqual(applyCorrectionsManifest(f.repo, manifest), { corrected: 1 });
    const afterFirst = f.repo.findVariantByOutputPath("E:\\idempotent.mp4");
    assert.deepEqual(applyCorrectionsManifest(f.repo, manifest), { corrected: 0 });
    const afterSecond = f.repo.findVariantByOutputPath("E:\\idempotent.mp4");

    assert.deepEqual(afterSecond, afterFirst);
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: variant.id }).filter(event => event.event_type === "human_review_correction").length, 1);
  } finally { f.close(); }
});

test("production manifests preserve audio and subtitle variants in the ledger", () => {
  const f = fixture();
  try {
    const result = importProductionManifest(f.repo, {
      work: "Bad Guys 2 (2025)",
      output: "E:\\bad-guys-2.mp4",
      outputBytes: 123,
      outputSpec: "国配 4.79GB",
      workPageId: "work-page",
      targetSpecPageId: "spec-page",
      audioVariant: "mandarin",
      subtitleVariant: "traditional_english_burned"
    });
    const variant = f.repo.findVariantByOutputPath("E:\\bad-guys-2.mp4");
    assert.equal(result.status, "imported");
    assert.equal(variant.audio_variant, "mandarin");
    assert.equal(variant.subtitle_variant, "traditional_english_burned");
  } finally { f.close(); }
});

test("reimporting a completed manifest refreshes the authoritative output evidence", () => {
  const f = fixture();
  try {
    const manifest = {
      work: "Refreshable (2025)",
      output: "E:\\refreshable.mp4",
      outputBytes: 123,
      outputSpec: "简英 1GB",
      workPageId: "work-page",
      targetSpecPageId: "spec-page",
      evidence: { probe: ".local-data/refreshable.json", sampleFrame: ".local-data/refreshable.jpg" }
    };
    const first = importProductionManifest(f.repo, manifest);
    assert.equal(first.status, "imported");
    const second = importProductionManifest(f.repo, { ...manifest, outputBytes: 456 });
    assert.equal(second.status, "already_imported");
    const variant = f.repo.findVariantByOutputPath("E:\\refreshable.mp4");
    assert.equal(variant.output_size_bytes, 456);
    assert.equal(variant.probe_path, ".local-data/refreshable.json");
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: variant.id }).filter(event => event.event_type === "production_evidence_refreshed").length, 1);
  } finally { f.close(); }
});
