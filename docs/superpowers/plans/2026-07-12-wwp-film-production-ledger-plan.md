# WWP Film Production Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broad Notion watcher scans with a local SQLite production ledger, bounded production/publication queues, and targeted Notion reconciliation for known page IDs.

**Architecture:** A local SQLite database under `.local-data` stores sources, works, variants, Notion targets, scheduler state, and events. Pure domain functions define legal transitions and queue eligibility; filesystem watchers only upsert local discovery records, while a separate reconciler checks at most three due Notion targets by explicit page ID. Existing encoder, upload, and Media Assets scripts remain the execution engines and report state through the ledger CLI.

**Tech Stack:** Node.js 25+, ESM, built-in `node:sqlite`, `node:test`, existing `@notionhq/client` runtime in the repository, PowerShell-compatible CLI commands.

## Global Constraints

- SQLite file: `.local-data/wwp-film-workflow.sqlite`; it remains ignored by Git.
- Input roots are runtime data and may be any user-specified directory; never hard-code `I:\MAKE\queue`.
- Default production batch limit is 5; default Notion reconciliation limit is 3.
- `qc_passed` removes a variant from production candidates but not publication work.
- Only `sync_ready` removes a variant from all ordinary observation queues.
- Automatic Notion work may access only ledger-recorded page IDs; no database-wide or recent-page watcher scans.
- A Notion 429 opens a global 60-minute circuit breaker. API failures never mean “no upload”.
- Spec size labels use measured decimal bytes, not filenames or stale placeholder titles.
- Human-confirmed audio/color/QC evidence overrides filename and `Chinese`/`zho` metadata guesses.
- All new behavior follows RED-GREEN-REFACTOR with a witnessed failing test before production code.

---

## File Structure

- Create `tools/lib/film-ledger-schema.mjs`: schema version, SQL migrations, database opening and transaction helpers.
- Create `tools/lib/film-ledger-domain.mjs`: state constants, transition validation, `sync_ready` gate, retry scheduling and queue selection predicates.
- Create `tools/lib/film-ledger-repository.mjs`: typed repository operations for roots, works, sources, variants, targets, events and scheduler state.
- Create `tools/lib/film-ledger-discovery.mjs`: normalize scanner payloads, compute stable fingerprints and upsert discovery records.
- Create `tools/lib/film-ledger-notion.mjs`: due-target selection, circuit breaker, targeted Notion inspection and state advancement.
- Create `tools/film-ledger.mjs`: CLI composition only; no domain logic.
- Create matching `*.test.mjs` files beside each module.
- Modify `.codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs`: optional `--ledger` sink after each local scan.
- Modify `.codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs`: ledger integration test.
- Delete `tools/watch-notion-manual-uploads.mjs`: remove the broad background watcher.
- Modify `package.json`: add ledger commands and remove any watcher entry if present.
- Modify `.codex/plugins/wwp-film-workflow/references/script-map.md` and `skills/wwp-media-assets-backfiller/SKILL.md`: document the targeted ledger workflow.

---

### Task 1: SQLite Schema and Safe Database Lifecycle

**Files:**
- Create: `tools/lib/film-ledger-schema.mjs`
- Test: `tools/lib/film-ledger-schema.test.mjs`

**Interfaces:**
- Produces: `openLedger(filePath: string): DatabaseSync`
- Produces: `withTransaction<T>(db: DatabaseSync, fn: () => T): T`
- Produces: `SCHEMA_VERSION: number`
- Consumes: built-in `node:sqlite`

- [ ] **Step 1: Write the failing schema test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger, SCHEMA_VERSION } from "./film-ledger-schema.mjs";

test("openLedger creates the complete versioned schema", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-schema-"));
  try {
    const db = openLedger(path.join(dir, "ledger.sqlite"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    for (const name of ["input_roots", "works", "sources", "variants", "notion_targets", "events", "scheduler_state"]) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }
    assert.equal(db.prepare("SELECT version FROM schema_meta").get().version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tools/lib/film-ledger-schema.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `film-ledger-schema.mjs`.

- [ ] **Step 3: Implement schema version 1**

Create `film-ledger-schema.mjs` with `DatabaseSync`, parent-directory creation, `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, and one transaction containing these tables:

```sql
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
```

Implement transaction handling as:

```js
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
```

- [ ] **Step 4: Run the schema test and verify GREEN**

Run: `node --test tools/lib/film-ledger-schema.test.mjs`

Expected: PASS with one test and no warnings.

- [ ] **Step 5: Commit Task 1**

```powershell
git add tools/lib/film-ledger-schema.mjs tools/lib/film-ledger-schema.test.mjs
git commit -m "Add SQLite film ledger schema"
```

---

### Task 2: Domain States, Final Gate, and Bounded Selection

**Files:**
- Create: `tools/lib/film-ledger-domain.mjs`
- Test: `tools/lib/film-ledger-domain.test.mjs`

**Interfaces:**
- Produces: `PRODUCTION_STATES`, `PUBLICATION_STATES`
- Produces: `assertProductionTransition(from, to)` and `assertPublicationTransition(from, to)`
- Produces: `isSyncReady(evidence)`
- Produces: `nextRetryAt({ now, attemptCount, rateLimited })`
- Produces: `normalizeLimit(value, fallback, maximum)`

- [ ] **Step 1: Write failing domain tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProductionTransition,
  assertPublicationTransition,
  isSyncReady,
  nextRetryAt,
  normalizeLimit
} from "./film-ledger-domain.mjs";

test("qc_passed does not imply final sync readiness", () => {
  assert.equal(isSyncReady({ qcPassed: true, structureVerified: false, mediaVerified: false, assetsVerified: false }), false);
  assert.equal(isSyncReady({ qcPassed: true, structureVerified: true, mediaVerified: true, assetsVerified: true }), true);
});

test("state transitions reject skipping required gates", () => {
  assert.throws(() => assertProductionTransition("discovered", "qc_passed"), /illegal production transition/);
  assert.throws(() => assertPublicationTransition("upload_pending", "sync_ready"), /illegal publication transition/);
});

test("Notion 429 opens a sixty minute retry window", () => {
  assert.equal(nextRetryAt({ now: "2026-07-12T00:00:00.000Z", attemptCount: 1, rateLimited: true }), "2026-07-12T01:00:00.000Z");
});

test("queue limits stay bounded", () => {
  assert.equal(normalizeLimit(undefined, 5, 5), 5);
  assert.equal(normalizeLimit(99, 5, 5), 5);
  assert.equal(normalizeLimit(2, 5, 5), 2);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tools/lib/film-ledger-domain.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal state rules**

Use explicit adjacency maps:

```js
const productionTransitions = {
  discovered: ["evaluated", "deferred", "rejected"],
  evaluated: ["selected", "deferred", "rejected"],
  selected: ["encoding", "deferred", "rejected"],
  encoding: ["qc_failed", "qc_passed"],
  qc_failed: ["selected", "deferred", "rejected"],
  deferred: ["evaluated", "selected", "rejected"],
  qc_passed: [],
  rejected: []
};

const publicationTransitions = {
  not_ready: ["structure_pending"],
  structure_pending: ["upload_pending"],
  upload_pending: ["upload_seen"],
  upload_seen: ["assets_pending"],
  assets_pending: ["verification_pending"],
  verification_pending: ["sync_ready", "assets_pending", "structure_pending"],
  sync_ready: []
};
```

`isSyncReady` returns true only when all four evidence flags are true. `nextRetryAt` uses 60 minutes for 429 and exponential delays of 5, 15, 30 and 60 minutes for other failures. `normalizeLimit` clamps to `1..maximum`.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `node --test tools/lib/film-ledger-domain.test.mjs`

Expected: PASS with four tests.

- [ ] **Step 5: Commit Task 2**

```powershell
git add tools/lib/film-ledger-domain.mjs tools/lib/film-ledger-domain.test.mjs
git commit -m "Define film ledger workflow states"
```

---

### Task 3: Repository Operations and Event Audit

**Files:**
- Create: `tools/lib/film-ledger-repository.mjs`
- Test: `tools/lib/film-ledger-repository.test.mjs`

**Interfaces:**
- Consumes: `openLedger`, `withTransaction`, domain transition validators
- Produces: `createLedgerRepository(db, { now })`
- Repository methods: `upsertInputRoot`, `upsertDiscoveredSource`, `ensureWork`, `ensureVariant`, `transitionProduction`, `transitionPublication`, `registerNotionTarget`, `listProductionCandidates`, `listPublicationCandidates`, `getStatusSummary`

- [ ] **Step 1: Write a failing end-to-end repository test**

```js
test("repository keeps qc-passed work out of production but in publication", () => {
  const repo = createTempRepository();
  const root = repo.upsertInputRoot("X:\\queue");
  const work = repo.ensureWork({ canonicalTitle: "Example", year: 2025, workType: "movie" });
  const source = repo.upsertDiscoveredSource({
    inputRootId: root.id,
    workId: work.id,
    relativePath: "Example",
    absolutePath: "X:\\queue\\Example",
    fingerprint: "v1",
    sourceKind: "folder"
  });
  const variant = repo.ensureVariant({ workId: work.id, sourceId: source.id, specKey: "mainland-mandarin+chs+compact", displayTitle: "Example 国配简 1.4GB" });
  repo.transitionProduction(variant.id, "evaluated");
  repo.transitionProduction(variant.id, "selected");
  repo.transitionProduction(variant.id, "encoding");
  repo.transitionProduction(variant.id, "qc_passed", { outputPath: "E:\\video_made\\Example.mp4", outputSizeBytes: 1_394_073_253 });
  repo.transitionPublication(variant.id, "structure_pending");

  assert.deepEqual(repo.listProductionCandidates({ limit: 5 }), []);
  assert.equal(repo.listPublicationCandidates({ limit: 3 })[0].id, variant.id);
  assert.equal(repo.getEvents({ entityType: "variant", entityId: variant.id }).at(-1).event_type, "publication_state_changed");
});
```

Add a second test proving duplicate input roots, sources, works and variants return existing rows rather than inserting duplicates.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `node --test tools/lib/film-ledger-repository.test.mjs`

Expected: FAIL because `createLedgerRepository` is missing.

- [ ] **Step 3: Implement repository methods with prepared statements**

Requirements:

- All state transitions run inside `withTransaction` and append one event.
- `transitionProduction(..., "qc_passed")` updates measured output fields and sets publication state to `not_ready` until explicitly advanced.
- Production query excludes `qc_passed`, `rejected`, and future `next_review_at` rows and uses `ORDER BY works.priority_score DESC, variants.created_at ASC LIMIT ?`.
- Publication query requires `production_state = 'qc_passed'`, excludes `sync_ready`, requires a due `next_check_at` when a target exists, and uses `LIMIT ?`.
- `registerNotionTarget` upserts only by `variant_id` and never loses verified timestamps.
- Event payloads are stable JSON strings.

- [ ] **Step 4: Run repository, domain and schema tests**

Run: `node --test tools/lib/film-ledger-schema.test.mjs tools/lib/film-ledger-domain.test.mjs tools/lib/film-ledger-repository.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add tools/lib/film-ledger-repository.mjs tools/lib/film-ledger-repository.test.mjs
git commit -m "Add film ledger repository"
```

---

### Task 4: Discovery Import and Ledger CLI

**Files:**
- Create: `tools/lib/film-ledger-discovery.mjs`
- Create: `tools/lib/film-ledger-discovery.test.mjs`
- Create: `tools/film-ledger.mjs`
- Create: `tools/film-ledger.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: scan payload shape from `scan-input-directory.mjs`
- Produces: `fingerprintEntry(entry)` and `importScan(repo, payload)`
- CLI commands: `init`, `discover`, `next`, `status`, `show`, `record-qc`, `register-target`

- [ ] **Step 1: Write failing fingerprint and idempotency tests**

```js
test("importScan is idempotent and reopens changed source evidence", () => {
  const payload = {
    root: "X:\\queue",
    scannedAt: "2026-07-12T00:00:00.000Z",
    entries: [{
      name: "Example.Movie.2025",
      relativePath: "Example.Movie.2025",
      fileCount: 2,
      mediaCount: 1,
      subtitleCount: 1,
      nfoCount: 0,
      totalBytes: 1000,
      largestMedia: [{ relativePath: "Example.Movie.2025\\movie.mkv", bytes: 900, extension: ".mkv" }],
      subtitleHints: ["chs"],
      flags: { looksSeries: false, looksDv: false, looksHdr: false }
    }]
  };
  assert.deepEqual(importScan(repo, payload).summary, { inserted: 1, unchanged: 0, changed: 0, missing: 0 });
  assert.deepEqual(importScan(repo, payload).summary, { inserted: 0, unchanged: 1, changed: 0, missing: 0 });
  payload.entries[0].totalBytes = 1200;
  assert.deepEqual(importScan(repo, payload).summary, { inserted: 0, unchanged: 0, changed: 1, missing: 0 });
});
```

Write a CLI test that spawns:

```powershell
node tools/film-ledger.mjs --db <temp.sqlite> init
node tools/film-ledger.mjs --db <temp.sqlite> status --json
```

and expects exit code 0 plus zeroed queue counts.

- [ ] **Step 2: Run discovery and CLI tests and verify RED**

Run: `node --test tools/lib/film-ledger-discovery.test.mjs tools/film-ledger.test.mjs`

Expected: FAIL because modules and CLI do not exist.

- [ ] **Step 3: Implement deterministic fingerprints and scan import**

Fingerprint input must include only stable material fields:

```js
export function fingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify({
    relativePath: entry.relativePath,
    fileCount: entry.fileCount,
    mediaCount: entry.mediaCount,
    subtitleCount: entry.subtitleCount,
    nfoCount: entry.nfoCount,
    totalBytes: entry.totalBytes,
    largestMedia: entry.largestMedia,
    flags: entry.flags
  })).digest("hex");
}
```

`importScan` upserts the root, inserts/updates entries, marks previously known absent entries `missing = 1`, and emits summary counts. It must not infer a canonical work identity from filenames; new sources remain unassigned until evaluation.

- [ ] **Step 4: Implement the CLI**

CLI contract:

```text
node tools/film-ledger.mjs [--db <path>] init
node tools/film-ledger.mjs [--db <path>] discover --scan <scan.json>
node tools/film-ledger.mjs [--db <path>] next --stage production|publication [--limit N] [--json]
node tools/film-ledger.mjs [--db <path>] status [--json]
node tools/film-ledger.mjs [--db <path>] show --variant <id> [--json]
node tools/film-ledger.mjs [--db <path>] record-qc --variant <id> --pass|--fail [evidence flags]
node tools/film-ledger.mjs [--db <path>] register-target --variant <id> --work-page <id> --spec-page <id> [--episode-page <id>]
```

Use default DB `.local-data/wwp-film-workflow.sqlite`. Human output may be concise text; `--json` must be machine-readable and contain no extra stdout.

Add package scripts:

```json
"film:ledger": "node tools/film-ledger.mjs",
"film:ledger:test": "node --test tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs"
```

- [ ] **Step 5: Run tests and a temp-database smoke test**

Run:

```powershell
node --test tools/lib/film-ledger-discovery.test.mjs tools/film-ledger.test.mjs
$db = Join-Path $env:TEMP 'wwp-ledger-smoke.sqlite'
node tools/film-ledger.mjs --db $db init
node tools/film-ledger.mjs --db $db status --json
Remove-Item -LiteralPath $db -Force
```

Expected: tests PASS; status reports zero production/publication candidates.

- [ ] **Step 6: Commit Task 4**

```powershell
git add tools/lib/film-ledger-discovery.mjs tools/lib/film-ledger-discovery.test.mjs tools/film-ledger.mjs tools/film-ledger.test.mjs package.json
git commit -m "Add film ledger discovery CLI"
```

---

### Task 5: Route Local Queue Watchers Into SQLite

**Files:**
- Modify: `.codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs`
- Modify: `.codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs`

**Interfaces:**
- Consumes: `importScan(repo, scan)` from Task 4
- Adds CLI option: `--ledger <sqlite-path>`
- Preserves existing `--state` and `--output` compatibility during migration

- [ ] **Step 1: Write the failing watcher integration test**

Create a temporary input root and run:

```js
const result = spawnSync(process.execPath, [
  watcherPath,
  "--root", root,
  "--ledger", dbPath,
  "--once"
], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const db = openLedger(dbPath);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM input_roots").get().count, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sources").get().count, 1);
```

Run: `node --test .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs`

Expected: FAIL with `Unknown argument: --ledger`.

- [ ] **Step 2: Implement `--ledger` without removing JSON compatibility**

After each `runScan`, call `openLedger(options.ledgerPath)`, create the repository, call `importScan`, close the DB, and include a `ledger` summary in stdout. If ledger import fails, the watcher iteration fails and must not silently update the JSON baseline.

- [ ] **Step 3: Run watcher and ledger tests**

Run:

```powershell
node --test .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs
node --test tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs
```

Expected: all PASS.

- [ ] **Step 4: Restart only the two local filesystem watchers with ledger sinks**

Stop the known queue watcher PIDs after verifying their command lines. Start hidden replacements using:

```powershell
node .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs --root <runtime-root> --ledger .local-data/wwp-film-workflow.sqlite --state <existing-state> --output <existing-output> --interval-sec 300 --max-iterations 0
```

Verify exactly two filesystem watcher processes and zero Notion watcher processes.

- [ ] **Step 5: Commit Task 5**

```powershell
git add .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs
git commit -m "Write queue discoveries to film ledger"
```

---

### Task 6: Targeted Notion Reconciliation and Circuit Breaker

**Files:**
- Create: `tools/lib/film-ledger-notion.mjs`
- Create: `tools/lib/film-ledger-notion.test.mjs`
- Modify: `tools/film-ledger.mjs`
- Modify: `tools/film-ledger.test.mjs`

**Interfaces:**
- Produces: `reconcileDueTargets(repo, notionAdapter, { limit = 3, now })`
- Produces: `createNotionTargetAdapter(client)` with `inspectTarget(target)`
- CLI command: `reconcile-notion [--limit N] [--json] [--force-after-429]`

- [ ] **Step 1: Write failing tests proving bounded, targeted behavior**

```js
test("reconciler checks only due recorded targets and stops at limit", async () => {
  seedFourDueTargets(repo);
  const visited = [];
  const adapter = {
    async inspectTarget(target) {
      visited.push(target.spec_page_id);
      return { structureVerified: true, mediaBlockId: null, mediaAssetPageId: null, assetsVerified: false };
    }
  };
  const result = await reconcileDueTargets(repo, adapter, { limit: 3, now: "2026-07-12T00:00:00.000Z" });
  assert.equal(result.checked, 3);
  assert.equal(visited.length, 3);
  assert.ok(visited.every(Boolean));
});

test("429 opens the global circuit breaker and prevents later calls", async () => {
  seedFourDueTargets(repo);
  let calls = 0;
  const adapter = { async inspectTarget() { calls += 1; throw Object.assign(new Error("rate limited"), { code: "rate_limited" }); } };
  const result = await reconcileDueTargets(repo, adapter, { limit: 3, now: "2026-07-12T00:00:00.000Z" });
  assert.equal(result.rateLimited, true);
  assert.equal(calls, 1);
  await assert.rejects(
    reconcileDueTargets(repo, adapter, { limit: 3, now: "2026-07-12T00:10:00.000Z" }),
    /circuit breaker open/
  );
});
```

Add a test proving an inspection with structure, media and complete Media Assets advances through legal publication states to `sync_ready`; an incomplete result remains pending.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tools/lib/film-ledger-notion.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement scheduler and circuit breaker**

Use scheduler key `notion_backoff_until`. Before any call, reject when `now < backoff_until` unless the CLI has explicit `--force-after-429`. On 429:

1. Set `notion_backoff_until = now + 60 minutes`.
2. Record the target error and next check time.
3. Stop the current batch immediately.
4. Never update upload/media state from the failed call.

Non-429 failures update only that target using `nextRetryAt` and continue unless the error is an authentication failure.

- [ ] **Step 4: Implement explicit-page Notion adapter**

`inspectTarget` may call only:

- `blocks.children.list` on `spec_page_id` or `episode_page_id`
- `pages.retrieve` for the recorded work/spec/episode page IDs
- the Media Assets query constrained by recorded relation/page IDs

It must not call a database-wide work query, recent-page query, or search endpoint. Return:

```js
{
  structureVerified: boolean,
  mediaBlockId: string | null,
  mediaVerified: boolean,
  mediaAssetPageId: string | null,
  assetsVerified: boolean,
  evidence: object
}
```

- [ ] **Step 5: Add CLI command and run tests**

Run:

```powershell
node --test tools/lib/film-ledger-notion.test.mjs tools/film-ledger.test.mjs
```

Expected: all PASS; CLI defaults to `limit = 3` and refuses values above 3.

- [ ] **Step 6: Commit Task 6**

```powershell
git add tools/lib/film-ledger-notion.mjs tools/lib/film-ledger-notion.test.mjs tools/film-ledger.mjs tools/film-ledger.test.mjs
git commit -m "Add targeted Notion ledger reconciliation"
```

---

### Task 7: Import Existing State and Cut Over the Plugin

**Files:**
- Create: `tools/lib/film-ledger-migration.mjs`
- Create: `tools/lib/film-ledger-migration.test.mjs`
- Modify: `tools/film-ledger.mjs`
- Delete: `tools/watch-notion-manual-uploads.mjs`
- Modify: `.codex/plugins/wwp-film-workflow/references/script-map.md`
- Modify: `.codex/plugins/wwp-film-workflow/skills/wwp-media-assets-backfiller/SKILL.md`

**Interfaces:**
- Produces: `migrateQueueState(repo, statePayload)`
- Produces: `migrateOrganizerReport(repo, reportPayload)`
- CLI command: `migrate-local-data --queue-state <json>... --organizer-report <json>...`

- [ ] **Step 1: Write failing migration tests**

Tests must prove:

1. Two queue state files create two input roots and do not treat baseline entries as newly selected work.
2. Organizer records with explicit work/spec page IDs register targets but do not become `sync_ready` without media and Media Assets evidence.
3. Conflicting audio names such as a filename containing `mandarin` plus human-confirmed Cantonese evidence result in `audio_variant = 'cantonese'` and a review event.
4. An existing DV green-cast failure imports as `qc_failed` or `deferred`, never `qc_passed`.

Run: `node --test tools/lib/film-ledger-migration.test.mjs`

Expected: FAIL because migration functions do not exist.

- [ ] **Step 2: Implement conservative importers**

- Queue states import sources and fingerprints only.
- Organizer reports import explicit page IDs and media block IDs.
- Do not parse arbitrary Markdown for authoritative state in v1.
- Accept a small explicit corrections manifest for human-confirmed facts:

```json
{
  "variants": [
    {
      "outputPath": "E:\\video_made\\example.mp4",
      "audioVariant": "cantonese",
      "productionState": "qc_failed",
      "failureCode": "wrong_audio_variant"
    }
  ]
}
```

- [ ] **Step 3: Add migration CLI and run migration tests**

Run:

```powershell
node --test tools/lib/film-ledger-migration.test.mjs tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs
```

Expected: all PASS.

- [ ] **Step 4: Update plugin rules and retire broad watcher**

Documentation must say:

- No automatic full/recent-page Notion watcher.
- Filesystem watcher writes discoveries to SQLite.
- Publication reconciler selects at most three known due targets.
- `qc_passed` stops duplicate encoding; `sync_ready` is the final exit.
- Unknown manual uploads require explicit work/page registration.

Delete `tools/watch-notion-manual-uploads.mjs`. Keep `notion-manual-upload-organizer.mjs` only as an explicit manual diagnostic tool; it must not be launched in a background loop.

- [ ] **Step 5: Migrate current local baselines**

Run:

```powershell
node tools/film-ledger.mjs init
node tools/film-ledger.mjs migrate-local-data `
  --queue-state .local-data/queue-i-state.json `
  --queue-state .local-data/queue-f-state.json `
  --organizer-report .local-data/notion-manual-upload-organizer-live.json
node tools/film-ledger.mjs status --json
```

Verify roots, source counts, active production count, publication count and zero automatic Notion processes.

- [ ] **Step 6: Run the full verification suite**

Run:

```powershell
node --test tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs
node --test .codex/plugins/wwp-film-workflow/scripts/scan-input-directory.test.mjs .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs
git diff --check
```

Expected: all tests PASS, no whitespace errors, two filesystem watcher processes, zero Notion watcher processes.

- [ ] **Step 7: Commit Task 7**

```powershell
git add tools/lib/film-ledger-migration.mjs tools/lib/film-ledger-migration.test.mjs tools/film-ledger.mjs tools/film-ledger.test.mjs tools/watch-notion-manual-uploads.mjs .codex/plugins/wwp-film-workflow/references/script-map.md .codex/plugins/wwp-film-workflow/skills/wwp-media-assets-backfiller/SKILL.md
git commit -m "Replace Notion watcher with local film ledger"
```

---

## Final Verification

After all tasks:

1. `node tools/film-ledger.mjs status --json` shows bounded production and publication queues.
2. Adding a new file to a temporary input root creates one source record; rescanning creates none.
3. A `qc_passed` variant is absent from `next --stage production` and present in `next --stage publication` until `sync_ready`.
4. A reconciler run with four due targets calls the Notion adapter exactly three times.
5. A simulated 429 makes the next reconciler call fail locally without contacting the adapter.
6. No process command line contains `watch-notion-manual-uploads.mjs` or `notion-manual-upload-organizer.mjs --all`.
7. Both configured filesystem input watchers remain alive and write to `.local-data/wwp-film-workflow.sqlite`.
