# WWP People Module Implementation Plan

**Goal:** Add provenance-backed person identities, multilingual names, person-based work browsing, and a resumable enrichment pipeline without replacing existing work metadata or creating a large Notion Credits database.

**Architecture:** Keep `MovieCreditEntry` as the work-person relationship, add a first-class `PersonProfile` and `PersonCatalogState`, curate overrides in one Notion People data source, derive reverse work indexes during catalog sync, and preserve legacy director/cast strings until migration is complete.

**Tech Stack:** TypeScript, Node/TSX test runner, React 19, local/Azure cache-store backends, Notion API, TMDB API, IMDb non-commercial datasets, Wikidata APIs, Azure Container Apps, Azure Static Web Apps.

**Design reference:** `docs/superpowers/specs/2026-08-10-people-module-design.md`

## Global Constraints

- Never merge people from name equality alone.
- Never publish an AI-generated transliteration as a verified formal name.
- Preserve source, status, and observed time for every name.
- Use an immutable internal `personId`; external IDs are indexed evidence.
- Allocate IDs only under the single-writer people-sync lease; Notion never allocates identity.
- Keep existing legacy director/cast display and search fallbacks during migration.
- Do not create or populate a Notion Credits database in Version 1.
- Do not bulk-read Notion when a current local work snapshot can identify candidates.
- Use one shared limiter per provider. Notion defaults to concurrency 1 and at most one request per second.
- Make every apply operation dry-run capable, bounded, resumable, idempotent, and directly readable after completion.
- Do not mix implementation commits with the unrelated uncommitted work currently present in the repository.
- Stage work/person snapshots with one generation ID and switch or roll them back atomically.

---

### Task 0: Reconcile the implementation baseline

**Files:**
- Inspect: `packages/shared/src/index.ts`
- Inspect: `packages/cache-store/src/movie-catalog.ts`
- Inspect: `packages/cache-store/src/search-index.ts`
- Inspect: `apps/api/src/notion-source.ts`
- Inspect: `apps/web/src/cinema/movie-credits.ts`
- Create local report: `.local-data/people/baseline.json` (ignored)

- [x] Record `git status --short`, the active branch, and current credits/UI diffs.
- [x] Decide which existing uncommitted credit changes are the accepted baseline before editing overlapping files.
- [x] Read the latest local search-index snapshot and record work count, TMDB/IMDb coverage, structured-credit count, parsed legacy-name count, and snapshot timestamp.
- [x] Confirm the current production Notion work schema in read-only mode; do not infer it from old documentation.
- [x] Confirm current TMDB credentials/configuration without printing secret values.
- [x] Write a secret-safe baseline report under `.local-data/people/`.
- [x] Confirm the initial scope: all work-level directing/writing, top-20 cast, key production/camera/editing/music jobs, and series-level rather than episode-only credits.

**Acceptance:** The implementation starts from a named commit/diff boundary and a reproducible data snapshot. No source or external data has been changed.

---

### Task 1: Add first-class person and multilingual-name types

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/person-names.ts`
- Create: `packages/shared/src/person-names.test.ts`
- Create: `packages/shared/src/person-identity.ts`
- Create: `packages/shared/src/person-identity.test.ts`

- [x] Add failing tests for name precedence, native versus transliterated names, traditional/simplified aliases, diacritics, surname-order variants, stage names, and manual locks.
- [x] Add failing tests proving homonyms do not merge and shared stable IDs do.
- [x] Define `PersonExternalIds`, `PersonNameEntry`, `PersonBiography`, `PersonImage`, `PersonSourceRef`, `PersonDataQuality`, `PersonProfile`, and person issue types.
- [x] Gate verified Chinese biographies on an editorial rewrite plus at least two independent source families; Douban alone remains partial evidence.
- [x] Add `wikidata` to the metadata-source vocabulary used by provenance entries.
- [x] Change `MovieCreditEntry.externalIds` from title-oriented IDs to `PersonExternalIds` with backward-compatible parsing.
- [x] Implement pure normalization and display-name selection functions.
- [x] Implement identity candidate scoring that returns decisions/issues rather than mutating stores.
- [x] Run focused shared-package tests, typecheck, and `git diff --check`.

**Acceptance:** Pure tests demonstrate that identity and display-name decisions are deterministic, provenance-aware, and safe for homonyms.

---

### Task 2: Build the person catalog and indexes

**Files:**
- Create: `packages/cache-store/src/person-catalog.ts`
- Create: `packages/cache-store/src/person-catalog.test.ts`
- Modify: `packages/cache-store/src/index.ts`
- Modify: `packages/shared/src/index.ts`

- [x] Define `PersonCatalogState`, entries, redirects, issues, external-ID indexes, alias index, and work/person credit indexes.
- [x] Prove pure rebuilds consume existing `personId` values and leave unassigned credits unresolved; UUID allocation belongs only to the guarded enrichment/upsert path.
- [ ] Write failing tests for catalog insertion, external-ID matching, ambiguous aliases, merge redirects, split-safe behavior, and multi-role credits.
- [x] Implement deterministic state generation from structured work credits.
- [x] Preserve credits without person IDs as unresolved migration inputs rather than dropping them.
- [x] Add local persistence with atomic replacement and schema-version validation.
- [x] Add the Azure-backed store using the existing cache-store conventions only after local tests pass.
- [x] Prove an unchanged rebuild is byte/content stable except for an explicitly controlled generation timestamp.

**Acceptance:** A local fixture catalog resolves exact people and reverse work lists without scanning all work results at request time.

---

### Task 3: Create provider adapters and a resumable enrichment runner

**Files:**
- Create: `apps/api/src/person-sources/tmdb.ts`
- Create: `apps/api/src/person-sources/imdb.ts`
- Create: `apps/api/src/person-sources/wikidata.ts`
- Create: `apps/api/src/person-enrichment.ts`
- Create: `apps/api/src/person-enrichment.test.ts`
- Create: `tools/person-enrichment.mjs`
- Create ignored runtime state under: `.local-data/people/`

- [x] Define narrow provider response interfaces and keep raw provider payloads outside shared public types.
- [x] Write mocked tests for TMDB credits, person details, external-ID crosswalk, IMDb identity evidence, Wikidata multilingual labels, missing values, conflicts, 429, and retry-after behavior.
- [x] Implement one shared limiter per provider across all reads and writes.
- [ ] Cache raw responses by provider, endpoint, ID, language, and schema version.
- [x] Persist cursor, work hash, completed IDs, failures, deferred conflicts, and next retry time.
- [x] Acquire one cross-process/container people-sync lease before issuing provider requests; stop safely if it is lost.
- [x] Apply the documented provider cache windows and `evidenceSchemaVersion` invalidation.
- [x] Implement `--dry-run`, `--limit`, `--work-id`, `--person-id`, `--resume`, and JSON report options; reviewed apply is split into guarded Notion/catalog tools.
- [x] Prefer current local work/search snapshots for candidate discovery.
- [x] Emit proposed people, proposed credit replacements, unresolved identities, name conflicts, and estimated Notion writes before apply.
- [x] Stop cleanly after repeated 429 responses with completed/remaining counts.
- [x] Test the crash window where a Notion upsert succeeds before checkpoint persistence and prove replay does not duplicate it.

**Acceptance:** Mocked runs are deterministic and resumable; a repeated dry run makes no network request when the cache remains valid.

---

### Task 4: Add Notion People schema and safe upsert tooling

**Files:**
- Create: `apps/api/src/notion-people-schema.ts`
- Create: `apps/api/src/notion-people-schema.test.ts`
- Create: `apps/api/src/notion-people-source.ts`
- Create: `apps/api/src/notion-people-source.test.ts`
- Modify: `.env.example`
- Modify: `docs/notion-metadata-maintenance.md`

- [x] Add `NOTION_PEOPLE_DATABASE_ID` and `NOTION_PEOPLE_DATA_SOURCE_ID` configuration names without adding secrets.
- [x] Implement read-only schema inspection and a dry-run schema proposal.
- [x] Create the People database only after the proposed fields, `Locked Fields`, and target parent are explicitly verified.
- [x] Upsert by immutable `Person ID`, then validate unique external IDs locally before writing.
- [x] Never overwrite manual locked names, hide state, or developer memo.
- [x] Store compact provenance in Notion while retaining full structured evidence in the runtime catalog/report.
- [x] Validate managed-value behavior with mocks/local fixtures only; Task 4 does not apply real person records.

**Acceptance:** The live empty People data source matches the documented schema, and mocked/local upsert tests prove manual locks and immutable IDs are protected. Real person writes remain blocked until Task 5 review.

---

### Task 5: Pilot identity and name quality on diverse works

**Files:**
- Create local pilot manifest: `.local-data/people/pilot.json` (ignored)
- Create local pilot report: `.local-data/people/pilot-report.json` (ignored)

- [ ] Select about 20 works covering Mainland Chinese, Hong Kong/Taiwan variants, Japanese, Korean, European diacritics, stage names, homonyms, animation voice casts, series, multi-role creators, and missing Chinese names.
- [ ] Fetch/enrich in dry-run mode and review every proposed person identity and displayed name.
- [ ] Confirm Chinese names against entity-linked sources rather than spelling similarity.
- [ ] Mark uncertain transliterations provisional and verify they do not become formal names.
- [ ] Confirm the default rule that `verified` and entity-linked `strong` Chinese names may be public; tighten it here if pilot evidence requires editor approval.
- [ ] Lock the exact production credit scope and the denominator for the 95% target before any 100-work expansion.
- [ ] Confirm one person with multiple jobs retains all credit relationships.
- [ ] Confirm same-name different-ID fixtures remain separate.
- [ ] Apply only the reviewed pilot, then read back Notion, the generated catalog/service fixtures, and the second-run write count.
- [ ] Record discovered rules or exceptions in the design document before expanding the batch.

**Acceptance:** Pilot false merges are zero, all public formal names meet the chosen publication status, and every unresolved case is visible in an issue queue.

---

### Task 6: Integrate people with work/catalog synchronization

**Files:**
- Modify: `apps/api/src/notion-source.ts`
- Modify: `apps/api/src/movie-catalog-sync.ts`
- Modify: `apps/api/src/meta-sync.ts`
- Modify: `packages/cache-store/src/movie-catalog.ts`
- Modify relevant tests beside each module

- [ ] Replace string-only credit creation with structured person-linked credits when enrichment evidence exists.
- [ ] Retain legacy fields and fallbacks for incomplete works.
- [ ] Publish person catalog state only after the corresponding work-credit state succeeds.
- [ ] Stage work/person snapshots with one generation ID, validate every `personId` reference, and atomically switch one manifest pointer.
- [ ] Make full-sync credit removal conditional on a confirmed complete source scan.
- [ ] Encode complete-scan criteria: terminal cursor, expected/processed totals agree, every in-scope work has a disposition, and no unhandled fetch/parse errors.
- [ ] Add sync summaries for people created/updated/unchanged, credits linked/unresolved/removed, conflicts, and remaining work.
- [ ] Add snapshot rollback behavior so a failed people publish does not corrupt the current public catalog.
- [ ] Prove incremental sync updates one affected person/work without rebuilding or rewriting unrelated People rows.

**Acceptance:** Work and people snapshots remain mutually consistent, and failures leave the last valid public snapshots usable.

---

### Task 7: Add person API routes and exact filtering

**Files:**
- Create: `apps/api/src/person-service.ts`
- Create: `apps/api/src/person-service.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `packages/shared/src/index.ts`

- [x] Define public list/detail response types that expose display names, selected aliases, biography, departments, images, and WWP work references without internal issue details.
- [x] Add exact `personId` browse filtering.
- [x] Add alias-aware autocomplete that may return multiple disambiguated candidates.
- [x] Add public visibility checks for hidden people and unpublished works.
- [x] Add admin issue-list output without leaking credentials or raw provider payloads.
- [ ] Require and test existing admin authentication/authorization for issue routes.
- [x] Add service tests for exact identity, aliases, redirects, hidden rows, missing rows, and department grouping.
- [ ] Verify existing search/browse route behavior remains unchanged when no person filter is provided.

**Acceptance:** APIs resolve people by stable identity, never guess from an ambiguous name, and return only visible WWP works.

---

### Task 8: Add clickable credits, person pages, and person-based selection

**Files:**
- Modify: `apps/web/src/cinema/movie-credits.ts`
- Modify: `apps/web/src/cinema/components/LibraryTab.tsx`
- Create: `apps/web/src/cinema/components/PersonDetail.tsx`
- Create: `apps/web/src/cinema/person-route.ts`
- Add focused tests under: `apps/web/test/`

- [x] Extend credit presentation to retain person IDs and role/job context, not names alone.
- [x] Link only credits with a stable `personId`; legacy credits remain text.
- [x] Add a stable person route and direct-link loading behavior.
- [x] Add person profile header, multilingual names, compact biography, department sections, and WWP-only work shelves.
- [x] Add exact person filtering to browse state and preserve back/forward navigation.
- [x] Add alias-aware person search results with profession/representative-work disambiguation.
- [x] Implement loading, missing, and error states; empty work groups remain explicit through the zero-work count.
- [x] Verify the desktop rendered route and keyboard button semantics with a local authenticated Playwright smoke test.

**Acceptance:** A user can move from a work to the correct person and select another available work by that person without encountering a name-based false match.

---

### Task 9: Expand the backfill safely

**Files:**
- Reuse: `tools/person-enrichment.mjs`
- Update ignored reports under: `.local-data/people/`

- [ ] Run a cached dry-run for the next 100 works and inspect estimated request/write amplification.
- [ ] Refuse the 100-work run unless Task 5 recorded the final credit scope and public-name gate.
- [ ] Apply in small resumable batches under the provider limiters.
- [ ] Read back a stratified sample plus every conflict/exception.
- [ ] Stop on repeated 429s and report completed and remaining counts.
- [ ] After the 100-work gate passes, continue through remaining TMDB-identified works.
- [ ] Queue IMDb-only and name-only works separately; do not lower merge safety to increase coverage.
- [ ] Run a full rebuild and then an incremental no-change run.

**Acceptance:** At least 95% of in-scope credits are linked or have an explicit unresolved issue, with zero name-only automatic merges and an idempotent final run.

---

### Task 10: Deployment and production acceptance

**Files:**
- Modify deployment scripts only for new non-secret setting names and person-store configuration.
- Create ignored acceptance report: `.local-data/people/production-acceptance.md`

- [ ] Run focused tests followed by all repository tests, typechecks, builds, and `git diff --check`.
- [ ] Commit people work in isolated, reviewable units without unrelated workspace changes.
- [ ] Deploy the API/person store before enabling website links.
- [ ] Smoke person lookup, search, exact filtering, redirects, and hidden behavior against production.
- [ ] Deploy the web feature behind its release flag.
- [ ] Verify required TMDB attribution, provider terms, and profile-image licensing/caching decisions before enabling public images or provider-derived presentation.
- [ ] Verify representative Chinese, English, native-name, homonym, multi-role, and series cases in the rendered desktop and mobile site.
- [ ] Verify existing search, browse, authentication, playback, cache, and movie-detail behavior.
- [ ] Record deployed commit, schema version, People row count, linked/unresolved credit counts, issue counts, tests, and readback evidence.

**Acceptance:** Production behavior matches the design success criteria, exact live readback passes, and disabling the feature flag restores the prior website experience without data loss.

---

### Task 11: Operationalize maintenance and future decisions

**Files:**
- Modify: `docs/HANDOFF.md`
- Modify: `docs/notion-metadata-maintenance.md`
- Create: `docs/people-maintenance.md`
- Modify repo-local film workflow plugin only after the people pipeline is proven stable

- [ ] Document routine incremental sync, dry-run/apply, 429 recovery, conflict review, manual name locking, merge, split, hide, and rollback.
- [ ] Add people completeness to metadata audits without making every background crew member a completion blocker.
- [ ] Revisit rather than first define the maintained credit scope and `strong` publication rule from pilot evidence.
- [ ] Review remaining decisions: profile-image caching, external filmography, and a possible Notion Credits database.
- [ ] Update the film-workflow plugin so newly produced works enqueue people enrichment rather than duplicating its logic.

**Acceptance:** A future operator can safely maintain the module from documentation and tools without reconstructing the identity rules from this conversation.

---

### Task 12: Automatically synchronize editorial People changes

**Files:**
- Modify: `apps/api/src/notion-people-source.ts`
- Create: `apps/api/src/person-notion-sync.ts`
- Create: `apps/api/src/person-notion-sync-runtime.ts`
- Create: `apps/api/src/home-notion-sync-cycle.ts`
- Create: `tools/notion-people-sync.mjs`
- Modify: `tools/start-home-site.mjs`
- Modify: `docs/people-maintenance.md`

- [x] Query People incrementally by `last_edited_time` with a conservative overlap and one shared Notion limiter.
- [x] Apply ordinary editorial fields only to an existing immutable `personId` and rebuild derived indexes deterministically.
- [x] Quarantine unknown IDs, changed external IDs, duplicate IDs/pages, and malformed rows without creating or merging identities.
- [x] Publish through the atomic local/Azure person-catalog replacement mechanism and leave the prior snapshot active on failure.
- [x] Persist the successful checkpoint only after publication; repeated unchanged runs make no catalog write.
- [x] Add `people:sync --dry-run|--apply`, a secret-safe report, and a shared lock with reviewed Notion upserts.
- [x] Run the People lane in every enabled `home:start` Notion cycle, including when movie metadata fails.
- [x] Prove safe merge, identity quarantine, pagination, replay, dry-run, and sync-cycle behavior with focused tests.
- [x] Run live read-only and empty-table apply/replay checks against the configured People data source without creating real rows.

**Acceptance:** A normal edit to an existing Notion People row reaches the next website person-catalog generation automatically; identity-sensitive changes stay unpublished and visible in the admin issue queue; replay is idempotent and a failed publish does not advance the checkpoint.
