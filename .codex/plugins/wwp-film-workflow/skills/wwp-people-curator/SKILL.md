---
name: wwp-people-curator
description: Collect, verify, enrich, and publish WWP people profiles and person-to-work credits in small manual batches. Use when the user explicitly asks to add people, run or continue a people batch, enrich cast or creators, repair bilingual names or biographies, or synchronize People / 创作人 data and the website reverse index. Do not invoke for ordinary film or series production, upload, encoding, or the command 开始制作影视库 unless the user explicitly asks to include people enrichment.
---

# WWP People Curator

Run the WWP people lane as a serialized mode owned by the film-production coordinator. Reuse the repository's existing people tools, publish only reviewed identities, and leave an auditable, resumable batch under `.local-data/people/`.

Read [references/workflow.md](references/workflow.md) before running commands. Also follow `docs/people-maintenance.md` for the current schema and editorial gates.

When selecting between existing-profile repair and new-person expansion, read
[references/campaign-routing.md](references/campaign-routing.md). Do not infer
the lane from whichever candidates happen to be easiest to find.

## Keep one production owner

- Start from an explicit People request, `--mode people-only`, the People stage of `--mode enrichment-only`, or the People handoff created after the film checkpoint in `--mode film-and-current-enrichment`.
- `开始制作影视库` uses `film-and-current-enrichment` by default, but the People stage may begin only after the bounded film stage and base-metadata stage reach stable checkpoints and only for the exact current work IDs.
- Do not delay publishing a film because its people data is incomplete.
- Do not run this skill as a second concurrent task beside film production. Its network commands share `.local-data/wwp-production-network.lock` with the film cycle; a live lock owner is a stop condition, not a retry signal.
- Keep the integration seam at the reviewed report: the main workflow invokes this skill after routing, but must not duplicate its identity or publishing logic.
- Treat bands, combinations, studios, companies, and other organizations as unresolved non-person entities. Never force them into `People / 创作人`.

## Route campaign commands deterministically

- “推进人物修补” or an explicit existing-person correction is `repair_only`.
- “推进人物扩展” or an explicit request to add people from works is
  `expansion_only`.
- “推进人物流程” is `balanced`: use a 10-profile cycle with four existing
  repairs and six new people by default.
- A bare “继续” resumes the last unfinished people campaign from its saved
  state, including its mode, queue cursors, and remaining quotas. It must not
  choose a new lane from conversation wording.
- A named person or named work overrides the automatic selector only for that
  scoped request. Preserve the campaign cursor for later resumption.
- P0 identity or synchronization defects always preempt ordinary quotas and
  may consume the whole cycle. Unused repair capacity transfers to expansion;
  optional metadata gaps never consume normal repair capacity.
- Before research or writes, report the selected mode, quotas, people or works,
  and the recorded reason for every repair selection.

## Use conservative defaults

- Default to 10 profile operations per cycle. In balanced mode this means four
  repairs plus six new people; in an explicit single-lane mode all 10 belong to
  that lane. Do not exceed 20 profiles in one publishable sub-batch without an
  explicit request.
- For Azure production applies, prefer 10-16 profiles per sub-batch once the catalog is large; if `person-catalog-apply` returns Azure Table `OperationTimedOut`, keep the backup, verify index rollback, and retry the same reviewed report in a smaller sub-batch rather than launching a duplicate apply.
- Coverage audits against Azure must also have a finite read window; if the audit stalls, stop only that read, preserve the completed batch artifacts, record the timeout, and resume from the last cached candidate list instead of rerunning writes.
- Treat `profile-budget` as the maximum number of candidate identities to review in one discovery pass, never as a per-work credit, cast, or publication limit. Preserve the complete discovered credit list and resume the same work in later passes when significant people remain.
- When the user explicitly requests about 100 people, manage it as one umbrella observation batch but publish in sub-batches of at most 20 after each sub-batch passes review.
- Prefer works already present in WWP whose important credits are missing or unlinked.
- Include directors, writers, producers, cinematographers, editors, composers, and important cast according to the work's actual prominence.
- Do not impose a fixed actor maximum. Preserve significant ensemble casts when evidence supports them.
- Use one batch directory: `.local-data/people/<batch-slug>/`. Keep discovery reports, caches, checkpoints, curation config, biography reviews, and the final reviewed report there.
- Keep a `work-coverage.json` record for every processed work with its stable
  work ID, source work ID, batch ID, status, total/linked/unlinked credit counts,
  publication time, verification time, and visual-verification result. A work
  is not complete merely because one of its people already exists.

## Run the workflow

### 1. Establish the baseline

Inspect the current person catalog, website count, Notion configuration, search-index target, Git status, and prior batch state. Select a small, diverse set of works or named people. Do not rescan the entire library when a cached candidate list is available.

For a long-running historical campaign, build or refresh the work queue from the
current production search index with `node --import tsx
tools/people-work-coverage-audit.mjs --backend azure --output
<batch-dir>/coverage-audit.json`. Use the direct command because current npm
argument forwarding may consume the option names. This is the cheap first pass:
it classifies works with missing credits, unlinked names, partial person links,
and complete links without calling Notion, OMDb, Wikidata, or TMDB. Reuse the
saved report until the production index materially changes. Send
`missing_credits` works through the bounded metadata/Wikidata discovery seam;
send `unlinked_only` and `partially_linked` works directly to identity review.
For a `missing_credits` work with an IMDb ID, first use the bounded OMDb lane to
seed the director, writer, and top-cast strings, then refresh the exact movie
index entry by its Notion page ID before Wikidata materialization; do not use
`meta-sync ondemand 1` as an exact-page refresh because that mode selects the
most recently edited page, not a requested page. Use
`node --import tsx tools/notion-index-refresh.mjs --page-id <page-id> --title <title>` with
both Azure backends selected, then read back the target work and require its
credit count to be non-zero before materializing people. The People selector uses those
existing credit strings as prominence anchors while Wikidata supplies stable
identity. Do not treat Wikidata statement order as a main-cast ranking.

For a production-bound discovery or materialization run, explicitly set
`PERSON_CATALOG_BACKEND=azure` before allocating any person IDs. The discovery
runner also binds the person catalog to an explicit `--search-backend` and
stops on a conflicting backend, so stable external IDs cannot silently be
matched against a different catalog. A report materialized against the wrong catalog must be
discarded and regenerated before review; never repair duplicate IDs only at the
apply step.

For each selected work, resolve its stable WWP work ID and verify the external work identity before collecting credits.

If a queued `sourcePageId` returns Notion `object_not_found`, or an exact-page
refresh returns a different `WW Work ID` than the queue, do not allocate people
and do not merge the IDs by hand. Query the configured library data source by
exact title plus a strong external ID (IMDb, Douban, or TMDB), require one
unique active page, and treat a page with a download-only/legacy marker as a
separate carrier rather than the canonical work. Continue only with the active
page's stored `WW Work ID`; if no unique page or stable ID can be established,
quarantine the work and record the identity defect.

For a series or season, verify that the selected Wikidata entity actually has
credit statements. Do not substitute a parent-series entity or an OMDb episode
response for a season's credits. If the season entity has no usable credit
statements and no independent provider can supply stable person identities,
record the source defect, leave the names unresolved, and continue with the
next queue candidate.

### 2. Collect slowly and resumably

Use `tools/person-wikidata-pilot.mjs` for bounded work-credit discovery. Run one work at a time with concurrency 1 and a default interval of 1500 ms. Reuse its cache and checkpoint on retries.

Before network work, estimate request amplification: each work may require one work request plus one request per candidate person, with additional source checks performed separately. If any provider returns HTTP 429, stop launching requests, honor `Retry-After`, add jitter, and stop the batch after repeated 429 responses.

Give every external request a finite timeout (20 seconds by default), retry at most once with jitter, and checkpoint each completed response batch. A hung source must not hold the whole people run indefinitely.

### 3. Review identity before prose

- Match by stable Wikidata, TMDB, IMDb, or equally strong identity evidence. Never merge by a name alone.
- Verify simplified Chinese display name, stable English name, original/native name, aliases, dates, birthplace, external IDs, portrait, and the work relationship. Treat each optional public meta value as a separate factual claim; never infer a missing month, day, place, or native name.
- Normalize a public birthplace into natural simplified Chinese while retaining the provider value in evidence. Curate and deduplicate aliases before public use; traditional-only, duplicated, transliterated, or language-ambiguous aliases remain backend evidence.
- Keep generated transliterations provisional. Use the formal, source-supported simplified Chinese name when available. Do not promote a Wikidata `zh-cn` label solely because it is the first localized label: compare it with the English/native name, occupation, and other aliases. If it is semantically unrelated to the person (for example, a common noun or machine-style label), retain it only as backend evidence and select a source-supported Chinese alias that matches the identity; record `wikidata_nonsemantic_label_gate`.
- Exclude non-human entities and quarantine conflicting external IDs or ambiguous aliases. Wikidata `P31` values use the real entity-id field (`datavalue.value.id`); descriptions such as “animal actor” are a secondary safety signal, so a candidate with a non-human instance-of claim must never enter People even when its label looks like a person's name.
- Check the Wikidata English description against the requested credit department before materialization. If a same-name human has only a clearly non-film identity (for example, an activist, politician, wrestler, or other sports identity) and no IMDb/TMDB crosswalk, exclude the QID and leave the credit unresolved; never repair an identity mismatch by name alone. The non-film occupation list must cover sports identities, not only athlete as a generic term.
- Before applying a reviewed report, compare its credits with the exact pre-pilot canonical work credits. Preserve every source/index credit that was not represented by the reviewed stable-identity set as an unlinked legacy credit; merge `personId` onto matched reviewed credits instead of replacing the source list with the shorter pilot subset. A lower-confidence or unresolved cast name must remain visible in the movie index and be queued for later review. Record `source_credit_preservation_gate` if an apply would reduce the canonical credit count.
- During source-preserving merge, match each reviewed credit only against one unconsumed pre-pilot source row. Never match a later pilot credit against an already appended pilot row, because distinct department/role credits for one person must remain separate. Record `source_credit_duplicate_preservation_gate` if a merge collapses reviewed role rows.
- Preserve an immutable `person_<uuid>` once allocated; do not manufacture or recycle IDs.

### 4. Curate the batch

Select the people and credit links explicitly in a batch config, then compose the individual discovery reports with `tools/person-batch-compose.mjs`. `profilePersonIds` must refer only to profiles in that report's `proposedProfiles`; `keepLinkedPersonIds` may also preserve an already-existing stable person ID that is already linked to the work but absent from the current discovery report. Check that preserved ID in both the canonical work credits and the Azure People catalog: if the movie index points at a missing catalog profile, record `stale_linked_person_catalog_gate`, preserve the legacy credit as unmaterialized, and queue the profile for a separate identity-reviewed pass rather than silently dropping or manufacturing it. Keep unselected or uncertain credits as visible unresolved names rather than creating weak person links.

Require zero unresolved identity conflicts for every profile that will be published. Ordinary unresolved legacy credits may remain unlinked when their identity has not been materialized.

### 5. Produce bilingual biographies

- Synthesize an original factual English biography from the collected evidence when no authoritative reusable original exists.
- Translate and edit that mother text into natural simplified Chinese, verifying names, works, institutions, places, awards, and other proper nouns separately.
- Write about the person's career, not about WWP's database relationship. Establish who the person is, their career arc, important collaborations, representative work, contribution or artistic character, and only precisely verified awards when relevant.
- Do not enumerate only the works currently held by WWP. The biography must remain useful if WWP adds or removes a linked title.
- Never publish workflow prose such as “相关作品关系由稳定外部身份记录核对”, “本小传依据资料综合改写”, “linking their profile to the film”, or vague filler such as “与某奖有关的荣誉或提名”. Provenance belongs in source and status fields, not reader-facing prose.
- Use natural Chinese film titles in Chinese prose and natural English titles in English prose. Do not mechanically append an English title inside every Chinese book-title mark.
- If an authoritative English text is used as factual input, still avoid copying protected prose; summarize it unless reuse rights clearly allow otherwise.
- Use Douban as a Chinese research lead, never as the sole verifier or as text to copy.
- Record 3–4 useful source URLs when available, spanning at least two independent source families. Sources are shared across languages; language status and method remain separate.
- Mark Chinese biography `verified` only after editorial rewrite and multi-source verification. Never label machine translation as reviewed.
- A verified biography must be substantive enough to establish a career rather than merely satisfy a non-empty-field check. The publication gate currently requires at least 100 non-whitespace Chinese characters and 45 English words. If reliable evidence cannot support that much, keep the biography partial and leave the profile out of a verified publication batch.
- Reject provider-credit templates such as “公开人物资料来自 Wikidata；在《…》中担任 Actor” and “documented in Wikidata / is credited as”. Reject obvious machine grammar such as `is a actor`. Do not repair these by padding them with generic filler.
- Reprocessing another work must never downgrade an existing verified editorial biography. Preserve the current Notion text unless the incoming replacement independently passes the same verified biography gate. This protection applies even when the biography field is not manually locked.
- Mark the whole person profile `verified` when stable external identity, verified Chinese and English names, at least one verified department, and verified bilingual editorial biographies are all present with no identity conflict. Portrait, exact dates, birthplace, native name, aliases, education, and award detail are valuable enhancements but are not mandatory for core verification.
- Keep structured person facts independent from biography prose. Publish supported dates, birthplace, original name, portrait, and external IDs even when other optional facts are absent; the website hides missing rows rather than substituting placeholders.
- Compute the versioned `Quality Score` after composing the effective reviewed profile. Use it to rank repair work, not as a public website rating. `Last Reviewed At` means a full identity/name/department/biography/source review completed, including a review that made no prose change; ordinary provider enrichment or Notion synchronization updates only `Last Enriched At` and must not refresh the review clock.
- A score below 80 is immediately review-due. Otherwise review living people after 12 months at 80-89 or 24 months at 90+, and deceased people after 60 months. P0/P1 correctness issues remain immediately due regardless of score. Follow [references/campaign-routing.md](references/campaign-routing.md) for the complete v1 rubric and ordering rules.

Apply reviewed biography and credit-name edits with `tools/person-biography-review.mjs`. Inspect the resulting report directly before any write.

### 6. Validate and preview every write

Run the focused people tests, API typecheck, and `git diff --check`. Then preview Notion operations and catalog/index changes. Confirm expected profile, work, credit, and unresolved counts before applying.

Never apply an offline diagnostic report or a report containing identity conflicts. Use the explicit reviewed-pilot gates for both Notion and catalog writes.

Before scaling a changed biography strategy, run a five-person quality pilot containing at least one director/creator and one actor. Require substantive bilingual text, 3–4 useful source URLs across at least two independent source families, zero identity conflicts, successful Notion readback, targeted Notion-to-Azure convergence, and an unchanged replay. Only then increase the batch size.

### 7. Publish in order

1. Upsert the reviewed people to Notion with its shared one-request-per-second limiter.
2. Read back the changed rows and stop on the first failure.
3. Apply the same reviewed report to the person catalog and search index.
4. For production, explicitly set both `PERSON_CATALOG_BACKEND=azure` and `SEARCH_INDEX_BACKEND=azure`; do not trust local `.env` defaults.
   The catalog apply must derive each reverse-link `workTitle` from the
   affected Azure work's primary `work.titles` entry, falling back to the
   report title only when the canonical entry is absent; a short provider title
   must not overwrite the canonical WWP title.
5. Run Notion-to-catalog sync as dry-run, apply, then a fresh dry-run. Require convergence with zero unexpected writes or issues. After sync, do not replay the pre-sync Wikidata report as the final catalog idempotence proof: Notion owns canonical names, aliases, biography overlays, source references, and observed timestamps once a page exists. Before replay, compare each affected canonical Azure work's total and linked credit counts with the original reviewed report and the pre-pilot source credit set; credit truncation is drift, not a healthy canonical state, and must be repaired by merging the reviewed person links into the source credit set before continuing. Then reload the post-sync canonical Azure profiles and credits, build a fresh same-batch replay from that state, use the primary entry from canonical `work.titles` for each replay work title, and require `catalogChanged=false` plus zero search-index writes. Keep the original reviewed report for identity, credit, and duplicate-link checks.
6. Open the live people directory and several changed person routes. Verify the simplified-Chinese biography, optional meta rows, external source links, roles, deduplicated works, reverse lookup, desktop layout, and mobile layout. English biography remains in Notion/catalog and is not rendered on the fixed Chinese website.

The production `job-ww-people-index` later carries safe Notion edits for known
people into Azure. It does not replace reviewed first publication, create an
unknown identity, or add work credits. `home:start` is not part of the
production People publishing path. The scheduled `job-ww-meta-index-incremental`
also reads Notion work pages; its Azure write path must preserve any already
materialized `personId` credits instead of replacing them with the shorter
legacy Notion credit list. After deploying a fix to this path, repair affected
works from the reviewed report and rerun the post-sync credit-count gate.

## Stop instead of weakening a gate

Stop and report completed and remaining counts when:

- identity evidence conflicts or could refer to multiple people;
- a group or organization needs a future entity model;
- source evidence is too weak for a verified name or biography;
- repeated rate limits occur;
- Notion readback fails, an API write partially fails, or a replay built from the post-sync canonical state is not idempotent;
- the configured catalog/search backend is not the intended target;
- unrelated dirty-worktree changes overlap files that must be edited.

## Report completion

State the selected works, people proposed/created/updated/unchanged, linked and unresolved credits, biography status by language, source quality issues, Notion result, catalog/index result, convergence result, live verification result, batch directory, and remaining candidates. Do not claim completion from source edits alone.
