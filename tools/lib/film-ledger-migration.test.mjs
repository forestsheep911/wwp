import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./film-ledger-schema.mjs";
import { createLedgerRepository } from "./film-ledger-repository.mjs";
import { migrateQueueState, migrateOrganizerReport, applyCorrectionsManifest } from "./film-ledger-migration.mjs";

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
