#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { openLedger } from "../../../../tools/lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "../../../../tools/lib/film-ledger-repository.mjs";
import { installNotionDnsOverride } from "../../../../tools/lib/notion-network.mjs";
import { compareNotionMediaType } from "../../../../tools/lib/work-media-type.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_REPORT = path.resolve(".local-data/metadata-completion-audit.json");
const CORE_FIELDS = [
  "Simplified Chinese Title",
  "Release Year",
  "上映日期",
  "Countries",
  "Languages",
  "旨趣",
  "外部类型原文",
  "Runtime Minutes",
  "Directors",
  "Cast",
  "Poster URL",
  "AI建议最低年龄",
  "AI年龄建议置信度",
  "内容风险标签",
  "AI年龄建议理由"
];

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function parseArgs(argv) {
  const options = {
    apply: false,
    db: DEFAULT_DB,
    report: DEFAULT_REPORT,
    limit: Number.POSITIVE_INFINITY,
    concurrency: 3,
    delayMs: 900
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (["--db", "--report", "--limit", "--concurrency", "--delay-ms"].includes(arg)) {
      const value = argv[++index];
      if (value == null) throw new Error(`${arg} requires a value`);
      if (arg === "--db") options.db = path.resolve(value);
      else if (arg === "--report") options.report = path.resolve(value);
      else if (arg === "--limit") options.limit = Math.max(1, Number(value));
      else if (arg === "--concurrency") options.concurrency = Math.min(3, Math.max(1, Number(value)));
      else options.delayMs = Math.max(0, Number(value));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function propertyText(property) {
  if (!property || typeof property !== "object") return "";
  if (property.type === "title") return (property.title ?? []).map(item => item.plain_text ?? "").join("").trim();
  if (property.type === "rich_text") return (property.rich_text ?? []).map(item => item.plain_text ?? "").join("").trim();
  if (property.type === "url") return `${property.url ?? ""}`.trim();
  if (property.type === "number") return property.number == null ? "" : `${property.number}`;
  if (property.type === "select") return `${property.select?.name ?? ""}`.trim();
  if (property.type === "multi_select") return (property.multi_select ?? []).map(item => item.name).filter(Boolean).join(" / ");
  if (property.type === "date") return `${property.date?.start ?? ""}`.trim();
  if (property.type === "files") return (property.files ?? []).map(item => item.name ?? item.file?.url ?? item.external?.url).filter(Boolean).join(" / ");
  if (property.type === "checkbox") return property.checkbox ? "true" : "false";
  return "";
}

function titleFromProperties(properties) {
  const titleProperty = Object.values(properties).find(property => property?.type === "title");
  return propertyText(titleProperty);
}

export function auditPage(task, page) {
  const properties = page.properties ?? {};
  const values = Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, propertyText(property)]));
  const hasExternalId = Boolean(
    values["IMDb ID"] || values.imdb || values["Douban Subject ID"] || values["TMDB ID"]
  );
  const missingCoreFields = CORE_FIELDS.filter(field => !values[field]);
  const unresolvedIssues = ["Human Issue", "AI Issue"].filter(field => values[field]);
  const mediaType = compareNotionMediaType(task.work_type, values["影别"]);
  const derivedStatus = hasExternalId && missingCoreFields.length === 0 && unresolvedIssues.length === 0
    ? "verified"
    : hasExternalId
      ? "partial"
      : "draft";
  const recordedStatus = values["Metadata Status"] || "";
  const reasons = [
    recordedStatus !== "verified" ? `Metadata Status=${recordedStatus || "empty"}` : undefined,
    !hasExternalId ? "external identity missing" : undefined,
    missingCoreFields.length ? `missing core: ${missingCoreFields.join(", ")}` : undefined,
    unresolvedIssues.length ? `unresolved issues: ${unresolvedIssues.join(", ")}` : undefined,
    !mediaType.matches
      ? `影别=${mediaType.actual ?? "empty"}; expected ${mediaType.expected} from ledger work_type=${task.work_type}`
      : undefined
  ].filter(Boolean);
  return {
    taskId: task.task_id,
    workId: task.work_id,
    pageId: task.notion_work_page_id,
    ledgerTitle: task.canonical_title,
    notionTitle: titleFromProperties(properties),
    recordedStatus,
    derivedStatus,
    hasExternalId,
    missingCoreFields,
    unresolvedIssues,
    workType: task.work_type,
    notionMediaType: mediaType.actual,
    expectedNotionMediaType: mediaType.expected,
    mediaTypeMatches: mediaType.matches,
    posterUrlPresent: Boolean(values["Poster URL"]),
    posterFilePresent: Boolean(values["海报"]),
    needsRequeue: reasons.length > 0,
    reasons
  };
}

function requeueReason(record) {
  return [
    "Metadata completion audit reopened this task under plugin 0.1.26.",
    ...record.reasons,
    `posterUrlPresent=${record.posterUrlPresent}`,
    `posterFilePresent=${record.posterFilePresent}`
  ].join(" ");
}

async function auditBatch(notion, tasks) {
  return Promise.all(tasks.map(async task => {
    try {
      const page = await notion.pages.retrieve({ page_id: task.notion_work_page_id });
      return auditPage(task, page);
    } catch (error) {
      return {
        taskId: task.task_id,
        workId: task.work_id,
        pageId: task.notion_work_page_id,
        ledgerTitle: task.canonical_title,
        recordedStatus: "unknown",
        derivedStatus: "unknown",
        hasExternalId: false,
        missingCoreFields: [],
        unresolvedIssues: [],
        posterUrlPresent: false,
        posterFilePresent: false,
        needsRequeue: true,
        reasons: [`page readback failed: ${error?.message ?? error}`]
      };
    }
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadDotEnv();
  installNotionDnsOverride(process.env.NOTION_API_RESOLVE_IP?.trim());
  const token = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_READ_ONLY_TOKEN or NOTION_TOKEN is required");
  const notion = new Client({ auth: token });

  const db = openLedger(options.db);
  const repository = createLedgerRepository(db);
  const tasks = db.prepare(`SELECT workflow_tasks.id AS task_id, workflow_tasks.work_id,
      works.canonical_title, works.work_type, works.notion_work_page_id
    FROM workflow_tasks JOIN works ON works.id=workflow_tasks.work_id
    WHERE workflow_tasks.task_type='metadata_backfill'
      AND workflow_tasks.status='done'
      AND works.notion_work_page_id IS NOT NULL
    ORDER BY workflow_tasks.updated_at DESC, workflow_tasks.id ASC
    LIMIT ?`).all(Number.isFinite(options.limit) ? options.limit : 1000000);

  const records = [];
  for (let index = 0; index < tasks.length; index += options.concurrency) {
    records.push(...await auditBatch(notion, tasks.slice(index, index + options.concurrency)));
    if (index + options.concurrency < tasks.length && options.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }
  }

  const requeue = records.filter(record => record.needsRequeue);
  if (options.apply) {
    for (const record of requeue) {
      repository.requeueMetadataTask(record.workId, { reason: requeueReason(record) });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply: options.apply,
    database: options.db,
    summary: {
      auditedDoneTasks: records.length,
      verifiedAndRecorded: records.length - requeue.length,
      needsRequeue: requeue.length,
      missingPosterUrl: records.filter(record => !record.posterUrlPresent).length,
      missingPosterFile: records.filter(record => !record.posterFilePresent).length,
      readbackFailures: records.filter(record => record.derivedStatus === "unknown").length
    },
    records
  };
  await mkdir(path.dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report: options.report, ...report.summary }, null, 2));
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
