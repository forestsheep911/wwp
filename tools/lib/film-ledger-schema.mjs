import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 4;

const SCHEMA_SQL = `
CREATE TABLE schema_meta (version INTEGER NOT NULL);
CREATE TABLE input_roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_scan_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE works (
  id INTEGER PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  year INTEGER,
  work_type TEXT NOT NULL DEFAULT 'movie',
  notion_work_page_id TEXT UNIQUE,
  priority_score REAL NOT NULL DEFAULT 0,
  scope_state TEXT NOT NULL DEFAULT 'candidate',
  next_review_at TEXT,
  workflow_status TEXT CHECK (workflow_status IS NULL OR workflow_status IN (
    '待 AI 处理', 'AI 处理中', '待人工上传', '人工上传中', '已上传待 AI 收尾',
    '待人工确认', '已确认待 AI 发布', '已完成', '暂缓'
  )),
  workflow_note TEXT,
  workflow_status_observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (canonical_title, year, work_type)
);
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  input_root_id INTEGER NOT NULL REFERENCES input_roots(id),
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  probe_path TEXT,
  quality_state TEXT NOT NULL DEFAULT 'unknown',
  subtitle_evidence TEXT,
  audio_evidence TEXT,
  color_risk TEXT NOT NULL DEFAULT 'unknown',
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (input_root_id, relative_path),
  UNIQUE (input_root_id, fingerprint)
);
CREATE TABLE variants (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  source_id INTEGER REFERENCES sources(id),
  spec_key TEXT NOT NULL,
  display_title TEXT NOT NULL,
  audio_variant TEXT NOT NULL DEFAULT 'unknown',
  subtitle_variant TEXT NOT NULL DEFAULT 'unknown',
  cut_variant TEXT NOT NULL DEFAULT 'theatrical',
  target_size_bytes INTEGER,
  output_path TEXT,
  output_size_bytes INTEGER,
  probe_path TEXT,
  qc_artifact_path TEXT,
  production_state TEXT NOT NULL DEFAULT 'discovered',
  publication_state TEXT NOT NULL DEFAULT 'not_ready',
  failure_code TEXT,
  failure_detail TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (work_id, spec_key)
);
CREATE TABLE notion_targets (
  variant_id INTEGER PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  work_page_id TEXT NOT NULL,
  season_page_id TEXT,
  spec_page_id TEXT NOT NULL,
  episode_page_id TEXT,
  expected_filename TEXT,
  media_block_id TEXT,
  media_asset_page_id TEXT,
  structure_verified_at TEXT,
  media_verified_at TEXT,
  assets_verified_at TEXT,
  next_check_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_detail TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE scheduler_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE workflow_tasks (
  id INTEGER PRIMARY KEY,
  task_key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL CHECK (task_type IN ('intake', 'metadata_backfill')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'waiting_user', 'deferred', 'done')),
  source_id INTEGER REFERENCES sources(id),
  work_id INTEGER REFERENCES works(id),
  variant_id INTEGER REFERENCES variants(id),
  priority_score REAL NOT NULL DEFAULT 0,
  reason TEXT,
  payload_json TEXT,
  last_error TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workflow_tasks_due_idx ON workflow_tasks (task_type, status, next_run_at, priority_score DESC, created_at);
CREATE INDEX workflow_handoff_status_idx ON works (workflow_status, workflow_status_observed_at, priority_score DESC);
`;

function migrateV1ToV2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_tasks (
      id INTEGER PRIMARY KEY,
      task_key TEXT NOT NULL UNIQUE,
      task_type TEXT NOT NULL CHECK (task_type IN ('intake', 'metadata_backfill')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'waiting_user', 'deferred', 'done')),
      source_id INTEGER REFERENCES sources(id),
      work_id INTEGER REFERENCES works(id),
      variant_id INTEGER REFERENCES variants(id),
      priority_score REAL NOT NULL DEFAULT 0,
      reason TEXT,
      payload_json TEXT,
      last_error TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workflow_tasks_due_idx ON workflow_tasks (task_type, status, next_run_at, priority_score DESC, created_at);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO workflow_tasks
    (task_key, task_type, status, work_id, priority_score, reason, created_at, updated_at)
    SELECT 'metadata:work:' || id, 'metadata_backfill', 'pending', id, priority_score,
      'Existing ledger work requires work-level metadata review/backfill', ?, ? FROM works`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO workflow_tasks
    (task_key, task_type, status, source_id, priority_score, reason, created_at, updated_at)
    SELECT 'intake:source:' || id, 'intake', 'pending', id, 0,
      'Discovered source has not been bound to a verified work identity', ?, ?
    FROM sources WHERE work_id IS NULL AND missing = 0`).run(now, now);
  db.prepare("UPDATE schema_meta SET version=?").run(2);
}

function migrateV2ToV3(db) {
  db.exec(`
    ALTER TABLE works ADD COLUMN workflow_status TEXT CHECK (workflow_status IS NULL OR workflow_status IN (
      '待 AI 处理', 'AI 处理中', '待人工上传', '人工上传中', '已上传待 AI 收尾',
      '待人工确认', '已确认待 AI 发布', '已完成', '暂缓'
    ));
    ALTER TABLE works ADD COLUMN workflow_note TEXT;
    ALTER TABLE works ADD COLUMN workflow_status_observed_at TEXT;
    CREATE INDEX IF NOT EXISTS workflow_handoff_status_idx
      ON works (workflow_status, workflow_status_observed_at, priority_score DESC);
  `);
  db.prepare("UPDATE schema_meta SET version=?").run(3);
}

function migrateV3ToV4(db) {
  const targetTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='notion_targets'"
  ).get();
  if (targetTable?.present) db.exec("ALTER TABLE notion_targets ADD COLUMN season_page_id TEXT;");
  db.prepare("UPDATE schema_meta SET version=?").run(4);
}

export function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openLedger(filePath) {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new DatabaseSync(filePath);

  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");

    const schemaExists = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'"
    ).get();

    if (!schemaExists) {
      withTransaction(db, () => {
        db.exec(SCHEMA_SQL);
        db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION);
      });
    } else {
      const row = db.prepare("SELECT version FROM schema_meta").get();
      let version = row?.version;
      if (version === 1) {
        migrateV1ToV2(db);
        version = 2;
      }
      if (version === 2) {
        migrateV2ToV3(db);
        version = 3;
      }
      if (version === 3) {
        migrateV3ToV4(db);
        version = 4;
      }
      if (version !== SCHEMA_VERSION) throw new Error(`unsupported film ledger schema version: ${version ?? "missing"}`);
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
