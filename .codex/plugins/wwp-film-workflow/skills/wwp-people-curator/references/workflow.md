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
  notion-state/
  catalog-state/
  sync-preview/
  sync-apply/
  sync-convergence/
```

Never track these artifacts or credentials in Git.

## Discover one work

The snapshot must contain the WWP work ID. Verify the Wikidata work QID before running:

```powershell
node --import tsx tools/person-wikidata-pilot.mjs --work-id <wwm_work_id> --wikidata-id <QID> --kind movie --profile-budget 10 --interval-ms 1500 --snapshot .local-data/home-site/search-index.json --state-dir .local-data/people/<batch-slug>/<work-slug> --output .local-data/people/<batch-slug>/<work-slug>/review-report.json
```

Use `--kind series` for a series. Repeat the same command to resume from cache/checkpoint. Use repeated `--exclude-wikidata-id <QID>` arguments for known non-person or incorrect candidates.

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

`profilePersonIds` controls profiles included in the batch. `keepLinkedPersonIds` controls which credit links remain active. Do not link a person merely because a same-named profile exists.

```powershell
node --import tsx tools/person-batch-compose.mjs --config .local-data/people/<batch-slug>/batch-config.json --output .local-data/people/<batch-slug>/composed-report.json
```

## Apply editorial review

Prepare `biography-reviews.json` with the reviewed bilingual text, source references, statuses, methods, and any credit-name corrections expected by the existing review tool. Compare each entry against the corresponding composed profile before running:

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
- `searchIndexWrites` covers affected works only;
- replay produces no duplicate people or credits.

## Prove Notion-to-catalog convergence

Use separate state directories so the final dry-run is a real read, not a reused successful checkpoint:

```powershell
$env:PERSON_CATALOG_BACKEND = 'azure'
$env:SEARCH_INDEX_BACKEND = 'azure'
node --import tsx tools/notion-people-sync.mjs --dry-run --state-dir .local-data/people/<batch-slug>/sync-preview
node --import tsx tools/notion-people-sync.mjs --apply --state-dir .local-data/people/<batch-slug>/sync-apply
node --import tsx tools/notion-people-sync.mjs --dry-run --state-dir .local-data/people/<batch-slug>/sync-convergence
```

Require the convergence run to report zero applied changes, quarantined rows, invalid rows, and issues. A healthy established catalog normally reports all scanned rows as unchanged.

## Verify the rendered result

Open the deployed people directory and at least three changed person routes, including one creator and one actor. Verify:

- the public count increased by the expected number;
- Chinese names and biographies use simplified Chinese;
- English biographies are substantive and factual;
- roles are grouped under each work, so one work is not repeated for director/editor/writer credits;
- clicking a person shows all linked works through the reverse index;
- search/query state does not leak into the canonical person URL;
- desktop and mobile layouts remain usable.

Finally rerun the reviewed batch as a dry-run and require no unexpected writes.
