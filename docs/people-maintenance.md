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

The Notion sync enforces this gate. If `Biography ZH Status` claims `verified` while the Chinese biography is not marked `editorial-rewrite` or has fewer than two independent source families, the biography remains `provisional` and a `biography_verification_incomplete` issue is published for review. The profile's overall runtime status is recalculated from the explicit core checklist below. Empty `Biography ZH` values do not block verification of unrelated person fields, but they do keep the core profile incomplete.

People publication must preserve the source work's complete credit list. A Wikidata pilot may identify only a stable subset of a larger Notion/movie-index cast list; apply `personId` only to matched reviewed credits and keep the remaining source names as unlinked legacy credits. Replacing the source list with the shorter pilot subset is a `source_credit_preservation_gate` failure and must be repaired before the work is considered covered.
When merging, consume each pre-pilot source credit at most once; append each unmatched reviewed credit rather than matching it against an earlier appended pilot row. This preserves separate department/role credits for the same person. Collapsing reviewed role rows is a `source_credit_duplicate_preservation_gate` failure.

Reader-facing biographies are person-centred career summaries, not WWP credit
audits. Do not mention that a relationship was checked, that text was rewritten
from sources, or that the person appears in the current WWP holdings. Cover the
career arc, important collaborations, representative works, contribution or
artistic character, and only precise supported awards. The quality gate rejects
the retired workflow-template phrases in both Chinese and English.

Verified biographies also have a substantive minimum: 100 non-whitespace
Chinese characters and 45 English words. This is an evidence floor, not a
prompt to add filler. Known Wikidata/credit templates and obvious machine
grammar are rejected. If an existing Notion row already contains a verified
`editorial-rewrite`, a later enrichment pass cannot replace it with a weaker
provider summary even when the field is unlocked; the replacement must pass the
same method, source-family, template, and length gates.

`Data Status=verified` now has a concrete core meaning: at least one stable
external identity, verified Chinese and English names, a verified department,
and verified bilingual editorial biographies backed by two independent source
families, with no identity conflict. Portrait, exact dates, birthplace, native
name, additional aliases, education, and detailed awards are enhancements and
do not keep an otherwise verified core profile permanently partial. This is an
editorial/admin status and is not shown on the public person page.

### Quality assessment and review time

`Quality Score` is a versioned 0-100 internal maintenance score. Version 1
weights identity 25, verified names and departments 15, bilingual biographies
and evidence 45, and optional structured metadata 15. Identity conflicts cap
the result at 39, public correctness defects at 69, and an incomplete bilingual
biography at 79. The score is used by the repair queue and Notion editors; it is
not displayed on the public website and does not measure a person's importance.
The runtime catalog also stores the policy version and component scores so a
future rubric change can be distinguished from a profile improvement.

`Last Reviewed At` means a complete editorial review of identity, names,
departments, biographies, and sources. Set it after a completed review even
when no textual change was necessary. `Last Enriched At` remains the ordinary
profile/synchronization update time and must never reset this review clock.
Profiles below 80 or carrying P0/P1 correctness issues are due immediately;
otherwise living profiles are reviewed after 12 months at 80-89 or 24 months
at 90+, and deceased profiles after 60 months. Existing high-quality bilingual
profiles may infer an initial review date from their editorial evidence times;
other rows remain empty until a real review occurs.

### Public person metadata

The person page may show exact or partial birth/death dates, a simplified-Chinese birthplace, a distinct original name, portrait, and stable TMDB/IMDb/Wikidata links. Every value is optional and unsupported rows are omitted. Dates preserve source precision: a known year must never be expanded into an invented month or day.

Primary departments remain the public career labels and are not repeated as a separate occupation row. Aliases remain backend search evidence until they have been deduplicated, language-labelled, and checked for simplified-Chinese suitability. Provider popularity, gender inferred from presentation, and an external provider's full filmography are not public WWP metadata. The works section continues to mean only titles actually held by WWP.

Do not accept a localized provider label as a person's Chinese display name merely because it is tagged `zh-cn`. Check that the label is semantically a person's name and agrees with the English/native identity and occupation. A common-noun or machine-style label remains evidence only; use a source-supported Chinese alias that matches the person and record the `wikidata_nonsemantic_label_gate` when this condition is encountered.

TMDB is a useful structured-data lead, not a sole verifier for disputed biographical facts. Cross-check material claims against another independent source family, record all useful URLs in `Sources`, and refresh provider-derived cached facts within the provider's allowed retention period. The website carries TMDB attribution in its help/credits area.

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
- Keep the Chinese and English biographies independently sourced. The fixed Chinese website never falls back to English; a missing Chinese biography renders a short pending placeholder. English remains available in Notion/catalog, and an automatic translation must not be marked verified without review.
- Use Douban as a fact lead, not as publishable biography copy. A verified biography must be backed by at least two independent source families recorded as separate URLs or stable IDs in the shared `Sources` field.
- `Hide from Website` and `Developer Memo` are always editor-owned.
- A formal public Chinese name must be `verified` or entity-linked `strong`. Generated transliterations stay `provisional`.
- Resolve a merge through stable TMDB, IMDb, or Wikidata evidence. A merge keeps a redirect from the retired ID.
- Treat external-ID conflicts and ambiguous aliases as review issues; do not lower the identity threshold to increase coverage.

## Verification order

After any future apply batch, read back the changed Notion rows, rebuild/read the person catalog, test `/api/people`, `/api/people/:id`, and `/api/browse-assets?person=...`, then open the rendered person route on desktop and mobile. Rerun the same batch and require zero duplicate rows or unexpected writes.
