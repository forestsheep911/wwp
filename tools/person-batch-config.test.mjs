import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("tools/person-batch-config.mjs");

test("builds a resumable subset config and inherits prior linked credits", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-config-"));
  const selectedId = "person_00000000-0000-4000-8000-000000000001";
  const priorId = "person_00000000-0000-4000-8000-000000000002";
  const verifiedId = "person_00000000-0000-4000-8000-000000000003";
  const deferredId = "person_00000000-0000-4000-8000-000000000004";
  const reportPath = path.join(directory, "discovery.json");
  writeFileSync(reportPath, JSON.stringify({
    proposedProfiles: [selectedId, priorId, verifiedId, deferredId].map((personId) => ({ personId })),
    proposedCredits: [{ credits: [selectedId, priorId, verifiedId, deferredId].map((personId) => ({ personId })) }],
    identityIssues: [],
    unresolved: [{ reason: "credit_identity_not_materialized" }]
  }));
  const priorPath = path.join(directory, "prior.json");
  writeFileSync(priorPath, JSON.stringify({ proposedCredits: [{ credits: [{ personId: priorId }] }] }));
  const outputPath = path.join(directory, "config.json");

  execFileSync(process.execPath, [
    "--import", "tsx", scriptPath,
    "--report", reportPath,
    "--select-person-id", selectedId,
    "--keep-linked-from-report", priorPath,
    "--keep-linked-person-id", verifiedId,
    "--credit-name-override", "Q1=订正姓名",
    "--output", outputPath
  ]);

  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(output.inputs[0].profilePersonIds, [selectedId]);
  assert.deepEqual(new Set(output.inputs[0].keepLinkedPersonIds), new Set([selectedId, priorId, verifiedId]));
  assert.deepEqual(output.inputs[0].creditNameOverrides, { Q1: "订正姓名" });
});

test("rejects a selected identity that is absent from the discovery report", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-config-"));
  const reportPath = path.join(directory, "discovery.json");
  writeFileSync(reportPath, JSON.stringify({ proposedProfiles: [{ personId: "person-present" }], proposedCredits: [], identityIssues: [], unresolved: [] }));
  assert.throws(() => execFileSync(process.execPath, [
    "--import", "tsx", scriptPath,
    "--report", reportPath,
    "--select-person-id", "person-missing",
    "--output", path.join(directory, "config.json")
  ], { stdio: "pipe" }), /Command failed/);
});

test("marks an explicit profile-only publication batch", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-config-"));
  const reportPath = path.join(directory, "discovery.json");
  writeFileSync(reportPath, JSON.stringify({
    proposedProfiles: [{ personId: "person-present" }],
    proposedCredits: [{ workId: "wwm_hidden", credits: [{ personId: "person-present" }] }],
    identityIssues: [],
    unresolved: [{ reason: "credit_identity_not_materialized" }]
  }));
  const outputPath = path.join(directory, "config.json");
  execFileSync(process.execPath, [
    "--import", "tsx", scriptPath,
    "--report", reportPath,
    "--profiles-only",
    "--output", outputPath
  ]);
  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(output.inputs[0].profilesOnly, true);
});
