#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import https from "node:https";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import { AI_ACTIONABLE_WORKFLOW_STATES, normalizeLimit } from "./lib/film-ledger-domain.mjs";
import { installNotionDnsOverride } from "./lib/notion-network.mjs";
import {
  WORKFLOW_NOTE_PROPERTY,
  WORKFLOW_STATUS_OPTIONS,
  WORKFLOW_STATUS_PROPERTY,
  buildActionableWorkflowFilter,
  buildWorkflowUpdate,
  humanIssueFromPage,
  pageTitle,
  pendingHumanWorkflowNoteFromPage,
  propertyText,
  workVisibilityReleaseBlockers,
  workCompletionBlockers,
  workflowNoteFromPage,
  workVisibilityHideReasonIsConcrete,
  shouldAutoReleaseWorkVisibility,
  workflowStateFromPage
} from "./lib/notion-workflow-handoff.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function parse(argv) {
  const values = new Set(["--page-id", "--expected-title", "--status", "--note", "--actor", "--limit", "--db", "--local-address", "--hide-from-website"]);
  const repeated = new Set(["--page-id"]);
  const booleans = new Set(["--apply", "--json", "--release-work", "--release-visibility"]);
  const options = { db: DEFAULT_DB, apply: false, json: false };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (argv[i + 1] == null || argv[i + 1].startsWith("--")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replaceAll("-", "_");
      const value = argv[++i];
      if (repeated.has(arg)) (options[key] ??= []).push(value);
      else options[key] = value;
    } else if (booleans.has(arg)) {
      options[arg.slice(2).replaceAll("-", "_")] = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 1 || !["schema", "scan", "claim", "set", "reconcile"].includes(positionals[0])) {
    throw new Error("command must be schema|scan|claim|set|reconcile");
  }
  const limit = normalizeLimit(options.limit, 3, 3);
  if (options.hide_from_website != null) {
    if (!["true", "false"].includes(options.hide_from_website)) {
      throw new Error("--hide-from-website must be true or false");
    }
    options.hide_from_website = options.hide_from_website === "true";
  }
  return { command: positionals[0], options: { ...options, limit } };
}

function extractId(value) {
  const compact = String(value ?? "").match(/([0-9a-f]{32})/iu)?.[1];
  if (compact) {
    return [compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16), compact.slice(16, 20), compact.slice(20)].join("-");
  }
  return String(value ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu)?.[0] ?? "";
}

async function loadLibrary(notion) {
  let dataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID || process.env.NOTION_DATA_SOURCE_ID;
  if (!dataSourceId) {
    const databaseId = process.env.NOTION_LIBRARY_DATABASE_ID || process.env.NOTION_DATABASE_ID;
    if (!databaseId) throw new Error("Notion library data source or database ID is required");
    const database = await notion.databases.retrieve({ database_id: databaseId });
    dataSourceId = database.data_sources?.[0]?.id;
  }
  if (!dataSourceId) throw new Error("Notion library data source ID is unavailable");
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { id: dataSourceId, properties: dataSource.properties ?? {} };
}

function assertWorkflowSchema(properties) {
  const status = properties[WORKFLOW_STATUS_PROPERTY];
  const note = properties[WORKFLOW_NOTE_PROPERTY];
  if (!status || !note) throw new Error("Workflow Status/Workflow Note schema is missing; run the schema command first");
  if (status.type !== "select" || note.type !== "rich_text") {
    throw new Error("Workflow Status must be select and Workflow Note must be rich_text");
  }
}

function workflowSchemaPatch(properties) {
  const patch = {};
  if (!properties[WORKFLOW_STATUS_PROPERTY]) {
    patch[WORKFLOW_STATUS_PROPERTY] = { select: { options: WORKFLOW_STATUS_OPTIONS } };
  }
  if (!properties[WORKFLOW_NOTE_PROPERTY]) patch[WORKFLOW_NOTE_PROPERTY] = { rich_text: {} };
  return patch;
}

function openOptionalRepository(filePath) {
  if (!existsSync(filePath)) return null;
  const db = openLedger(filePath);
  return { db, repo: createLedgerRepository(db) };
}

function mirrorPage(repository, page, observedAt = new Date().toISOString()) {
  if (!repository) return { matched: false, reason: "ledger_missing" };
  const status = workflowStateFromPage(page);
  if (!status) {
    return { matched: false, reason: "workflow_status_unset" };
  }
  const result = repository.repo.recordWorkHandoffByNotionPage(page.id, {
    status,
    note: workflowNoteFromPage(page),
    actor: "notion",
    observedAt
  });
  return result.unmatched
    ? { matched: false, reason: "work_page_not_in_ledger" }
    : { matched: true, workId: result.row.id, changed: result.changed };
}

function row(page, mirror) {
  const properties = page.properties ?? {};
  return {
    pageId: page.id,
    title: pageTitle(page),
    status: workflowStateFromPage(page),
    hideFromWebsite: properties["Hide from Website"]?.checkbox ?? null,
    needsReview: properties["Needs Review"]?.checkbox ?? null,
    metadataStatus: properties["Metadata Status"]?.select?.name ?? "",
    humanIssue: humanIssueFromPage(page),
    aiIssue: propertyText(properties["AI Issue"]),
    pendingHumanNote: pendingHumanWorkflowNoteFromPage(page),
    workflowNote: workflowNoteFromPage(page),
    mirror
  };
}

async function queryActionable(notion, dataSourceId, limit) {
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: limit,
    filter: buildActionableWorkflowFilter(AI_ACTIONABLE_WORKFLOW_STATES)
  });
  return response.results ?? [];
}

async function applySet(notion, page, options) {
  const releaseWork = options.release_work === true;
  const releaseVisibility = options.release_visibility === true;
  const visibilityRequested = typeof options.hide_from_website === "boolean";
  if (releaseWork && releaseVisibility) {
    throw new Error("--release-work and --release-visibility cannot be used together");
  }
  if (releaseWork && options.status !== "已完成") {
    throw new Error("--release-work requires --status 已完成");
  }
  if (releaseWork && options.hide_from_website === true) {
    throw new Error("--release-work cannot keep the work hidden");
  }
  if (releaseVisibility && options.hide_from_website !== false) {
    throw new Error("--release-visibility requires --hide-from-website false");
  }
  if (options.hide_from_website === false && !releaseWork && !releaseVisibility) {
    throw new Error("Clearing Hide from Website requires --release-work or --release-visibility");
  }
  if (options.hide_from_website === true && !workVisibilityHideReasonIsConcrete(options.note)) {
    throw new Error("Keeping Hide from Website=true requires --note with a concrete viewing, structure, Media Assets, or explicit human-hold reason; uncertainty and metadata follow-up are not hiding reasons");
  }
  if (visibilityRequested && page.properties?.["Hide from Website"]?.type !== "checkbox") {
    throw new Error("Hide from Website checkbox is missing");
  }
  const releaseBlockers = releaseWork ? workCompletionBlockers(page) : [];
  if (releaseBlockers.length) {
    throw new Error(`Final completion blocked: ${releaseBlockers.join(", ")}. This does not block website visibility; use --release-visibility after exact playable readback.`);
  }
  if (releaseVisibility) {
    // Metadata/review/completion blockers are deliberately excluded. A current
    // reproduced failure affecting every usable path or an explicit human hold
    // still requires resolution before the work-level page is released.
    const visibilityBlockers = workVisibilityReleaseBlockers(page);
    if (visibilityBlockers.length) {
      throw new Error(`Work visibility release blocked: ${visibilityBlockers.join(", ")}`);
    }
  }
  const nextStatus = options.status || workflowStateFromPage(page);
  const update = buildWorkflowUpdate(page, {
    status: nextStatus,
    note: options.note,
    actor: options.actor ?? "ai",
    at: new Date().toISOString(),
    enforceTransition: !releaseWork
  });
  if (releaseWork) update.properties["Hide from Website"] = { checkbox: false };
  else if (visibilityRequested) update.properties["Hide from Website"] = { checkbox: options.hide_from_website };
  else if (shouldAutoReleaseWorkVisibility(page)) {
    update.properties["Hide from Website"] = { checkbox: false };
  }
  if (!options.apply) return { page, update, applied: false };
  await notion.pages.update({ page_id: page.id, properties: update.properties });
  const readback = await notion.pages.retrieve({ page_id: page.id });
  if (workflowStateFromPage(readback) !== nextStatus) {
    throw new Error(`Workflow status readback failed for ${page.id}`);
  }
  const expectedVisibility = releaseWork || releaseVisibility ? false : options.hide_from_website;
  if (typeof expectedVisibility === "boolean"
    && readback.properties?.["Hide from Website"]?.checkbox !== expectedVisibility) {
    throw new Error(`Work visibility readback failed for ${page.id}`);
  }
  return { page: readback, update, applied: true };
}

export function assertExpectedPageTitle(page, expectedTitle) {
  const expected = String(expectedTitle ?? "").trim();
  if (!expected) throw new Error("set requires --expected-title");
  const observed = pageTitle(page).trim();
  if (observed !== expected) {
    throw new Error(`Workflow page title mismatch: expected \"${expected}\", observed \"${observed}\" (${page.id})`);
  }
  return observed;
}

function output(value, json) {
  process.stdout.write(`${json ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  loadDotEnv();
  const { command, options } = parse(process.argv.slice(2));
  // The film-library integration is the authoritative token for these pages.
  // A separate read-only token may not have access to pages created by it.
  const token = options.apply
    ? process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN
    : process.env.NOTION_TOKEN || process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_WRITE_TOKEN;
  if (!token) throw new Error(options.apply ? "NOTION_WRITE_TOKEN or NOTION_TOKEN is required" : "A Notion token is required");
  installNotionDnsOverride(process.env.NOTION_API_RESOLVE_IP);
  const clientOptions = { auth: token, timeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 120000) };
  let lastRequestStartedAt = 0;
  let requestQueue = Promise.resolve();
  clientOptions.fetch = (...args) => {
    const request = requestQueue.then(async () => {
      const waitMs = Math.max(0, 1000 - (Date.now() - lastRequestStartedAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastRequestStartedAt = Date.now();
      return nodeFetch(...args);
    });
    requestQueue = request.then(() => undefined, () => undefined);
    return request;
  };
  if (options.local_address) {
    clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.local_address });
    console.log(`direct local address: ${options.local_address}`);
  }
  const notion = new Client(clientOptions);
  const library = await loadLibrary(notion);
  const repository = openOptionalRepository(path.resolve(options.db));
  try {
    if (command === "schema") {
      const patch = workflowSchemaPatch(library.properties);
      if (options.apply && Object.keys(patch).length > 0) {
        await notion.dataSources.update({ data_source_id: library.id, properties: patch });
      }
      output({ mode: options.apply ? "apply" : "dry-run", dataSourceId: library.id, patch }, options.json);
      return;
    }

    assertWorkflowSchema(library.properties);
    if (command === "scan") {
      const pages = await queryActionable(notion, library.id, options.limit);
      output({
        checked: pages.length,
        rows: pages.map((page) => row(page, mirrorPage(repository, page)))
      }, options.json);
      return;
    }

    if (command === "reconcile") {
      const pageIds = (options.page_id ?? []).map(extractId).filter(Boolean);
      if (pageIds.length === 0 || pageIds.length > options.limit) {
        throw new Error(`reconcile requires between 1 and ${options.limit} --page-id values`);
      }
      const rows = [];
      for (const pageId of pageIds) {
        const page = await notion.pages.retrieve({ page_id: pageId });
        rows.push(row(page, mirrorPage(repository, page)));
      }
      output({ reconciled: rows.length, rows }, options.json);
      return;
    }

    if (command === "set") {
      const pageId = extractId(options.page_id?.[0]);
      if (!pageId || (!options.status && !options.release_visibility) || !options.expected_title) {
        throw new Error("set requires --page-id, --expected-title, and --status (unless --release-visibility is used)");
      }
      const page = await notion.pages.retrieve({ page_id: pageId });
      assertExpectedPageTitle(page, options.expected_title);
      const result = await applySet(notion, page, options);
      output({
        mode: options.apply ? "apply" : "dry-run",
        from: result.update.currentStatus,
        to: result.update.nextStatus,
        row: row(result.page, options.apply ? mirrorPage(repository, result.page) : null)
      }, options.json);
      return;
    }

    if (!options.apply) throw new Error("claim requires --apply because it changes Workflow Status");
    const pages = await queryActionable(notion, library.id, options.limit);
    const results = [];
    for (const candidate of pages) {
      const current = await notion.pages.retrieve({ page_id: candidate.id });
      const status = workflowStateFromPage(current);
      if (!AI_ACTIONABLE_WORKFLOW_STATES.includes(status)) continue;
      const result = await applySet(notion, current, {
        ...options,
        status: "AI 处理中",
        actor: "ai",
        note: pendingHumanWorkflowNoteFromPage(current)
          ? "已认领上述人工说明，开始处理。"
          : "已认领当前工作状态，开始处理。"
      });
      results.push(row(result.page, mirrorPage(repository, result.page)));
    }
    output({ claimed: results.length, rows: results }, options.json);
  } finally {
    repository?.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
