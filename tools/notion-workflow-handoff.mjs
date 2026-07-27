#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@notionhq/client";
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
  pageTitle,
  workflowNoteFromPage,
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
  const values = new Set(["--page-id", "--status", "--note", "--actor", "--limit", "--db"]);
  const booleans = new Set(["--apply", "--json"]);
  const options = { db: DEFAULT_DB, apply: false, json: false };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (argv[i + 1] == null || argv[i + 1].startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = argv[++i];
    } else if (booleans.has(arg)) {
      options[arg.slice(2)] = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 1 || !["schema", "scan", "claim", "set"].includes(positionals[0])) {
    throw new Error("command must be schema|scan|claim|set");
  }
  const limit = normalizeLimit(options.limit, 3, 3);
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
  const result = repository.repo.recordWorkHandoffByNotionPage(page.id, {
    status: workflowStateFromPage(page),
    note: workflowNoteFromPage(page),
    actor: "notion",
    observedAt
  });
  return result.unmatched
    ? { matched: false, reason: "work_page_not_in_ledger" }
    : { matched: true, workId: result.row.id, changed: result.changed };
}

function row(page, mirror) {
  return {
    pageId: page.id,
    title: pageTitle(page),
    status: workflowStateFromPage(page),
    note: workflowNoteFromPage(page),
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
  const update = buildWorkflowUpdate(page, {
    status: options.status,
    note: options.note,
    actor: options.actor ?? "ai",
    at: new Date().toISOString(),
    enforceTransition: true
  });
  if (!options.apply) return { page, update, applied: false };
  const updated = await notion.pages.update({ page_id: page.id, properties: update.properties });
  return { page: updated, update, applied: true };
}

function output(value, json) {
  process.stdout.write(`${json ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  loadDotEnv();
  const { command, options } = parse(process.argv.slice(2));
  const token = options.apply
    ? process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
  if (!token) throw new Error(options.apply ? "NOTION_WRITE_TOKEN or NOTION_TOKEN is required" : "A Notion token is required");
  installNotionDnsOverride(process.env.NOTION_API_RESOLVE_IP);
  const notion = new Client({ auth: token, timeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 120000) });
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

    if (command === "set") {
      const pageId = extractId(options.page_id);
      if (!pageId || !options.status) throw new Error("set requires --page-id and --status");
      const page = await notion.pages.retrieve({ page_id: pageId });
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
        note: options.note ?? `已领取交接任务，原状态：${status}。`
      });
      results.push(row(result.page, mirrorPage(repository, result.page)));
    }
    output({ claimed: results.length, rows: results }, options.json);
  } finally {
    repository?.db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

