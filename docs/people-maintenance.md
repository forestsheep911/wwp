# People / 创作人 maintenance

The People module uses stable internal `personId` values. Names are evidence attached to an identity, not identity keys. Never merge two people only because a Chinese, English, or normalized alias matches.

## Current boundaries

- Notion has one sibling database named `People / 创作人`; Version 1 does not create a Credits database.
- Work-person relationships remain in `MovieWorkProfile.credits` and the derived person catalog.
- Only credits with a stable `personId` become website links. Legacy names remain visible text.
- Real People rows remain gated until a diverse pilot has been reviewed.

## Configuration

Set these non-secret IDs after creating or locating the database:

```dotenv
NOTION_PEOPLE_DATABASE_ID=
NOTION_PEOPLE_DATA_SOURCE_ID=
PERSON_CATALOG_BACKEND=local
WWPDW_PEOPLE_NOTION_SYNC_ENABLED=true
WWPDW_PEOPLE_NOTION_SYNC_PAGE_SIZE=100
WWPDW_PEOPLE_NOTION_SYNC_OVERLAP_MINUTES=10
WWPDW_PEOPLE_STATE_DIR=.local-data/people
```

TMDB network enrichment additionally requires one of `TMDB_API_READ_ACCESS_TOKEN` or `TMDB_API_KEY`. Do not place credentials in tracked files.

Biographies are multilingual evidence, not one translated blob. `Biography ZH` and `Biography EN` are independently sourced and independently lockable. There is no generic `Biography` field because no legacy People data needs compatibility handling.

### Chinese biography workflow

`Biography ZH` is an editorial text field, not a place to copy a provider paragraph. Douban may be the primary Chinese-language research lead, but it never verifies a biography by itself.

1. Collect factual claims from Douban and record its celebrity/subject URL or stable ID in the shared `Sources` field.
2. Recheck the identity and material claims against at least one independent source family, such as Wikidata, TMDB, IMDb, an official biography, a festival profile, or a published interview. Two URLs from the same provider count as one source family.
3. Rewrite the biography in original simplified Chinese. Do not paste a Douban paragraph, lightly paraphrase it sentence by sentence, or mark a machine translation as reviewed.
4. Set `Biography ZH Method` to `editorial-rewrite`. Keep `source-summary`, `source-excerpt`, or `machine-translation` for unfinished material only.
5. Set `Biography ZH Status=verified` only after the rewritten text has at least two independent source families recorded. Otherwise keep it `partial`. `Data Status` continues to describe the completeness of the whole person profile independently.

The Notion sync enforces this gate. If `Biography ZH Status` claims `verified` while the Chinese biography is not marked `editorial-rewrite` or has fewer than two independent source families, the biography remains `provisional` and a `biography_verification_incomplete` issue is published for review. The profile's overall `Data Status` is not silently changed. Empty `Biography ZH` values do not block verification of unrelated person fields.

## Safe commands

Inspect the sibling target and proposed schema without writing:

```powershell
npm run people:notion-schema
```

Create the empty database only when no People IDs are configured and the dry-run target is correct:

```powershell
npm run people:notion-schema -- --apply
```

When the People database already exists, the same apply command migrates that configured data source. It adds the two localized properties, removes the known-empty deprecated `Biography` property, refreshes configured lock options, reads the schema back, and refuses unsafe type drift; it never creates a second database.

Discover a bounded candidate set from the current local search snapshot without network calls:

```powershell
npm run people:enrich -- --offline --limit 20 --output .local-data/people/pilot-offline-report.json
```

For npm versions that consume unknown flags, call the underlying command directly:

```powershell
node --import tsx tools/person-enrichment.mjs --offline --limit 20
```

Network dry-run is intentionally unavailable until a TMDB credential is configured. `--apply` remains gated until the pilot is reviewed. The runner uses an exclusive local lease, atomic checkpoints, provider-specific caches, and one shared limiter per provider.

Preview the reviewed report's Notion operations. This queries by immutable `Person ID` but performs no writes:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/pilot-report.json
```

After human review, apply to Notion with both explicit gates. Every row is read back, and replay resolves to unchanged rather than creating a duplicate:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/pilot-report.json --apply --confirm-reviewed-pilot
```

Preview the corresponding runtime catalog and work-credit update. The default target is `.local-data/home-site`, matching `home:start`; use `--local-data-dir .local-data` only for the ordinary development server:

```powershell
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/pilot-report.json
```

Apply only the same reviewed report. The command validates all work/person references before writing, keeps an ignored backup, restores changed search results if the catalog switch fails, and is idempotent on replay:

```powershell
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/pilot-report.json --apply --confirm-reviewed-pilot
```

Do not apply an offline audit report: its unresolved entries are diagnostics, not reviewed identity decisions.

Preview incremental edits from the Notion People data source. This reads pages changed since the successful checkpoint with a ten-minute overlap, but does not update the catalog or checkpoint:

```powershell
npm run people:sync -- --dry-run
```

Apply safe editorial fields and publish a new versioned person-catalog snapshot:

```powershell
npm run people:sync -- --apply
```

When `WWPDW_HOME_NOTION_SYNC_ENABLED=true`, `home:start` runs this People lane in every scheduled Notion cycle. The lanes are isolated: People sync is still attempted when movie metadata fails, and any lane failure makes the loop use its shorter failure retry interval.

The production Azure website does not depend on `home:start`. The scheduled
Container Apps Job `job-ww-people-index` runs the same safe People sync against
Azure every two hours by default. Its checkpoint and latest report are stored
in Azure Table Storage with `WWPDW_PEOPLE_SYNC_STATE_BACKEND=azure`, so the job
continues incrementally across ephemeral executions. Deploy it with
`infra/deploy-people-sync-job.ps1` and trigger an immediate run with
`infra/start-people-sync-job.ps1`.

The Job also propagates a reviewed display-name edit to that person's existing
linked credits in the Azure movie index. It scopes this operation to People
rows read in the current incremental window. The first run only establishes a
checkpoint and does not reinterpret historical credit names.

Automatic People sync may update names, aliases, biography, dates, birthplace, profile URL, departments, locked fields, data status, and website visibility for an existing immutable `personId`. It never creates an unknown identity. A changed external ID, duplicate `Person ID`, second Notion page bound to one person, or malformed row is quarantined as an admin issue; that row's ordinary changes remain unpublished until the identity problem is resolved.

The successful checkpoint and latest secret-safe report are stored under `WWPDW_PEOPLE_STATE_DIR`. Notion reads and reviewed writes share `notion-people.lock`, so a scheduled pull cannot observe a partially completed upsert batch.

## Editorial rules

- Lock `Chinese Name`, `English Name`, `Original Name`, `Biography ZH`, `Biography EN`, or `Profile URL` in Notion before making a manual correction that enrichment must preserve.
- Keep the Chinese and English biographies independently sourced. A missing Chinese biography may fall back to English on the website, but an automatic translation must not be marked verified without review.
- Use Douban as a fact lead, not as publishable biography copy. A verified biography must be backed by at least two independent source families recorded as separate URLs or stable IDs in the shared `Sources` field.
- `Hide from Website` and `Developer Memo` are always editor-owned.
- A formal public Chinese name must be `verified` or entity-linked `strong`. Generated transliterations stay `provisional`.
- Resolve a merge through stable TMDB, IMDb, or Wikidata evidence. A merge keeps a redirect from the retired ID.
- Treat external-ID conflicts and ambiguous aliases as review issues; do not lower the identity threshold to increase coverage.

## Verification order

After any future apply batch, read back the changed Notion rows, rebuild/read the person catalog, test `/api/people`, `/api/people/:id`, and `/api/browse-assets?person=...`, then open the rendered person route on desktop and mobile. Rerun the same batch and require zero duplicate rows or unexpected writes.
