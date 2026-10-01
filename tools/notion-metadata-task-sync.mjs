import { config, projectEnv } from "./lib/project-secrets.mjs";
import fs from "node:fs";
import dns from "node:dns";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";

const DEFAULT_DB = ".local-data/wwp-film-workflow.sqlite";

function loadDotEnv() { config(); }

function parseArgs(argv) {
  const options = { db: DEFAULT_DB, limit: 3, apply: false, json: false, delayMs: 1000, pageIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.db = argv[++index];
    else if (arg === "--page-id") options.pageIds.push(argv[++index]);
    else if (arg === "--local-address") options.localAddress = argv[++index];
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--delay-ms") options.delayMs = Number(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/notion-metadata-task-sync.mjs [--page-id <id>] [--local-address <ip>] [--limit 3] [--delay-ms 1000] [--apply] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20");
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 1000) {
    throw new Error("--delay-ms must be at least 1000 to preserve Notion request-rate safety");
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
  if (property.type === "number") return typeof property.number === "number" ? String(property.number) : "";
  if (property.type === "date") return property.date?.start ?? "";
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

const RATING_FIELDS = ["豆瓣评分", "IMDB评分", "Metascore", "烂番茄新鲜度"];
const DAY_MS = 24 * 60 * 60 * 1000;

export function metadataRatingReviewPlan(page, { now = new Date() } = {}) {
  const properties = page.properties ?? {};
  const missingRatingFields = RATING_FIELDS.filter((name) => !plainText(properties[name]));
  if (missingRatingFields.length === 0) return { missingRatingFields, nextReviewAt: null };

  const releaseText = plainText(properties["上映日期"]);
  const releaseAt = releaseText ? new Date(`${releaseText.slice(0, 10)}T00:00:00.000Z`) : null;
  if (!releaseAt || Number.isNaN(releaseAt.getTime())) {
    return { missingRatingFields, nextReviewAt: null };
  }

  const nowAt = now instanceof Date ? now : new Date(now);
  const ageDays = Math.floor((nowAt.getTime() - releaseAt.getTime()) / DAY_MS);
  let nextAt;
  if (ageDays < 0) nextAt = new Date(releaseAt.getTime() + 7 * DAY_MS);
  else if (ageDays <= 30) nextAt = new Date(nowAt.getTime() + 7 * DAY_MS);
  else if (ageDays <= 90) nextAt = new Date(nowAt.getTime() + 14 * DAY_MS);
  else if (ageDays <= 180) nextAt = new Date(nowAt.getTime() + 30 * DAY_MS);
  else return { missingRatingFields, nextReviewAt: null };

  return {
    missingRatingFields,
    nextReviewAt: nextAt.toISOString(),
    reason: `Recent release is missing rating fields: ${missingRatingFields.join(", ")}`
  };
}

export function notionPageMissing(error) {
  return error?.code === "object_not_found"
    || error?.status === 404
    || /Could not find page with ID:/u.test(error instanceof Error ? error.message : String(error));
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
  const clientOptions = { auth: token, timeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000) };
  if (options.localAddress) {
    clientOptions.fetch = nodeFetch;
    clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.localAddress });
    console.log(`direct local address: ${options.localAddress}`);
  }
  const notion = new Client(clientOptions);
  const db = openLedger(options.db);
  const repo = createLedgerRepository(db);
  const requestedPageIds = new Set(options.pageIds.map((value) => value.replaceAll("-", "").toLowerCase()));
  const tasks = repo.listWorkflowTasks({
    taskType: "metadata_backfill",
    limit: requestedPageIds.size > 0 ? 20 : options.limit
  }).filter((task) => requestedPageIds.size === 0
    || requestedPageIds.has(String(task.notion_work_page_id ?? "").replaceAll("-", "").toLowerCase()));
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
      const ratingReview = metadataRatingReviewPlan(page);
      Object.assign(row, decision);
      Object.assign(row, ratingReview);
      if (decision.verified && options.apply) {
        repo.transitionWorkflowTask(task.id, "done", {
          reason: ratingReview.reason
            ? `Exact Notion readback is verified. ${ratingReview.reason}`
            : "Exact Notion readback: Metadata Status=verified, Needs Review=false, Human Issue and AI Issue empty.",
          nextRunAt: ratingReview.nextReviewAt ?? undefined
        });
        row.action = "completed";
      } else if (decision.verified) {
        row.action = "would_complete";
      }
    } catch (error) {
      row.reason = error instanceof Error ? error.message : String(error);
      if (notionPageMissing(error)) {
        row.action = options.apply ? "closed_missing_page" : "would_close_missing_page";
        row.reason = "Notion work page no longer exists; historical metadata task closed without inventing metadata.";
        if (options.apply) {
          repo.transitionWorkflowTask(task.id, "done", { reason: row.reason });
    }
    if (task !== tasks[tasks.length - 1]) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }
    }
    rows.push(row);
  }
  const result = { mode: options.apply ? "apply" : "dry-run", inspected: rows.length, completed: rows.filter((row) => row.action === "completed").length, rows };
  process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
