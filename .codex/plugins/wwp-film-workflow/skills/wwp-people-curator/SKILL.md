---
name: wwp-people-curator
description: Collect, verify, enrich, and publish WWP people profiles and person-to-work credits in small manual batches. Use when the user explicitly asks to add people, run or continue a people batch, enrich cast or creators, repair bilingual names or biographies, or synchronize People / 创作人 data and the website reverse index. Do not invoke for ordinary film or series production, upload, encoding, or the command 开始制作影视库 unless the user explicitly asks to include people enrichment.
---

# WWP People Curator

Run the WWP people lane independently from film production. Reuse the repository's existing people tools, publish only reviewed identities, and leave an auditable, resumable batch under `.local-data/people/`.

Read [references/workflow.md](references/workflow.md) before running commands. Also follow `docs/people-maintenance.md` for the current schema and editorial gates.

## Keep the lane independent

- Start only from an explicit request such as “补人物”, “跑人物批次”, “继续补人物”, or a named-person repair.
- Do not run from `开始制作影视库`, ordinary uploads, encoding, or metadata backfill.
- Do not delay publishing a film because its people data is incomplete.
- Keep the integration seam at the reviewed report: the main workflow may invoke this skill later, but must not duplicate its identity or publishing logic.
- Treat bands, combinations, studios, companies, and other organizations as unresolved non-person entities. Never force them into `People / 创作人`.

## Use conservative defaults

- Default to 10 new people per batch; do not exceed 20 without an explicit request.
- When the user explicitly requests about 100 people, manage it as one umbrella observation batch but publish in sub-batches of at most 20 after each sub-batch passes review.
- Prefer works already present in WWP whose important credits are missing or unlinked.
- Include directors, writers, producers, cinematographers, editors, composers, and important cast according to the work's actual prominence.
- Do not impose a fixed actor maximum. Preserve significant ensemble casts when evidence supports them.
- Use one batch directory: `.local-data/people/<batch-slug>/`. Keep discovery reports, caches, checkpoints, curation config, biography reviews, and the final reviewed report there.

## Run the workflow

### 1. Establish the baseline

Inspect the current person catalog, website count, Notion configuration, search-index target, Git status, and prior batch state. Select a small, diverse set of works or named people. Do not rescan the entire library when a cached candidate list is available.

For each selected work, resolve its stable WWP work ID and verify the external work identity before collecting credits.

### 2. Collect slowly and resumably

Use `tools/person-wikidata-pilot.mjs` for bounded work-credit discovery. Run one work at a time with concurrency 1 and a default interval of 1500 ms. Reuse its cache and checkpoint on retries.

Before network work, estimate request amplification: each work may require one work request plus one request per candidate person, with additional source checks performed separately. If any provider returns HTTP 429, stop launching requests, honor `Retry-After`, add jitter, and stop the batch after repeated 429 responses.

Give every external request a finite timeout (20 seconds by default), retry at most once with jitter, and checkpoint each completed response batch. A hung source must not hold the whole people run indefinitely.

### 3. Review identity before prose

- Match by stable Wikidata, TMDB, IMDb, or equally strong identity evidence. Never merge by a name alone.
- Verify simplified Chinese display name, stable English name, original/native name, aliases, dates, and the work relationship.
- Keep generated transliterations provisional. Use the formal, source-supported simplified Chinese name when available.
- Exclude non-human entities and quarantine conflicting external IDs or ambiguous aliases.
- Preserve an immutable `person_<uuid>` once allocated; do not manufacture or recycle IDs.

### 4. Curate the batch

Select the people and credit links explicitly in a batch config, then compose the individual discovery reports with `tools/person-batch-compose.mjs`. Keep unselected or uncertain credits as visible unresolved names rather than creating weak person links.

Require zero unresolved identity conflicts for every profile that will be published. Ordinary unresolved legacy credits may remain unlinked when their identity has not been materialized.

### 5. Produce bilingual biographies

- Synthesize an original factual English biography from the collected evidence when no authoritative reusable original exists.
- Translate and edit that mother text into natural simplified Chinese, verifying names, works, institutions, places, awards, and other proper nouns separately.
- If an authoritative English text is used as factual input, still avoid copying protected prose; summarize it unless reuse rights clearly allow otherwise.
- Use Douban as a Chinese research lead, never as the sole verifier or as text to copy.
- Record 3–4 useful source URLs when available, spanning at least two independent source families. Sources are shared across languages; language status and method remain separate.
- Mark Chinese biography `verified` only after editorial rewrite and multi-source verification. Never label machine translation as reviewed.

Apply reviewed biography and credit-name edits with `tools/person-biography-review.mjs`. Inspect the resulting report directly before any write.

### 6. Validate and preview every write

Run the focused people tests, API typecheck, and `git diff --check`. Then preview Notion operations and catalog/index changes. Confirm expected profile, work, credit, and unresolved counts before applying.

Never apply an offline diagnostic report or a report containing identity conflicts. Use the explicit reviewed-pilot gates for both Notion and catalog writes.

### 7. Publish in order

1. Upsert the reviewed people to Notion with its shared one-request-per-second limiter.
2. Read back the changed rows and stop on the first failure.
3. Apply the same reviewed report to the person catalog and search index.
4. For production, explicitly set both `PERSON_CATALOG_BACKEND=azure` and `SEARCH_INDEX_BACKEND=azure`; do not trust local `.env` defaults.
5. Run Notion-to-catalog sync as dry-run, apply, then a fresh dry-run. Require convergence with zero unexpected writes or issues.
6. Open the live people directory and several changed person routes. Verify biography language, roles, deduplicated works, reverse lookup, desktop layout, and mobile layout.

## Stop instead of weakening a gate

Stop and report completed and remaining counts when:

- identity evidence conflicts or could refer to multiple people;
- a group or organization needs a future entity model;
- source evidence is too weak for a verified name or biography;
- repeated rate limits occur;
- Notion readback fails, an API write partially fails, or a replay is not idempotent;
- the configured catalog/search backend is not the intended target;
- unrelated dirty-worktree changes overlap files that must be edited.

## Report completion

State the selected works, people proposed/created/updated/unchanged, linked and unresolved credits, biography status by language, source quality issues, Notion result, catalog/index result, convergence result, live verification result, batch directory, and remaining candidates. Do not claim completion from source edits alone.
