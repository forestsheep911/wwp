import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverPeopleResumeArtifacts, summarizePeopleResumeArtifacts } from "./people-resume-artifacts.mjs";

test("inventory marks a clean matching People preflight as resumable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const report = path.join(root, "reviewed-report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: "wwm_1", title: "Example" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(root, "preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    const entries = discoverPeopleResumeArtifacts(root);
    assert.equal(entries[0].kind, "resumable_apply");
    assert.equal(entries[0].workId, "wwm_1");
    assert.equal(summarizePeopleResumeArtifacts(entries).resumable_apply, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory separates missing reports and identity-review reports", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "nested", "missing-preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: path.join(root, "gone.json") }));
    const report = path.join(root, "identity-report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: "wwm_2" }], identityIssues: [{ code: "conflict" }], unresolved: [] }));
    writeFileSync(path.join(root, "identity-preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    const summary = summarizePeopleResumeArtifacts(discoverPeopleResumeArtifacts(root));
    assert.equal(summary.artifact_repair, 1);
    assert.equal(summary.needs_human_or_identity_review, 1);
    assert.equal(summary.resumable_apply, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory keeps only the newest preflight for one stable work", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const oldReport = path.join(root, "old-report.json");
    const newReport = path.join(root, "new-report.json");
    writeFileSync(oldReport, JSON.stringify({ proposedCredits: [{ workId: "wwm_same" }], identityIssues: [], unresolved: [] }));
    writeFileSync(newReport, JSON.stringify({ proposedCredits: [{ workId: "wwm_same", title: "New" }], identityIssues: [], unresolved: [] }));
    const oldPreflight = path.join(root, "old-preflight.json");
    const newPreflight = path.join(root, "new-preflight.json");
    writeFileSync(oldPreflight, JSON.stringify({ status: "ready_for_authorized_apply", reportPath: oldReport }));
    writeFileSync(newPreflight, JSON.stringify({ status: "ready_for_authorized_apply", reportPath: newReport }));
    const entries = discoverPeopleResumeArtifacts(root);
    assert.equal(entries.filter((entry) => entry.workId === "wwm_same").length, 1);
    assert.equal(entries.find((entry) => entry.workId === "wwm_same").title, "New");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory does not reopen an artifact for a completed campaign stage", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const report = path.join(root, "report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: "wwm_done", title: "Done" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(root, "preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    const entries = discoverPeopleResumeArtifacts(root, { campaign: { works: [{ externalWorkId: "wwm_done", stages: { people: { status: "completed" } } }] } });
    assert.equal(entries[0].kind, "already_completed");
    assert.equal(entries[0].resumable, false);
    assert.equal(summarizePeopleResumeArtifacts(entries).resumable_apply, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory does not reopen complete coverage when campaign entry is missing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const dir = path.join(root, "carlito");
    mkdirSync(dir);
    const report = path.join(dir, "final-report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: "wwm_done", title: "Done" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(dir, "final-preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    writeFileSync(path.join(dir, "post-publish-coverage.json"), JSON.stringify({ targets: [{ workId: "wwm_done", creditCount: 12, linkedCreditCount: 12, unlinkedCredits: [] }] }));
    const entries = discoverPeopleResumeArtifacts(root, { campaign: { works: [] } });
    assert.equal(entries[0].kind, "already_completed");
    assert.equal(entries[0].resumable, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory separates a catalog replay from a full People apply", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const dir = path.join(root, "bernie");
    mkdirSync(path.join(dir, "notion-state"), { recursive: true });
    const report = path.join(dir, "report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: "wwm_catalog", title: "Catalog" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(dir, "preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    writeFileSync(path.join(dir, "notion-state", "notion-upsert-checkpoint.json"), JSON.stringify({ completed: {} }));
    const campaign = { works: [{ externalWorkId: "wwm_catalog", stages: { people: { status: "deferred", reason: "catalog apply waiting for canonical index" } } }] };
    const [entry] = discoverPeopleResumeArtifacts(root, { campaign });
    assert.equal(entry.kind, "resumable_catalog_replay");
    assert.equal(entry.resumable, false);
    assert.equal(summarizePeopleResumeArtifacts([entry]).resumable_catalog_replay, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory does not authorize a clean report without a stable work id", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const report = path.join(root, "report.json");
    writeFileSync(report, JSON.stringify({ proposedPeople: [{ name: "Unbound" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(root, "preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    const [entry] = discoverPeopleResumeArtifacts(root);
    assert.equal(entry.kind, "needs_human_or_identity_review");
    assert.equal(entry.resumable, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory matches legacy numeric work ids to completed ledger entries", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-people-resume-"));
  try {
    const report = path.join(root, "report.json");
    writeFileSync(report, JSON.stringify({ proposedCredits: [{ workId: 327, title: "Legacy" }], identityIssues: [], unresolved: [] }));
    writeFileSync(path.join(root, "preflight.json"), JSON.stringify({ status: "ready_for_authorized_apply", reportPath: report }));
    const entries = discoverPeopleResumeArtifacts(root, { campaign: { works: [{ ledgerWorkId: 327, stages: { people: { status: "completed" } } }] } });
    assert.equal(entries[0].kind, "already_completed");
    assert.equal(entries[0].resumable, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
