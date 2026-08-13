# WWP People Module Design

Date: 2026-08-10  
Status: Approved for implementation planning; real person-data writes gated by the reviewed pilot (verified empty-schema creation is allowed earlier)

## Problem

WWP currently stores directors and cast primarily as display strings on a work. The runtime model already has structured `MovieCreditEntry` values with department, job, character, order, and an optional `personId`, and the search index already includes those fields. However, a person is not yet a first-class entity: there is no stable person identity, multilingual name history, conflict state, person catalog, reverse work index, person API, or person page.

This prevents reliable person-based browsing. A name-only implementation would also create unsafe merges across homonyms, regional translations, aliases, stage names, and people whose Chinese, English, and native-script names differ.

The current local home-site snapshot contains about 1,026 work entries. About 924 have a TMDB ID and 980 have an IMDb ID, so most works can be used as identity anchors. The current name strings represent only a partial cast/crew picture and must be treated as migration hints rather than authoritative person records.

## Goals

- Make people first-class, stable entities independent of any spelling of their names.
- Support verified Chinese display names, English or Latin-script names, native-script names, aliases, and transliterations with provenance.
- Preserve a person's different jobs, characters, and billing order per work.
- Let users open a person from a work and select WWP works by that person.
- Make ingestion incremental, resumable, idempotent, and safe under Notion and external-provider rate limits.
- Preserve existing work search and legacy director/cast display while the migration is incomplete.
- Provide explicit review queues for ambiguous identity and name conflicts.

## Non-goals for Version 1

- Do not mirror every external title in a person's complete filmography into the WWP catalog.
- Do not create one Notion row for every credit relationship.
- Do not automatically accept AI-generated transliterations as verified names.
- Do not merge people because their normalized names match.
- Do not replace the existing work metadata and Media Assets databases.
- Do not require every background crew member before person browsing can launch.
- Do not publish private, inferred, or gossip-oriented biographical information.

## Chosen Architecture

Version 1 adds one editable Notion database, `People / 创作人`, and two derived runtime structures: a person catalog and a work-credit reverse index.

```text
Notion Works ── work sync ──> MovieWorkProfile.credits
                                      │
TMDB / IMDb / Wikidata ── enrichment ─┼──> Person catalog
                                      │
Notion People ── curated overrides ───┘
                                      │
                                      └──> person -> WWP works reverse index
                                                   │
                                                   └──> API and website
```

`MovieCreditEntry` remains the relationship record. It already carries the fields that a join table would need: person, department, job, character, order, and source. A separate Notion `Credits` database is deferred because it would create many thousands of rows and substantial API amplification without improving the first user-facing outcome.

If editors later need to maintain individual credit rows in Notion, a `Credits` database can be introduced without replacing person IDs or the runtime relationship shape.

## Identity Model

### Stable internal identity

Every person receives an opaque, immutable internal `personId`. External identifiers are unique indexed attributes, not the primary key.

```ts
export interface PersonExternalIds {
  tmdb?: string;
  imdb?: string;       // nm-prefixed person identifier
  wikidata?: string;   // Q-prefixed entity identifier
}

export interface PersonProfile {
  personId: string;
  names: PersonNameEntry[];
  externalIds?: PersonExternalIds;
  departments?: MovieCreditDepartment[];
  biography?: PersonBiography;
  profileImages?: PersonImage[];
  sourceRefs?: PersonSourceRef[];
  dataQuality: PersonDataQuality;
  createdAt: string;
  updatedAt: string;
}
```

An external-ID correction must not change `personId`. Merged records retain redirects from retired IDs; splitting a mistaken merge creates a new ID and moves only the proven credits.

The catalog writer allocates `person_<uuid>` with `crypto.randomUUID()` only after checking all external-ID indexes. Only one enrichment writer may hold the people-sync lease at a time. The Azure implementation uses a conditional lease/ETag; the local implementation uses an exclusive lock file. If a lease is lost or a conditional write conflicts, the runner stops, reloads indexes, and retries the identity decision rather than minting a second record. Notion never allocates `personId` and is not relied on to enforce uniqueness.

Pure catalog rebuilds never allocate identities. They consume already assigned `personId` values and leave unassigned credits unresolved. UUID allocation occurs only in the guarded enrichment/upsert transaction, so rebuilding the same accepted catalog state is deterministic.

### Identity evidence order

Automatic identity linkage uses this order:

1. Exact shared TMDB person ID.
2. Exact shared IMDb `nm` ID.
3. Exact shared Wikidata QID.
4. A provider crosswalk that connects at least two of those identifiers.
5. One stable external identifier plus the expected work, department/job, and credit position may attach a credit to the one record already indexed by that identifier; it may not merge two person records that lack a shared identifier.
6. Name, birth date, profession, and multiple overlapping works as a review candidate only.

Name equality alone never authorizes an automatic merge. Conflicting IDs within the same namespace, such as two different TMDB person IDs, always remain separate until a conflict is explicitly resolved. Different namespaces may be linked only by an explicit provider crosswalk or independently verified entity evidence.

## Multilingual Name Model

Names are observations with provenance rather than fixed columns that overwrite one another.

```ts
export type PersonNameKind =
  | "display"
  | "original"
  | "alternate"
  | "stage"
  | "transliteration";

export type PersonNameStatus =
  | "verified"
  | "strong"
  | "provisional"
  | "conflict"
  | "rejected";

export interface PersonNameEntry {
  value: string;
  language?: string;
  script?: string;
  region?: string;
  kind: PersonNameKind;
  source: MovieMetadataSource;
  status: PersonNameStatus;
  sourceRef?: string;
  observedAt: string;
}
```

### Chinese display-name resolution

The visible Simplified Chinese name is selected by this precedence:

1. A manual WWP override explicitly locked by an editor.
2. A previously verified Notion People value.
3. A Wikidata `zh-cn` or `zh-hans` label tied to the verified entity.
4. A Chinese TMDB alias tied to the verified TMDB person ID.
5. A name from a Chinese work credit whose person identity has been independently matched.
6. Otherwise no formal Chinese name is claimed; show the English or native name.

Traditional Chinese, regional translations, and other established Chinese spellings remain aliases. Simplified/traditional conversion may create hidden search keys, but it must not create a new verified display value.

AI transliteration may produce a `provisional` search alias. It may never overwrite a verified name or appear as the formal Chinese display name without review.

### English and native-name resolution

- English display precedence is: locked manual WWP value, verified Notion People value, IMDb `primaryName` tied to the verified IMDb ID, Latin-script TMDB canonical name tied to the verified TMDB ID, Wikidata English label, then a verified Latin-script alias.
- Native/original display precedence is: locked manual WWP value, verified Notion People value, Wikidata native-language label tied to the entity, then a provider canonical name whose script matches the person's verified native language.
- IMDb `primaryName`, TMDB canonical name, and Wikidata English label are still retained separately as aliases when they differ.
- A native-script label is stored as `original` only when its entity and language/script are known.
- Latin transliteration is not mislabeled as the person's native name.
- Hyphenation, spacing, diacritics, and surname order variants are preserved as aliases even when one value is selected for display.

The Notion title field `Name` and website primary heading use the selected public Chinese name when available; otherwise they use the selected English name, then the selected native/original name. Version 1 permits `verified` and `strong` Chinese names to be public. `strong` requires a stable person identity and one entity-linked credible Chinese source. `provisional`, `conflict`, and generated-only names are never selected as the formal public Chinese name.

`rejected` is a runtime observation status used to keep a bad alias from being proposed again. It is not a Notion `Name Status` option and is not shown publicly.

### Search normalization

Search keys may apply Unicode NFKC normalization, case folding for relevant scripts, punctuation/space folding, and explicit simplified/traditional aliases. The original stored value is never rewritten by normalization.

Normalization is for retrieval, not identity. Every alias match resolves through a person ID, and an ambiguous alias returns multiple candidates rather than silently choosing one.

## Credit Model Changes

Introduce `PersonExternalIds` rather than reusing title-oriented `MovieExternalIds`. Update `MovieCreditEntry` to use the person-specific type while retaining its current backward-compatible fields.

```ts
export interface MovieCreditEntry {
  personId?: string;
  name: string;
  originalName?: string;
  department: MovieCreditDepartment;
  job?: string;
  character?: string;
  order?: number;
  source?: MovieMetadataSource;
  externalIds?: PersonExternalIds;
}
```

The same person may have multiple credit entries for one work when jobs or characters differ. The relationship identity key is `workId + personId + department + normalized job + normalized character`; billing `order` is mutable display metadata and is not part of identity. A changed order updates the existing relationship rather than creating a second one. The model must not collapse a director/actor or writer/producer into one generic row.

## Person Catalog

The person catalog mirrors the existing work-catalog approach but keeps independent schema and indexes.

```ts
export interface PersonCatalogState {
  schemaVersion: 1;
  generatedAt: string;
  people: Record<string, PersonCatalogEntry>;
  externalIdIndex: {
    tmdb: Record<string, string>;
    imdb: Record<string, string>;
    wikidata: Record<string, string>;
  };
  aliasIndex: Record<string, string[]>;
  creditsByWorkId: Record<string, PersonCreditRef[]>;
  creditsByPersonId: Record<string, PersonWorkCreditRef[]>;
  issues: PersonCatalogIssue[];
}
```

The runtime store may use the same local/Azure backend pattern as the work catalog. `creditsByWorkId` lets a work resolve people without scanning the catalog; `creditsByPersonId` powers person pages and filtering.

`PersonDataQuality.status` uses `draft`, `partial`, `verified`, or `conflict`. Merge candidates remain issues until applied by a guarded operation. A merge creates exactly one canonical ID and redirects retired IDs; redirect chains are flattened and cycles are rejected. A split never reuses a retired ID and moves only explicitly selected credits/evidence. Every merge/split records actor, time, evidence, and before/after IDs.

## Notion People Database

Version 1 creates one People data source with these managed fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `Name` | title | Editor-facing preferred name |
| `Person ID` | rich text | Immutable WWP identity |
| `Chinese Name` | rich text | Selected Simplified Chinese display name |
| `English Name` | rich text | Selected English/Latin display name |
| `Original Name` | rich text | Native-script name when known |
| `Aliases` | rich text | Reviewable display aliases; full structured aliases remain runtime data |
| `TMDB Person ID` | rich text | External identity |
| `IMDb Name ID` | rich text | `nm` external identity |
| `Wikidata QID` | rich text | External identity |
| `Primary Departments` | multi-select | Directing, writing, acting, music, etc. |
| `Birth Date` | date | Public biographical fact when sourced |
| `Death Date` | date | Public biographical fact when applicable |
| `Birth Place` | rich text | Sourced public value |
| `Biography ZH` | rich text | Curated Chinese short biography |
| `Biography EN` | rich text | Curated English short biography |
| `Profile URL` | url | Source or durable image URL |
| `Name Status` | select | verified/strong/provisional/conflict |
| `Locked Fields` | multi-select | Chinese Name, English Name, Original Name, Biography ZH, Biography EN, Profile URL |
| `Data Status` | select | draft/partial/verified/conflict |
| `Sources` | rich text | Compact provenance summary |
| `Last Enriched At` | date | Incremental sync marker |
| `Hide from Website` | checkbox | Publication control |
| `Developer Memo` | rich text | Review notes and conflict evidence |

The first version does not write a Notion relation for every work. WWP work membership is derived from credits, avoiding thousands of relation writes and preserving job/character/order information. A read-only work count or selected known-for summary may be added later.

## Initial Credit Scope

The first production denominator is deliberately bounded:

- all directing and writing credits returned at work/series level
- acting credits through TMDB billing order 19 (top 20) when available
- all credited producers, cinematographers/directors of photography, editors, and original-music composers returned at work level
- series-level creators, directors, writers, and top-20 main cast; episode-only credits are deferred

The 95% linkage target applies only to this scope. The pilot may narrow a provider-specific job mapping, but it must lock the production scope before the 100-work expansion begins.

## Source Policy

### TMDB

TMDB is the primary operational source because most current works already have a TMDB title ID. Work credits provide person IDs, department/job, character, and order. Person details and external IDs provide identity and biographical candidates.

TMDB-derived text and images retain source attribution. Commercial-use or image-license requirements must be reviewed before expanding WWP beyond its current use.

### IMDb

IMDb person IDs and non-commercial datasets provide a strong identity cross-check for directors, writers, principal credits, professions, birth/death years, and known-for titles. Usage must remain within the applicable non-commercial terms. IMDb data is not treated as permission to copy arbitrary IMDb page prose or images.

### Wikidata

Wikidata is the preferred open source for multilingual labels and selected public biographical facts. Entity IDs and statement provenance are retained. Missing or conflicting Wikidata labels do not lower a verified TMDB/IMDb identity; they create a name or biography review issue.

### Existing Notion and Chinese metadata

Existing directors/cast fields are useful Chinese-name observations after the target person has been matched through stable identity and work context. They are not sufficient to create an automatic cross-work merge by themselves.

### Generated values

LLM translations, summaries, and transliterations are suggestions. They must be labeled `provisional`, retain their generation source, and remain outside the verified-name selection path until reviewed.

## Enrichment Pipeline

1. Read the current local/search-index work snapshot; do not rescan every Notion page merely to discover candidates.
2. Select works that have a TMDB ID and missing or stale structured credits.
3. Fetch and cache TMDB work credits.
4. Upsert candidate people by stable external IDs.
5. Fetch person details/external IDs only once per unique person and cache raw responses.
6. Attach person IDs to work credits while preserving department, job, character, and order.
7. Fetch narrowly scoped IMDb/Wikidata evidence for unresolved names or identity cross-checks.
8. Apply manual Notion People overrides without discarding lower-priority observations.
9. Build the person catalog, alias indexes, work-credit indexes, and issue queues locally.
10. In apply mode, upsert only changed People rows and publish the derived runtime snapshot.
11. Read back a sample of Notion rows, person API responses, person pages, and work pages.
12. Rerun the same batch and require an idempotent no-change result.

Every provider uses one shared in-process limiter for all reads and writes to that provider, while the people-sync lease prevents multiple runner processes or container instances from operating concurrently. Notion defaults to concurrency 1 and no more than one request per second. Batches persist cursors, raw response cache keys, completed person IDs, failed items, retry-after timestamps, and input hashes after every item through an atomic temp-file/rename or conditional store update.

On HTTP 429, the pipeline stops launching requests, honors `Retry-After`, adds jitter, and prevents parallel retries. After three consecutive 429 responses for the same provider window, it exits with completed and remaining counts rather than continuing an uncontrolled retry storm.

Default cache freshness is 30 days for TMDB work credits/person details, 30 days for IMDb evidence, and 90 days for Wikidata labels/statements. Explicit refresh, provider record change markers, or an adapter `evidenceSchemaVersion` change invalidates the relevant cache. These are operational defaults, not identity evidence.

Every external upsert compares the current row before writing and uses immutable `Person ID` plus guarded external-ID indexes. If a write succeeds and the runner crashes before its checkpoint, replay retrieves the row, observes the desired managed values, records success, and does not create a duplicate.

## Incremental Sync

A work is reprocessed when any of these values changes:

- TMDB/IMDb title identity
- source work last-edited time
- structured credits hash
- enrichment schema version
- provider evidence version or explicit refresh request

A person is reprocessed when:

- a new external ID is linked
- a new work credit is observed
- a Notion People row changes
- the person record is stale under the configured refresh window
- an issue is manually marked for re-evaluation

Removing a credit from a work removes only that relationship after a machine-verifiable complete scan: the provider/work enumeration reached its terminal cursor, reported expected page/item totals agree with processed totals, every in-scope work has a success or explicit retained-error disposition, and the generation has no unhandled fetch/parse errors. It does not delete the person. A person with zero WWP works may remain hidden/tombstoned so old links and merge history continue to resolve.

## API Design

Version 1 adds:

- `GET /api/people/:personId` — public visible profile plus WWP works grouped by department.
- `GET /api/people?q=<query>&limit=<n>` — person search for autocomplete and discovery.
- `GET /api/browse-assets?...&personId=<id>` — existing browse endpoint filtered by exact person identity.
- `GET /api/admin/people/issues` — conflict and provisional-name queue.

Public responses omit hidden people and unpublished works. Name queries may return ambiguous candidates; exact filtering always uses `personId`. Admin issue routes require the existing admin authentication and authorization checks.

## Website Design

### Minimum useful release

- Director, writer, and cast names become person links when a visible person record exists. A hidden, unresolved, or unavailable person remains plain text rather than linking to a hidden/404 route.
- Selecting a person opens a person detail route.
- The person page shows preferred names, aliases where useful, a short sourced biography, primary departments, and only WWP-catalog works by default.
- Works are grouped by directing, writing, acting, and other departments, with character/job labels where useful.
- Search recognizes aliases but shows disambiguating context such as profession and representative WWP works.
- Browse state can be shared/bookmarked through a stable person route or `personId` query parameter.

Legacy credits without a `personId` remain plain text and continue to participate in ordinary full-text search during migration.

### Deferred experience

- Complete external filmography, clearly separated from available WWP works.
- Collaboration graph and frequent collaborators.
- Popular people, recently added people, and department-specific discovery shelves.
- Episode-level series credit views.

## Migration Strategy

### Phase 0: Baseline and fixtures

- Freeze a read-only baseline report from the current search index.
- Record work counts, TMDB/IMDb coverage, structured-credit coverage, and parsed legacy-name coverage.
- Create identity fixtures covering Chinese, Hong Kong/Taiwan variants, Japanese/Korean native scripts, Latin diacritics, stage names, homonyms, multi-role credits, and series credits.

### Phase 1: Runtime types and pure resolution

- Add person types, name-selection functions, normalization, identity matching, merge/split issue types, and pure tests.
- Change credit external IDs to the person-specific type.
- Keep serialization backward-compatible with current cached records.

### Phase 2: Local person catalog prototype

- Build a person catalog from cached/local work results and mocked or cached provider payloads.
- Add dry-run reports without Notion writes.
- Pilot approximately 20 deliberately diverse works and inspect every generated person and credit.

### Phase 3: People data source and enrichment tool

- Add schema inspection/migration tooling for the Notion People data source.
- Add resumable provider caching and People upsert tooling.
- Apply in bounded batches: pilot, 100 works, then the remainder.
- Require direct readback and an idempotent rerun after every apply batch.

### Phase 4: Runtime/API integration

- Add local and Azure person-catalog stores.
- Stage work and person snapshots under the same generation ID, validate cross-references, then atomically switch one manifest pointer. A failure keeps both previous snapshots active; rollback switches the pair together.
- Add public person lookup/search/filter routes and admin issue reporting.

### Phase 5: Website integration

- Link structured credits.
- Add person detail and person-filtered browse states.
- Add alias-aware person search with disambiguation.
- Verify desktop, mobile, direct links, back navigation, loading, empty, hidden, and error states.

### Phase 6: Full backfill and operations

- Backfill remaining eligible works in resumable batches.
- Review conflicts and high-value provisional Chinese names.
- Document routine incremental sync, repair, merge, split, and rollback procedures.
- Add the people lane to metadata-completeness and film-workflow handoff only after the pipeline is stable.

## Testing Strategy

### Unit tests

- External-ID normalization and uniqueness.
- Unicode and alias normalization without destructive stored-value changes.
- Chinese/English/original display-name precedence.
- Traditional/simplified search aliases.
- Homonyms remain separate.
- Shared stable IDs merge safely.
- Conflicting stable IDs create issues.
- Multi-role and multi-character credits survive deduplication.
- Manual overrides remain authoritative.

### Store and migration tests

- Person catalog local persistence and schema versioning.
- External-ID and alias indexes.
- Merge redirects and split repairs.
- Backward-compatible loading of work credits without person IDs.
- Idempotent rebuilds produce stable output.

### API and UI tests

- Visible/hidden person responses.
- Person-filtered browse returns only exact linked works.
- Ambiguous alias search returns multiple candidates.
- Legacy text credits remain non-clickable and do not break cards.
- Person route, navigation, mobile layout, empty works, and grouped departments.

### Live acceptance

- Sample people are checked against exact Notion People rows and external IDs.
- Chinese and English names show the selected provenance-backed values.
- Clicking a credit reaches the correct person, including homonym fixtures.
- Every displayed WWP work contains a matching credit relation.
- A removed credit disappears after full confirmed sync without deleting the person.
- A second unchanged sync produces zero writes.

## Rollback

- Website person links remain feature-flagged until catalog and routes are deployed.
- Legacy director/cast strings remain available throughout Version 1.
- People schema creation is additive and does not alter work/media databases.
- Runtime person snapshots are versioned; the previous snapshot remains readable during deployment rollback.
- Work/person snapshots share a generation manifest and roll forward/back as a pair.
- Apply tools write before/after reports and never delete person rows automatically. A guarded restore mode may restore only AI-managed fields from a before-image when their current value still equals the bad write; it never overwrites locked/manual fields or changes identity without an explicit merge/split repair.
- Conflicting merges are repaired through redirects/splits, not destructive history removal.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Name-only false merge | Stable IDs required for automatic merge |
| Wrong Chinese translation | Provenance/status model; generated names stay provisional |
| TMDB/IMDb/Wikidata disagreement | Preserve all observations and create an explicit conflict issue |
| Notion request explosion | One People row per person; no Credits database in V1; bounded cached batches |
| Provider terms or image restrictions | Attribution, source tracking, no IMDb prose/image copying, review commercial use |
| Partial migration breaks UI | Legacy string fallback remains supported |
| Person data becomes stale | Hash/version-driven incremental refresh and explicit provider cache windows |
| Existing dirty worktree causes overlap | Implement people work in isolated commits after current credits/UI changes are reconciled |

## Success Criteria

- At least 95% of credits selected for the first production scope have a stable `personId` or an explicit unresolved issue.
- Zero automatic merges are performed from name equality alone.
- Every public formal Chinese name is `verified` or `strong`; provisional generated names are not presented as authoritative.
- Person lookup, alias search, exact person filtering, and person pages work on desktop and mobile.
- Existing work search, browse, playback, and legacy credit display regressions remain at zero.
- Full and incremental syncs are resumable and idempotent and respect provider rate limits.
- Production acceptance includes exact Notion, runtime API, and rendered website readback rather than source-code completion alone.

## Decisions Revisited After the First Pilot

- Whether the default `strong` publication rule needs to be tightened to editor approval.
- Whether the initial top-20 cast and key-crew scope should be narrowed before expansion.
- Whether profile images should be cached durably or referenced from an attributed provider.
- Whether selected external filmography belongs on the public person page.
- Whether editors need a Notion `Credits` database after using the derived relationship model.
