import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository, normalizeLedgerPath } from "./lib/film-ledger-repository.mjs";
import { collectRelocationCandidates, parseArgs, pendingDeletionPath, relocateFinishedOutputs } from "./film-relocate-finished-outputs.mjs";

test("rejects a same-root relocation before touching the ledger", () => {
  assert.throws(
    () => parseArgs(["--from-root", os.tmpdir(), "--to-root", os.tmpdir()]),
    /must be different directories/u
  );
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-relocate-"));
  const db = openLedger(path.join(root, "ledger.sqlite"));
  const repo = createLedgerRepository(db);
  const work = repo.ensureWork({ canonicalTitle: "Example", year: 2025, workType: "movie", priorityScore: 1 });
  const sourceRoot = path.join(root, "F", "video_made");
  const destinationRoot = path.join(root, "E", "video_made");
  fs.mkdirSync(sourceRoot, { recursive: true });
  const file = path.join(sourceRoot, "example.mp4");
  fs.writeFileSync(file, Buffer.alloc(128, 7));
  const variant = repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Example", outputPath: file });
  repo.transitionProduction(variant.id, "evaluated");
  repo.transitionProduction(variant.id, "selected");
  repo.transitionProduction(variant.id, "encoding");
  repo.transitionProduction(variant.id, "qc_passed", { outputPath: file, outputSizeBytes: 128 });
  repo.transitionPublication(variant.id, "structure_pending");
  repo.transitionPublication(variant.id, "upload_pending");
  repo.transitionPublication(variant.id, "upload_seen");
  repo.transitionPublication(variant.id, "assets_pending");
  repo.transitionPublication(variant.id, "verification_pending");
  repo.transitionPublication(variant.id, "sync_ready");
  return { root, db, variant, file, sourceRoot, destinationRoot };
}

test("relocation preview selects only exact sync-ready output", () => {
  const f = fixture();
  const candidates = collectRelocationCandidates(f.db, f.sourceRoot, f.destinationRoot);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eligible, true);
  assert.equal(relocateFinishedOutputs(f.db, candidates).planned.length, 1);
  f.db.close();
});

test("relocation copies, verifies, removes source, and updates ledger", () => {
  const f = fixture();
  const result = relocateFinishedOutputs(f.db, collectRelocationCandidates(f.db, f.sourceRoot, f.destinationRoot), { apply: true });
  assert.equal(result.moved.length, 1, JSON.stringify(result));
  const destination = result.moved[0].destination;
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(fs.statSync(destination).size, 128);
  assert.equal(f.db.prepare("SELECT output_path FROM variants WHERE id=?").get(f.variant.id).output_path, normalizeLedgerPath(destination));
  assert.equal(f.db.prepare("SELECT event_type FROM events WHERE entity_id=? ORDER BY id DESC LIMIT 1").get(f.variant.id).event_type, "output_relocated");
  f.db.close();
});

test("reconciles a manually moved output without copying or deleting it", () => {
  const f = fixture();
  const destination = pendingDeletionPath(f.destinationRoot, f.variant);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(f.file, destination);
  const candidates = collectRelocationCandidates(f.db, f.sourceRoot, f.destinationRoot);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].alreadyAtDestination, true);
  const result = relocateFinishedOutputs(f.db, candidates, { apply: true });
  assert.equal(result.reconciled.length, 1, JSON.stringify(result));
  assert.equal(fs.existsSync(destination), true);
  assert.equal(f.db.prepare("SELECT output_path FROM variants WHERE id=?").get(f.variant.id).output_path, normalizeLedgerPath(destination));
  assert.equal(f.db.prepare("SELECT event_type FROM events WHERE entity_id=? ORDER BY id DESC LIMIT 1").get(f.variant.id).event_type, "output_reconciled");
  f.db.close();
});
