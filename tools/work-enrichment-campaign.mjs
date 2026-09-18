#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import {
  buildEnrichmentCampaignReport,
  assertAuthoritativePeopleCoverage,
  deferPeopleStageForCoverageFailure,
  enqueueEnrichmentWorks,
  recoverStaleInProgress,
  reclassifyTransientBlockedStages,
  readEnrichmentCampaign,
  resumeAuthorizedPeopleStage,
  settlePeopleStageFromCoverage,
  updateEnrichmentStage,
  writeEnrichmentCampaign
} from "./lib/work-enrichment-campaign.mjs";
import { discoverPeopleResumeArtifacts, summarizePeopleResumeArtifacts } from "./lib/people-resume-artifacts.mjs";

const DEFAULT_STATE = ".local-data/work-enrichment-campaign.json";

function parseArgs(argv) {
  const options = {
    command: null,
    state: DEFAULT_STATE,
    source: "manual",
    limit: 3,
    inputs: [],
    missingFields: [],
    humanConfirmationReasons: [],
    json: false,
    allowLocalCoverage: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-") && !options.command) options.command = arg;
    else if (arg === "--state") options.state = argv[++index];
    else if (arg === "--input") options.inputs.push(argv[++index]);
    else if (arg === "--source") options.source = argv[++index];
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--item-key") options.key = argv[++index];
    else if (arg === "--ledger-work-id") options.ledgerWorkId = Number(argv[++index]);
    else if (arg === "--external-work-id") options.externalWorkId = argv[++index];
    else if (arg === "--page-id") options.pageId = argv[++index];
    else if (arg === "--title") options.title = argv[++index];
    else if (arg === "--stage") options.stage = argv[++index];
    else if (arg === "--status") options.status = argv[++index];
    else if (arg === "--reason") options.reason = argv[++index];
    else if (arg === "--missing-field") options.missingFields.push(argv[++index]);
    else if (arg === "--human-confirmation") options.humanConfirmationReasons.push(argv[++index]);
    else if (arg === "--next-review-at") options.nextReviewAt = argv[++index];
    else if (arg === "--next-trigger") options.nextTrigger = argv[++index];
    else if (arg === "--preflight") options.preflight = argv[++index];
    else if (arg === "--report") options.report = argv[++index];
    else if (arg === "--coverage") options.coverage = argv[++index];
    else if (arg === "--allow-local-coverage") options.allowLocalCoverage = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.command) throw new Error("command is required: status|resume-artifacts|enqueue|enqueue-coverage|record|authorize-people|settle-people-coverage|repair-transient-blockers");
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) throw new Error("--limit must be between 1 and 20");
  return options;
}

function readInputWorks(filePath) {
  const payload = JSON.parse(readFileSync(path.resolve(filePath), "utf8"));
  if (!Array.isArray(payload.works)) throw new Error(`${filePath} must contain a works array`);
  return payload.works;
}

function output(value, json) {
  process.stdout.write(`${json ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = ["status", "resume-artifacts"].includes(options.command)
    ? null
    : acquireProductionLock({ owner: "work-enrichment-campaign", mode: "enrichment-only" });
  try {
    let state = readEnrichmentCampaign(options.state);
    const recovered = recoverStaleInProgress(state);
    state = recovered.state;
    if (recovered.recovered.length > 0) writeEnrichmentCampaign(options.state, state);
    let mutation = null;
    if (options.command === "resume-artifacts") {
      const entries = discoverPeopleResumeArtifacts(path.resolve(".local-data/people"), { campaign: state });
      output({
        root: path.resolve(".local-data/people"),
        summary: summarizePeopleResumeArtifacts(entries),
        entries: entries.slice(0, options.limit)
      }, options.json);
      return;
    } else if (options.command === "enqueue") {
      const inputs = options.inputs.flatMap(readInputWorks);
      if (options.externalWorkId || options.pageId || options.ledgerWorkId) {
        inputs.push({
          ledgerWorkId: options.ledgerWorkId,
          externalWorkId: options.externalWorkId,
          pageId: options.pageId,
          title: options.title
        });
      }
      if (inputs.length === 0) throw new Error("enqueue requires --input or a work identifier");
      mutation = enqueueEnrichmentWorks(state, inputs, { source: options.source });
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command === "enqueue-coverage") {
      if (!options.coverage) throw new Error("enqueue-coverage requires --coverage");
      const coverage = JSON.parse(readFileSync(path.resolve(options.coverage), "utf8"));
      const candidates = coverage.works ?? coverage.candidates;
      if (!Array.isArray(candidates)) throw new Error("coverage must contain a works or candidates array");
      const inputs = candidates
        .filter((candidate) => ["missing_credits", "unlinked_only", "partially_linked"].includes(candidate.status))
        .map((candidate) => ({
          externalWorkId: candidate.workId ?? candidate.externalWorkId ?? candidate.wwWorkId,
          pageId: candidate.sourcePageId ?? candidate.pageId ?? candidate.notionWorkPageId,
          title: candidate.title
        }))
        .filter((candidate) => candidate.externalWorkId && candidate.pageId && candidate.title)
        .slice(0, options.limit);
      if (inputs.length === 0) throw new Error("coverage contains no bounded, uniquely identified incomplete works");
      mutation = enqueueEnrichmentWorks(state, inputs, { source: "historical_people_coverage" });
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command === "record") {
      if (!options.stage || !options.status) throw new Error("record requires --stage and --status");
      mutation = updateEnrichmentStage(state, {
        key: options.key,
        ledgerWorkId: options.ledgerWorkId,
        externalWorkId: options.externalWorkId,
        pageId: options.pageId
      }, {
        stage: options.stage,
        status: options.status,
        reason: options.reason,
        missingFields: options.missingFields,
        humanConfirmationReasons: options.humanConfirmationReasons,
        nextReviewAt: options.nextReviewAt,
        nextTrigger: options.nextTrigger
      });
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command === "authorize-people") {
      if (!options.preflight || !options.report) throw new Error("authorize-people requires --preflight and --report");
      const preflight = JSON.parse(readFileSync(path.resolve(options.preflight), "utf8"));
      mutation = resumeAuthorizedPeopleStage(state, {
        key: options.key,
        ledgerWorkId: options.ledgerWorkId,
        externalWorkId: options.externalWorkId,
        pageId: options.pageId
      }, {
        preflight,
        reportPath: options.report,
        reason: options.reason ?? undefined
      });
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command === "settle-people-coverage") {
      if (!options.coverage) throw new Error("settle-people-coverage requires --coverage");
      const coverage = JSON.parse(readFileSync(path.resolve(options.coverage), "utf8"));
      const selector = {
        key: options.key,
        ledgerWorkId: options.ledgerWorkId,
        externalWorkId: options.externalWorkId,
        pageId: options.pageId
      };
      try {
        assertAuthoritativePeopleCoverage(coverage, { allowLocal: options.allowLocalCoverage });
        mutation = settlePeopleStageFromCoverage(state, selector, coverage);
      } catch (error) {
        // A provider/backend mismatch is a retryable readback failure. Do not
        // leave the Notion-facing work in AI处理中, but keep malformed counts,
        // ambiguous identities, and other integrity errors fail-closed.
        if (!/production People settlement requires an Azure coverage audit/iu.test(String(error?.message ?? error))) throw error;
        mutation = deferPeopleStageForCoverageFailure(state, selector, error);
      }
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command === "repair-transient-blockers") {
      mutation = reclassifyTransientBlockedStages(state);
      state = mutation.state;
      writeEnrichmentCampaign(options.state, state);
    } else if (options.command !== "status") {
      throw new Error(`unknown command: ${options.command}`);
    }
    const report = buildEnrichmentCampaignReport(state, { limit: options.limit });
    report.statePath = path.resolve(options.state);
    if (mutation?.added) report.mutation = { added: mutation.added, existing: mutation.existing };
    if (mutation?.repaired) report.mutation = { repaired: mutation.repaired, nextReviewAt: mutation.nextReviewAt };
    report.recoveredStaleInProgress = recovered.recovered;
    if (mutation?.work) report.mutation = {
      updated: mutation.work.key,
      stage: ["authorize-people", "settle-people-coverage"].includes(options.command) ? "people" : options.stage,
      status: options.command === "authorize-people"
        ? "in_progress"
        : options.command === "settle-people-coverage"
          ? mutation.work.stages.people.status
          : options.status
    };
    output(report, options.json);
  } finally {
    lock?.release();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
