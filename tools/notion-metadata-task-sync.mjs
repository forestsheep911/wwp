import fs from "node:fs";
import dns from "node:dns";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";

const DEFAULT_DB = ".local-data/wwp-film-workflow.sqlite";

function loadDotEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].trim();
  }
}

function parseArgs(argv) {
  const options = { db: DEFAULT_DB, limit: 3, apply: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.db = argv[++index];
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/notion-metadata-task-sync.mjs [--limit 3] [--apply] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20");
  }
  return options;
}

function installNotionDnsOverride() {
  const ip = process.env.NOTION_API_RESOLVE_IP?.trim();
  if (!ip) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = ((hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, ip, 4);
      if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
      return callback(null, ip, 4);
    }
    return originalLookup(hostname, options, callback);
  });
}

function plainText(property) {
  if (!property) return "";
  if (property.type === "checkbox") return property.checkbox ? "true" : "false";
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "multi_select") return (property.multi_select ?? []).map((item) => item.name).join(",");
  return (property.title ?? property.rich_text ?? []).map((item) => item.plain_text ?? "").join("");
}

function titleFromPage(page) {
  return Object.values(page.properties ?? {}).find((property) => property.type === "title")?.title
    ?.map((item) => item.plain_text ?? "").join("") ?? "(untitled)";
}

export function metadataReadbackDecision(page) {
  const properties = page.properties ?? {};
  const status = plainText(properties["Metadata Status"]);
  const needsReview = plainText(properties["Needs Review"]);
  const humanIssue = plainText(properties["Human Issue"]);
  const aiIssue = plainText(properties["AI Issue"]);
  return {
    verified: status === "verified" && needsReview !== "true" && !humanIssue && !aiIssue,
    status,
    needsReview,
    humanIssue,
    aiIssue
  };
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  installNotionDnsOverride();
  // This command only reads Notion pages. The write integration may not be
  // shared with every historical page, while the read integration is the
  // canonical catalog reader. Use it first so permission gaps are not
  // misreported as deleted pages.
  const token = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN is required.");
  const notion = new Client({ auth: token, timeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000) });
  const db = openLedger(options.db);
  const repo = createLedgerRepository(db);
  const tasks = repo.listWorkflowTasks({ taskType: "metadata_backfill", limit: options.limit });
  const rows = [];
  for (const task of tasks) {
    const row = {
      taskId: task.id,
      workId: task.work_id,
      title: task.canonical_title,
      pageId: task.notion_work_page_id,
      action: "kept_pending"
    };
    if (!task.notion_work_page_id) {
      row.reason = "missing_notion_work_page";
      rows.push(row);
      continue;
    }
    try {
      const page = await notion.pages.retrieve({ page_id: task.notion_work_page_id });
      const decision = metadataReadbackDecision(page);
      Object.assign(row, decision);
      if (decision.verified && options.apply) {
        repo.transitionWorkflowTask(task.id, "done", {
          reason: "Exact Notion readback: Metadata Status=verified, Needs Review=false, Human Issue and AI Issue empty."
        });
        row.action = "completed";
      } else if (decision.verified) {
        row.action = "would_complete";
      }
    } catch (error) {
      row.reason = error instanceof Error ? error.message : String(error);
    }
    rows.push(row);
  }
  const result = { mode: options.apply ? "apply" : "dry-run", inspected: rows.length, completed: rows.filter((row) => row.action === "completed").length, rows };
  process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
