# WWP People Curator command map

Run commands from the repository root. Replace angle-bracket placeholders and keep all files for one run under `.local-data/people/<batch-slug>/`.

## Batch artifacts

Use this layout:

```text
.local-data/people/<batch-slug>/
  <work-slug>/
    cache/
    checkpoint.json
    review-report.json
  batch-config.json
  composed-report.json
  biography-reviews.json
  reviewed-report.json
  work-coverage.json
  notion-state/
  catalog-state/
  sync-preview/
  sync-apply/
  sync-convergence/
```

Never track these artifacts or credentials in Git.

Before any production-bound discovery command in the current PowerShell
process, select the production identity catalog explicitly:

```powershell
$env:PERSON_CATALOG_BACKEND = 'azure'
```

## Build a historical work queue

Read the current production movie index once and persist the result. This call
does not contact Notion or external metadata providers:

```powershell
node --import tsx tools/people-work-coverage-audit.mjs --backend azure --candidate-limit 100 --output .local-data/people/<batch-slug>/coverage-audit.json
```

Prioritize `missing_credits` works that already have a stable external work ID,
then `unlinked_only`, then `partially_linked`. The audit is a queue, not proof
that a person identity is correct. Refresh it after each published umbrella
batch instead of rescanning providers for already completed works.

The queue's `sourcePageId` is an address hint, not an identity proof. If that
page ID is stale (`object_not_found`) or an exact refresh resolves to another
stable work ID, stop the people lane. Query the configured Notion library data
source by exact title and a strong external ID, require exactly one active
canonical page, and distinguish a download-only/legacy carrier from the active
work page. Use the active page's stored `WW Work ID` as canonical; never
rewrite one stable ID into another merely to satisfy the old queue. If the match
is not unique or the active page has no stable ID, quarantine it and record the
identity defect before resuming.

The coverage audit also collapses same-kind, same-year entries with the same
IMDb into one queue item, preferring the non-legacy entry and the richer credit
set. This prevents a stale download-only carrier from being selected again
after the canonical page has been repaired.

For a series or season, the Wikidata QID must expose usable credit statements
for the selected scope. An empty season item, a parent-series fallback, or an
OMDb response identified as an episode is not a valid season credit source.
Record the source defect, keep those names unresolved, and continue to the next
queue candidate when no independent stable-identity source is available.

Wikidata person materialization must inspect real `P31` entity IDs from
`datavalue.value.id`, not only labels or descriptions. A QID whose instance-of
claims identify an animal, fictional character, organization, or other
non-human entity is excluded before profile allocation; an animal-actor label
must not be treated as a human performer.

Before allocating a profile, compare the QID's English description with the
credit department. A same-name human whose description is clearly a non-film
identity (for example, an activist, politician, wrestler, or other specific
sports identity) and who has no IMDb/TMDB crosswalk is excluded as an identity
mismatch; keep that credit unresolved and record the QID for review rather than
merging by label. The non-film occupation list must cover specific sports
identities, not only `athlete` as a generic term.

Do not treat the first Wikidata `zh-cn` label as the person's public Chinese
name without a semantic check. Compare it with the English/native name,
occupation, and other aliases. If it is a common noun or otherwise unrelated to
the identity, keep it as backend evidence, choose a source-supported Chinese
alias matching the person, and record `wikidata_nonsemantic_label_gate`; never
publish the unrelated label as the display name.

Before applying a reviewed report, compare the report's credit set with the
exact canonical work credits captured before Wikidata discovery. Merge reviewed
`personId` values onto matching source credits and retain every source credit
that was not represented by the pilot as an unlinked legacy credit. Never let a
shorter stable-identity pilot subset replace the source/index credit list. If
the planned apply reduces the canonical credit count, stop, record
`source_credit_preservation_gate`, and repair by merging the reviewed links
back into the source set.

During that merge, match a reviewed credit only against one unconsumed
pre-pilot source row. Do not match a later pilot credit against a pilot row
that was appended earlier in the same merge: separate departments or roles
for one person remain separate credits. Record
`source_credit_duplicate_preservation_gate` if reviewed role rows collapse.


For `missing_credits` plus IMDb, preview and apply the exact OMDb metadata page
first, allow the exact work to reach the movie index, and only then run the
Wikidata pilot. Existing director/writer/top-cast strings become prominence
anchors. This prevents unordered Wikidata cameo or archival-appearance claims
from consuming the first profile budget ahead of principal cast.

The exact movie-index refresh must be keyed by the selected Notion page. Do not
use `meta-sync ondemand 1` for this gate: it means one most-recently-edited
page, not the selected page, and can silently leave the target work at zero
credits. With Azure selected, run:

```powershell
$env:PERSON_CATALOG_BACKEND = 'azure'
$env:SEARCH_INDEX_BACKEND = 'azure'
node --import tsx tools/notion-index-refresh.mjs --page-id <page-id> --title <title>
```

Read the exact Azure work entry back and require its credit count to be
non-zero before starting Wikidata discovery. Record any zero-credit mismatch
as a metadata refresh defect and repair it before proceeding.

This setting is required during materialization, not only during catalog apply,
so an existing production person is assigned their immutable current
`personId`. The runner also binds the person catalog to an explicit
`--search-backend` when the environment variable is absent, and fails if the
two backends conflict. If a dry-run later reports a duplicate external ID, regenerate the
discovery report against Azure instead of editing IDs by hand.

## Discover one work

The snapshot must contain the WWP work ID. Verify the Wikidata work QID before running:

```powershell
node --import tsx tools/person-wikidata-pilot.mjs --work-id <wwm_work_id> --wikidata-id <QID> --kind movie --profile-budget 10 --interval-ms 1500 --search-backend azure --state-dir .local-data/people/<batch-slug>/<work-slug> --output .local-data/people/<batch-slug>/<work-slug>/review-report.json
```

Use `--search-backend azure` for production work so the OMDb prominence anchors
and existing links come from the latest movie index. Use `--snapshot <path>`
only for an intentional local/offline review.

Use `--kind series` for a series. Repeat the same command to resume from cache/checkpoint. Use repeated `--exclude-wikidata-id <QID>` arguments for known non-person or incorrect candidates.

`profile-budget` limits only the number of candidate identities materialized and reviewed in that discovery pass. It is not a cap on stored credits, important cast, linked people, or eventual profiles for the work. Preserve the complete work-credit evidence and run another reviewed pass when significant unresolved people remain.

The network budget is approximately one work-credit request plus up to `profile-budget` person requests when the cache is cold. Additional biography-source checks are outside this number. Run works sequentially.

For an explicitly requested large observation batch, keep one umbrella directory but create independently reviewable/publishable sub-batches of no more than 20 people. Apply and verify one sub-batch before advancing to the next. Every auxiliary biography/source collector must use a 20-second request timeout, at most one jittered retry, and a response checkpoint.

## Compose a curated batch

Create `batch-config.json` only after reviewing each discovery report. Its shape is:

```json
{
  "inputs": [
    {
      "report": "first-work/review-report.json",
      "profilePersonIds": ["person_<uuid>"],
      "keepLinkedPersonIds": ["person_<uuid>"],
      "creditNameOverrides": {
        "Q123": "核实后的简体中文姓名"
      }
    }
  ]
}
```

`profilePersonIds` controls profiles included in the batch and must be a subset of
the report's `proposedProfiles`; use it for new profiles or reviewed updates that
need to be upserted. `keepLinkedPersonIds` controls which credit links remain
active and may additionally contain an already-existing stable `person_<uuid>`
that is present in the current work's canonical links but omitted from this
discovery report. Preserve that existing link without duplicating the profile in
the batch. Before adding such an ID, check both the canonical work credits and the
Azure People catalog: a movie-index link whose `personId` has no catalog profile
is a stale linked-person defect. Preserve the credit as an unmaterialized legacy
link for this repair pass, record the defect, and queue the missing profile for a
separate identity-reviewed pass; never silently drop the link during compose and
never create a profile from the `personId` alone. Do not link a person merely
because a same-named profile exists.

```powershell
node --import tsx tools/person-batch-compose.mjs --config .local-data/people/<batch-slug>/batch-config.json --output .local-data/people/<batch-slug>/composed-report.json
```

## Apply editorial review

Prepare `biography-reviews.json` with the reviewed bilingual text, source references, statuses, methods, and any credit-name corrections expected by the existing review tool. Compare each entry against the corresponding composed profile before running:

The prose must be person-centred and independent of the current WWP holdings.
Reject a review that reads like a credit audit, mentions database verification,
lists only the selected discovery works, or uses vague award filler instead of
specific facts. Build a factual brief first: career stages, important
collaborations, representative works, contribution or style, and precise awards
when well supported. Use the source/status fields for provenance.

```powershell
node --import tsx tools/person-biography-review.mjs --report .local-data/people/<batch-slug>/composed-report.json --reviews .local-data/people/<batch-slug>/biography-reviews.json --output .local-data/people/<batch-slug>/reviewed-report.json
```

Inspect `identityIssues`, `unresolved`, every `proposedProfile`, and every `proposedCredit` in the output. Resolve identity issues before applying.

## Focused validation

```powershell
node --test --import tsx apps/api/src/person-biography-review.test.ts apps/api/src/person-biography-quality.test.ts apps/api/src/person-enrichment.test.ts apps/api/src/person-catalog-apply.test.ts apps/api/src/person-materialization.test.ts apps/api/src/person-service.test.ts apps/api/src/person-notion-sync.test.ts apps/api/src/person-sources/provider-http.test.ts apps/api/src/person-sources/wikidata.test.ts apps/api/src/person-sources/wikidata-work.test.ts apps/api/src/person-sources/tmdb.test.ts apps/api/src/person-sources/imdb.test.ts
npm run typecheck --workspace @wwpdw/api
git diff --check
```

## Preview and apply Notion

Preview first. The preview reports estimated queries, maximum writes, readbacks, identity issues, and unresolved credits:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/notion-state
```

Apply only after reviewing the exact report:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/notion-state --apply --confirm-reviewed-pilot
```

The tool uses concurrency 1, a shared 1000 ms limiter, checkpointed progress, readback, and stop-on-first-failure behavior. On repeated 429 responses, do not immediately rerun; report progress and resume later from the same state directory.

## Preview and apply the catalog/index

Local preview, if intentionally testing the home-site files:

```powershell
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/catalog-state --dry-run
```

For the production Azure target, override both stores in the current PowerShell process and preview before apply:

```powershell
$env:PERSON_CATALOG_BACKEND = 'azure'
$env:SEARCH_INDEX_BACKEND = 'azure'
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/catalog-state --dry-run
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/catalog-state --apply --confirm-reviewed-pilot
```

Only set `SEARCH_INDEX_SNAPSHOT_PATH` when the snapshot is current and known to contain every target work. Otherwise let the Azure store read the complete current index. Use `SEARCH_INDEX_SNAPSHOT_PROGRESS=true` only when progress diagnostics are needed.

Expected apply characteristics:

- `peopleAdded` equals the genuinely new reviewed profiles;
- `creditsLinked` reflects the selected links, not all discovered names;
- `catalogChanged` is true only when profile state changes;
- reverse person-to-work links use the affected Azure work's primary canonical
  title, not a shorter provider or Wikidata title from the report;
- `searchIndexWrites` covers affected works only;
- replay produces no duplicate people or credits.

## Prove Notion-to-catalog convergence and post-sync replay idempotence

Use separate state directories so the final dry-run is a real read, not a reused successful checkpoint:

```powershell
$env:PERSON_CATALOG_BACKEND = 'azure'
$env:SEARCH_INDEX_BACKEND = 'azure'
node --import tsx tools/notion-people-sync.mjs --dry-run --state-dir .local-data/people/<batch-slug>/sync-preview
node --import tsx tools/notion-people-sync.mjs --apply --state-dir .local-data/people/<batch-slug>/sync-apply
node --import tsx tools/notion-people-sync.mjs --dry-run --state-dir .local-data/people/<batch-slug>/sync-convergence
```

Require the convergence run to report zero applied changes, quarantined rows, invalid rows, and issues. A healthy established catalog normally reports all scanned rows as unchanged.

The scheduled metadata index job also writes Azure movie rows from Notion. Its
Azure branch must merge and preserve already materialized `personId` credits;
otherwise a later Notion refresh can silently replace a complete reviewed
credit list with the shorter legacy list. If this drift is observed, repair the
affected work from the reviewed report, deploy the metadata-job fix, and rerun
the total/linked credit-count gate before declaring the batch complete.

The reviewed pilot report is the pre-sync publication input. Once a Notion page exists,
Notion sync may canonically normalize simplified names, aliases, biography overlays,
source references, and observed timestamps in Azure. Therefore do not use that stale
pre-sync report as the final catalog idempotence input: it can produce a false
`catalogChanged=true` even when the live catalog is stable. After convergence, reload
the affected canonical profiles and credits from Azure, construct a same-batch replay
from that post-sync state. When reconstructing `proposedCredits`, take the work title
from the primary entry in canonical `work.titles`; do not substitute the work ID when a
canonical title exists. First compare each affected work's canonical total and linked
credit counts with the original reviewed report. If credits were truncated or links
were lost, repair the affected work from the reviewed report and rerun convergence;
do not call a truncated-but-self-consistent state idempotent. Require
`catalogChanged=false` and zero search-index writes. Continue to use the original reviewed report for identity, selected-credit,
unresolved-credit, and duplicate-link assertions.

## Verify the rendered result

Open the deployed people directory and at least three changed person routes, including one creator and one actor. Verify:

- the public count increased by the expected number;
- Chinese names and biographies use simplified Chinese;
- the public page shows only the simplified-Chinese biography; English biographies remain substantive and factual in the reviewed report and Notion/catalog;
- supported birth/death dates, simplified-Chinese birthplace, original name, and stable external links render without empty placeholder rows;
- uncurated aliases, provider popularity, and external full filmographies are not exposed;
- roles are grouped under each work, so one work is not repeated for director/editor/writer credits;
- clicking a person shows all linked works through the reverse index;
- search/query state does not leak into the canonical person URL;
- desktop and mobile layouts remain usable.

Finally rerun the reviewed batch as a dry-run and require no unexpected writes.
