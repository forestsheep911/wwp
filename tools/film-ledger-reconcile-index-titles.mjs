#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openLedger, withTransaction } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_INDEX = path.resolve(".local-data/home-site/search-index.json");

export function parseArgs(argv) {
  const options = { db: DEFAULT_DB, index: DEFAULT_INDEX, doubanProgress: "", limit: 10, apply: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index];
    if (arg === "--db") options.db = path.resolve(value());
    else if (arg === "--index") options.index = path.resolve(value());
    else if (arg === "--douban-progress") options.doubanProgress = path.resolve(value());
    else if (arg === "--limit") options.limit = Number(value());
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  return options;
}

export function indexTitlesByPageId(indexDocument) {
  const result = new Map();
  for (const entry of Object.values(indexDocument?.entries ?? {})) {
    const pageId = String(entry?.sourcePageId ?? "").trim().toLowerCase();
    const title = String(entry?.title ?? "").trim();
    if (pageId && title && entry?.source === "Notion library") result.set(pageId, title);
  }
  return result;
}

export function safeYearSuffixCorrection(work, indexedTitle) {
  if (!work?.year || !indexedTitle) return null;
  const current = String(work.canonical_title ?? "").trim();
  const expected = `${current} (${work.year})`;
  if (indexedTitle !== expected) return null;
  return { workId: work.id, pageId: work.notion_work_page_id, before: current, after: indexedTitle, evidence: "exact_year_suffix" };
}

export function latestDoubanProgressByPageId(jsonl) {
  const result = new Map();
  for (const line of String(jsonl ?? "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const pageId = String(entry?.pageId ?? "").trim().toLowerCase();
      if (pageId) result.set(pageId, entry);
    } catch {
      // A partial trailing JSONL line is ignored; no evidence is safer than guessing.
    }
  }
  return result;
}

export function safeDoubanProgressCorrection(work, indexedTitle, evidence) {
  if (!indexedTitle || !evidence?.subjectId || !["updated", "skipped"].includes(evidence.status)) return null;
  if (String(evidence.title ?? "").trim() !== indexedTitle) return null;
  const current = String(work.canonical_title ?? "").trim();
  if (!current || current === indexedTitle) return null;
  return {
    workId: work.id,
    pageId: work.notion_work_page_id,
    before: current,
    after: indexedTitle,
    evidence: "douban_progress_exact_title",
    doubanSubjectId: String(evidence.subjectId),
    evidenceRecordedAt: evidence.recordedAt ?? null
  };
}

export function collectCorrections(db, indexDocument, limit, doubanProgressDocument = "") {
  const titles = indexTitlesByPageId(indexDocument);
  const progress = latestDoubanProgressByPageId(doubanProgressDocument);
  const works = db.prepare(`SELECT id, canonical_title, year, notion_work_page_id, priority_score
    FROM works
    WHERE notion_work_page_id IS NOT NULL AND year IS NOT NULL
    ORDER BY priority_score DESC, id ASC`).all();
  return works
    .map((work) => {
      const pageId = String(work.notion_work_page_id).toLowerCase();
      const indexedTitle = titles.get(pageId);
      return safeYearSuffixCorrection(work, indexedTitle)
        ?? safeDoubanProgressCorrection(work, indexedTitle, progress.get(pageId));
    })
    .filter(Boolean)
    .slice(0, limit);
}

export function run(options) {
  if (!fs.existsSync(options.index)) throw new Error(`Search index not found: ${options.index}`);
  if (options.doubanProgress && !fs.existsSync(options.doubanProgress)) {
    throw new Error(`Douban progress file not found: ${options.doubanProgress}`);
  }
  const indexDocument = JSON.parse(fs.readFileSync(options.index, "utf8"));
  const doubanProgressDocument = options.doubanProgress ? fs.readFileSync(options.doubanProgress, "utf8") : "";
  const db = openLedger(options.db);
  try {
    const corrections = collectCorrections(db, indexDocument, options.limit, doubanProgressDocument);
    const applied = [];
    if (options.apply && corrections.length) {
      const repo = createLedgerRepository(db);
      withTransaction(db, () => {
        for (const correction of corrections) {
          const work = repo.renameWork(correction.workId, correction.after, { expectedCurrent: correction.before });
          applied.push({ ...correction, updatedAt: work.updated_at });
        }
      });
    }
    return {
      mode: options.apply ? "apply" : "dry_run",
      index: options.index,
      doubanProgress: options.doubanProgress || null,
      correctionCount: corrections.length,
      corrections,
      applied
    };
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = run(options);
  console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
}
