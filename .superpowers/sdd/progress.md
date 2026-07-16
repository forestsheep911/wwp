# WWP Film Ledger SDD Progress

- Worktree: `C:\Users\fores\.codex\worktrees\wwp-film-ledger`
- Branch: `codex/film-ledger`
- Base commit: `322e180`
- Baseline: scan/watch tests passed (3/3) on 2026-07-12.

## Tasks

- [x] Task 1: SQLite schema and safe database lifecycle
- [x] Task 2: Domain states, final gate, and bounded selection
- [x] Task 3: Repository operations and event audit
- [x] Task 4: Discovery import and ledger CLI
- [x] Task 5: Route local queue watchers into SQLite
- [x] Task 6: Targeted Notion reconciliation and circuit breaker
- [x] Task 7: Import existing state and cut over the plugin

## Notes

- The source checkout is dirty with user-owned changes. Do not revert or overwrite them.
- Implement and commit inside this isolated worktree. Merge back only after final review.
- Task 1 RED: `node --test tools/lib/film-ledger-schema.test.mjs` failed with `ERR_MODULE_NOT_FOUND` as expected.
- Task 1 GREEN: the same command passed 2/2 tests; commit `07dadf0`.
- Task 2 RED: `node --test tools/lib/film-ledger-domain.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `film-ledger-domain.mjs`.
- Task 2 GREEN: the same command passed 6/6 tests, covering legal adjacency, final sync evidence, retry windows, and bounded limits.
- Task 3 RED: `node --test tools/lib/film-ledger-repository.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `film-ledger-repository.mjs`.
- Task 3 GREEN: schema, domain, and repository tests passed 14/14; coverage includes idempotent null-year works and renamed sources, legal audited transitions, candidate exclusions/due dates/priority, verified timestamp preservation, and stable JSON payloads.
- Task 4 RED: `node --test tools/lib/film-ledger-discovery.test.mjs tools/film-ledger.test.mjs` failed 1/7 because duplicate entries were counted as two inserts.
- Task 4 focused GREEN: the same command passed 7/7 after updating the in-scan source map after each upsert.
- Task 5 RED: `node --test .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.test.mjs` failed 1/4 with `Unknown argument: --ledger`.
- Task 5 GREEN: watcher tests passed 4/4 and all ledger tests passed 22/22; ledger import runs before JSON baseline writes and its summary is included in stdout.
- Task 6 RED: `node --test tools/lib/film-ledger-notion.test.mjs tools/film-ledger.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `film-ledger-notion.mjs` and `unknown command: reconcile-notion` after correcting a test-only syntax error.
- Task 6 focused GREEN: the same command passed 11/11, covering the three-target bound, persisted 60-minute 429 breaker and force bypass, per-target retries, auth stop, failure evidence isolation, legal four-gate advancement, exact recorded-page calls, and relation-constrained Media Assets query.
- Task 6 full GREEN: `node --test tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs` passed 30/30; `git diff --check` passed; `@notionhq/client` resolved after worktree dependency installation. No live Notion calls were made.
- Task 7 RED: `node --test tools/lib/film-ledger-migration.test.mjs tools/film-ledger.test.mjs` failed because `film-ledger-migration.mjs` did not exist and the CLI rejected `--queue-state`.
- Task 7 focused GREEN: the same command passed 11/11, covering two independent roots without auto-selection, explicit page registration remaining `not_ready`, human-confirmed Cantonese overriding filename Mandarin with a review event, green DV rejection never becoming `qc_passed`, and repeated migration CLI inputs.
- Task 7 full GREEN before commit: all ledger tests passed 37/37; scanner/watcher tests passed 5/5; `git diff --check` passed. No live migration or process start/stop command was run.
- Task 7 commit: `11c4f34 Replace Notion watcher with local film ledger`.
