# WWP People Curator command map

Run commands from the repository root. Replace angle-bracket placeholders and keep all files for one run under `.local-data/people/<batch-slug>/`.

Before selecting the next work, reconcile the newest bounded local
`preflight*.json` and `post-publish-coverage*.json` artifacts with the saved
campaign state. A `ready_for_authorized_apply` preflight with no human-review
items or identity conflicts is actionable under an explicit People objective,
even if an older campaign row says `waiting_user`. Keep identity,
canonical-index, and timeout failures as explicit blockers with a next
trigger; settle a fully linked post-publish report before leaving the queue.
Do not perform a live full-library scan for this reconciliation.

## Resume saved work before researching again

At the beginning of every People run, build a bounded inventory of saved
artifacts under `.local-data/people/`. Pair each latest report with its
preflight, Notion checkpoint, and catalog-apply result using the report path
and stable work/page IDs. Reconcile those IDs against the campaign entry
before doing any provider or Wikidata request.

- A complete `ready_for_authorized_apply` preflight with zero identity issues,
  zero unresolved rows, and a matching reviewed report is the next action. It
  may resume the same guarded apply even when the campaign stage is
  `pending`, `deferred`, or a recoverable transient `blocked` state.
- A saved successful Notion checkpoint with a missing or failed catalog apply
  resumes the catalog apply/replay lane; it must not recreate People pages or
  rerun discovery.
- A `failed_resumable` apply resumes from its unchanged report and the last
  verified sub-batch. Never rerun the whole report blindly after a timeout.
- A report/preflight pair with a stable identity conflict, human-review gate,
  missing work evidence, or mismatched work/page ID remains `blocked` or
  `waiting_user`; do not auto-authorize it merely because the preflight file
  exists.
- If a saved artifact is malformed or incomplete but its upstream report and
  stable IDs remain available, rebuild only the missing derived artifact and
  continue the same batch. Record the repair before the next provider call.

The resume inventory is part of queue calculation. A run must report counts
for `resumable_apply`, `resumable_catalog_replay`, `artifact_repair`, and
`needs_human_or_identity_review` separately. A non-empty resumable count is
actionable work even when the Notion Workflow Status and filesystem are
unchanged.

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

Always keep the `node --import tsx` launcher. The audit imports TypeScript
modules from the API package; a bare `node tools/people-work-coverage-audit.mjs`
can fail under newer Node versions with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
Classify that as a launcher error, retry with the command above, and do not
record it as a people-data or provider blocker.

Give this Azure read a finite operational window. If it stalls, interrupt only
the audit, retain the completed batch artifacts, record the timeout, and resume
from the last cached candidate list; do not rerun completed writes.

Prioritize `missing_credits` works that already have a stable external work ID,
then `unlinked_only`, then `partially_linked`. The audit is a queue, not proof
that a person identity is correct. Refresh it after each published umbrella
batch instead of rescanning providers for already completed works.

The coverage ordering chooses the next work only when no People work is already
pinned. Once selected, persist that work as `activePeopleWorkId` and scope both
ordinary repair and new-person expansion to it across as many bounded passes as
needed. Do not let a refreshed audit or global P2 repair queue move a partially
completed active work behind unrelated candidates. The work pin is cleared only
by a recorded coverage-and-quality closure or a recorded blocker with all
remaining important credits and repair-due profiles accounted for.

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
When a canonical series or season has a TMDB series ID and a parsed season
number, the TMDB season credits endpoint is an allowed fallback. Cache it using
both the series ID and season number. If no season-scoped source or credential
is available, record a provider-lane blocker with its next trigger, then route
any work/person IDs already present in the local catalog or cached evidence
through the bounded Wikidata pilot. Do not treat missing TMDB credentials as
proof that credits are absent, and do not freeze unrelated film or metadata
work while this lane waits. Never treat the absence of a parent-level response
as evidence that the season has no credits.

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
identities, not only `athlete` as a generic term. An acting credit explicitly marked as `Self`, `Media`,
`Newsreader`, `Host`, or equivalent本人出镜 is a distinct cast relation: verify it with the exact work credit
and a stable person crosswalk, preserve that job label, and do not reject it merely because the person's main
occupation is journalism, presenting, or another non-film profession.

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
node --import tsx tools/notion-index-refresh.mjs --backend azure --page-id <page-id> --title <title>
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

For a significant canonical credit omitted by the work-level provider, prepare
a small JSON input with the exact work identity and 1-20 reviewed credit rows,
then run:

```powershell
node --import tsx tools/person-targeted-supplement.mjs --input .local-data/people/<batch-slug>/targeted-supplement-input.json --output .local-data/people/<batch-slug>/targeted-supplement-report.json --reviewed-output .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/targeted-supplement --backend azure
```

When `identityIssues` and `unresolved` are both empty, the command writes the
same audited report to `reviewed-output`; that file then enters the normal
preflight, Notion upsert, catalog apply, and coverage-settlement path. A report
with either category non-empty is never promoted automatically.

Each row normally uses a verified Wikidata QID; include matching IMDb/TMDB IDs
when available. If no Wikidata identity exists, a row may instead carry
reviewed IMDb or TMDB evidence. It must repeat the stable person ID in
`reviewedEvidence`, cite that exact person page, provide the same provider's
work ID in `sourceWorkExternalIds`, and include an HTTPS `workCreditUrl` proving
the credit on that work. This route may create a deliberately partial profile,
but it must not infer biography, dates, images, alternate names, jobs, or
characters from a name match. Conflicting canonical names or roles stay
unresolved or are stored only as explicitly reviewed alternates. The tool
reuses an existing catalog identity through stable IDs and emits a normal
report subject to every usual review and publication gate. Never use it to
force a name-only match.

`profile-budget` limits only the number of candidate identities materialized and reviewed in that discovery pass. It is not a cap on stored credits, important cast, linked people, or eventual profiles for the work. Preserve the complete work-credit evidence and run another reviewed pass when significant unresolved people remain.

Before closing the work, compare the materialized links with the complete
canonical source-credit set captured from IMDb, TMDB, verified Notion metadata,
or another authoritative source. Wikidata may omit valid credited people even
when its own result is exhausted. Every significant source-only credit must
therefore become either a stable linked person in a reviewed supplement batch
or an explicit per-credit deferral with the evidence gap and next trigger.
Record total canonical credits, linked credits, distinct materialized people,
missing profiles, remaining deferred credits, and replay results in
`work-coverage.json`; a discovery budget or successful first batch is not a
completion signal.

If the active work needs more profiles than the current repair/expansion quotas
or publishable sub-batch limit, checkpoint its remaining important credits and
actionable linked-profile repairs, then resume that same work in the next
cycle. Do not use leftover convenience to sample people from unrelated works.
Only after the active work is closed may capacity move to the next work.

The network budget is approximately one work-credit request plus up to `profile-budget` person requests when the cache is cold. Additional biography-source checks are outside this number. Run works sequentially.

An evidence-only fallback report is not a publishable People report. Reports from a Wikidata fallback, browser observation, or other source probe must first be converted into the formal report shape with `proposedProfiles`, explicit `identityIssues`, and `unresolved` arrays. Run the normal preflight and require `profileCount > 0`, zero identity issues, zero unresolved entries, and a fresh readback checkpoint before apply. A fallback report with only `rows`, source evidence, or `evidence_ready` labels must never be counted as completed metadata or sent directly to Notion.

For an explicitly requested large observation batch, keep one umbrella directory but create independently reviewable/publishable sub-batches of no more than 20 people. For Azure production applies, prefer 10-16 profiles per sub-batch once the catalog is large. If Azure Table `OperationTimedOut` occurs during `person-catalog-apply`, retain the generated backup, verify that the search index was rolled back, and retry the same reviewed report in a smaller sub-batch; never blindly rerun the original apply. Apply and verify one sub-batch before advancing to the next. Every auxiliary biography/source collector must use a 20-second request timeout, at most one jittered retry, and a response checkpoint.

## Compose a curated batch

For whole clean reports, generate the repetitive config fields instead of
copying Person IDs manually:

```powershell
node --import tsx tools/person-batch-config.mjs --report <reviewed-a.json> --report <reviewed-b.json> --output .local-data/people/<batch-slug>/batch-config.json
```

The generator rejects identity issues, unresolved credits, empty reports,
duplicate Person IDs, and more than 20 input profiles. It does not replace the
composer or catalog preflight.

For a supplement selected from a larger discovery report, generate the config
instead of hand-writing JSON. Repeat `--select-person-id` for the reviewed
people, inherit published bindings with `--keep-linked-from-report
<prior-reviewed-report.json>`, and repeat `--keep-linked-person-id` only for an
independently verified catalog identity absent from that prior report. Use
`--credit-name-override <external-id>=<canonical-name>` for an exact stable
identity whose credit name needs correction. Subset mode permits unresolved
discovery credits because unselected identities intentionally remain for later
passes.

If a selected batch has already been researched but its config, composed
report, reviewed report, or preflight file is missing or invalid, regenerate
that local artifact from the last valid upstream report and continue the same
pinned work. This is `ai_action_pending`, not `blocked` or `waiting_user`.
Preserve the selected stable IDs and prior publication checkpoint so a restart
cannot choose a different batch merely because an intermediate file was never
written.

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

The composer automatically reuses the first batch Person ID when a later
report describes the same person with at least two identical stable external
IDs and no contrary provider ID. It merges departments, names, images,
biography texts, and source references, and rewrites every affected work credit
to the canonical batch ID. A one-ID match or split ownership remains an
identity issue and blocks publication.

Incremental batches retain every discovered profile as credit-identity evidence,
even when only a reviewed subset is materialized. The catalog apply uses those
stable IDs and aliases to merge deferred credits into existing work rows without
publishing the deferred profiles. If the canonical work uses a translated name
that is absent from provider aliases, add an explicit `creditNameOverrides`
entry keyed by stable external identity; do not use broad fuzzy person-name
matching to force a merge.

If the correction is discovered after an initial batch has already been
published, patch the original complete reviewed report and rerun the complete
authorized path. Do not apply a one-person subset against the same work: that
can replace the work's merged credit list with a partial list. The repaired
report must carry the stable external ID and canonical `personId` (or the
explicit `creditNameOverrides` mapping), pass preflight again, and finish with
an authoritative work-coverage readback.

## Apply editorial review

Prepare `biography-reviews.json` with the reviewed bilingual text, source references, statuses, methods, and any credit-name corrections expected by the existing review tool. Compare each entry against the corresponding composed profile before running:

The prose must be person-centred and independent of the current WWP holdings.
Reject a review that reads like a credit audit, mentions database verification,
lists only the selected discovery works, or uses vague award filler instead of
specific facts. Build a factual brief first: career stages, important
collaborations, representative works, contribution or style, and precise awards
when well supported. Use the source/status fields for provenance.

For `verified`, require at least 100 non-whitespace Chinese characters and 45
English words. These are minimum evidence floors, not writing targets: do not
pad a weak record with generic prose. The quality gate rejects the known
Wikidata/credit templates (`公开人物资料来自 Wikidata`, `documented in Wikidata`,
`is credited as`) and obvious machine grammar such as `is a actor`. A report
whose profile claims `Data Status=verified` but lacks verified bilingual
editorial biographies is rejected by both the Notion upsert and catalog apply
entry points.

When an existing Notion row already has a verified `editorial-rewrite`
biography, an incoming weak or provider-summary biography must not replace it,
even when the field is unlocked. A replacement is eligible only when it passes
the same multi-source, method, template, and substantive-length gates. Work
discovery may add departments and credits without rewriting the person's prose.
When a merged report carries multiple same-language observations, evaluate
each candidate against those gates before status ordering. Do not let an older
short Notion observation marked `verified` hide a later substantive reviewed
observation with the same status.

The Notion checkpoint is authoritative for the active page binding both when
an existing catalog identity is merged and when the reviewed person was just
created in Notion. A newly created person is expected to be absent from Azure
until the subsequent catalog apply; initialize it from the reviewed profile,
bind the checkpoint page, and then rebuild the derived identity indexes. Do not
misclassify that normal first-publication state as a missing-profile defect.

Review files are cumulative across revisions. Before rerunning a batch, merge
the prior `biography-reviews.json` and all later review revisions by stable
`personId`, then pass the complete effective set to the review tool. A
new-entries-only file is invalid because the tool rebuilds the report and can
erase previously verified biographies. Compare the new report with the prior
report and stop on any unexpected decrease in verified/partial profile counts
or linked/unresolved credit counts; repair the review input before changing
the batch state.

```powershell
node --import tsx tools/person-biography-review.mjs --report .local-data/people/<batch-slug>/composed-report.json --reviews .local-data/people/<batch-slug>/biography-reviews.json --output .local-data/people/<batch-slug>/reviewed-report.json
```

Inspect `identityIssues`, `unresolved`, every `proposedProfile`, and every `proposedCredit` in the output. Resolve identity issues before applying.

## Focused validation

```powershell
node --test --import tsx apps/api/src/person-quality-score.test.ts apps/api/src/people-repair-audit.test.ts apps/api/src/notion-people-schema.test.ts apps/api/src/notion-people-source.test.ts apps/api/src/person-biography-review.test.ts apps/api/src/person-biography-quality.test.ts apps/api/src/person-enrichment.test.ts apps/api/src/person-catalog-apply.test.ts apps/api/src/person-materialization.test.ts apps/api/src/person-service.test.ts apps/api/src/person-notion-sync.test.ts apps/api/src/person-sources/provider-http.test.ts apps/api/src/person-sources/wikidata.test.ts apps/api/src/person-sources/wikidata-work.test.ts apps/api/src/person-sources/tmdb.test.ts apps/api/src/person-sources/imdb.test.ts
npm run typecheck --workspace @wwpdw/api
git diff --check
```

After changing biography rules, first run a five-person quality pilot. Include
different professions and at least one previously regressed existing profile.
Require 3–4 useful source URLs per person across at least two independent
families, zero identity conflicts, exact Notion readback, targeted
Notion-to-Azure convergence, and an unchanged targeted replay before resuming a
larger campaign.

## Preview and apply Notion

First run the local report preflight against the same catalog backend that
produced the report. A credit carrying a `personId` is not considered linked
unless that ID exists in the current catalog or in the report's
`proposedProfiles`; dangling IDs block the batch.

```powershell
node --import tsx tools/person-report-preflight.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --backend azure --output .local-data/people/<batch-slug>/person-preflight.json
```

`ready_for_authorized_apply` may proceed when the current user request
explicitly asks to add/fill people or continue the People workflow. Do not turn
that clean result into `waiting_user` merely to request another blanket review.
`waiting_user` is reserved for exact ambiguous identities listed by the
preflight. Ordinary `credit_identity_not_materialized` rows remain visible for
later passes but do not block clean profiles. A `blocked` result must be repaired
or regenerated before any Notion or catalog apply. The preflight catalog backend
must match the report's backend; do not compare an Azure report with a stale
local catalog snapshot.

For a mixed report, select the verified profiles in a curation config and use
`person-batch-compose.mjs` to create a clean sub-batch. Publish and converge that
sub-batch immediately. Then record the work-level People stage as `pending`, or
as `deferred` only when a concrete future review time exists, with the exact
remaining names/credits and next trigger. A successful sub-batch is progress,
not work-level completion; a deferred credit is a local item condition, not a
reason to mark the complete production Goal blocked.

For a metadata-only work whose complete credit set exceeds the 20-profile
publication limit, publish earlier profile chunks with
`person-batch-config.mjs --profiles-only`. The composed report intentionally has
no `proposedCredits`, so it can materialize verified profiles without claiming
incomplete work coverage. After those profiles exist in the production catalog,
rerun discovery for the remaining identities and publish one final guarded
metadata-only report containing the complete linked credit set.

Use the coverage-driven settlement command instead of manually guessing the
stage status:

```powershell
node tools/work-enrichment-campaign.mjs settle-people-coverage --item-key <work-key> --coverage .local-data/people/<batch-slug>/post-publish-coverage.json --json
```

For production, generate the coverage file with
`people-work-coverage-audit.mjs --backend azure`; settlement rejects local or
backend-unknown coverage. A local report may be settled only for an explicit
local test by adding `--allow-local-coverage`.

The command completes People only for a non-empty `fully_linked` canonical
credit set. Partial, unlinked, or still-missing credit coverage returns the
stage to actionable `pending` with exact linked/total/residual counts. Invalid
or mismatched reports fail closed and must not leave an inferred completion.
Use the report's complete `works` array as the settlement authority whenever it
exists. The smaller `candidates` array is designed to contain only incomplete
works, so a work disappears from it precisely when it becomes fully linked.
Treating that disappearance as `candidate not found` would strand a completed
work in `in_progress`; use `candidates` only for older report formats that do not
contain `works`.

Immediately before generating this final coverage report, reconcile canonical
credits after Notion sync. Match alternate or translated names only when a
reviewed profile or the existing production catalog supplies the alias and the
stable identity is unambiguous. Prefer an unlinked matching source row over a
row that already has the same `personId`, then collapse exact duplicate
relations only when canonical person, department, compatible job, and character
all agree. Never collapse a person's distinct departments, voice/acting roles,
or different characters merely because the names resolve to one identity.

Settlement also stores a deterministic fingerprint and attempt count for the
exact unresolved credit set. If two authoritative passes return the same
non-empty residual set without new stable identity evidence, the work-local
People stage is automatically changed to `blocked`, with the exact residual
names and `nextTrigger=new provider evidence or manual identity confirmation`.
The block does not stop unrelated works. A changed residual fingerprint or new
provider/manual evidence resets the count and allows a fresh bounded pass.

Do not let one unresolved person become an endless ordinary queue item. Once
two bounded research passes have covered different source families and still
cannot establish a stable external person ID, write the coverage row as an
explicit `blocked` identity residual. Include the exact name and department,
the source families already checked, and
`nextTrigger=new provider evidence or manual identity confirmation`. The
campaign keeps that credit visible and leaves the work open, but the blocked
identity must not prevent unrelated works or other People lanes from running.
Only new evidence may reopen it; do not repeat the same search set on every
cycle.

The coverage report is also a shape check. If one unlinked row is a combined
director label or a long slash-separated cast list, mark it as a
`credit_shape_error` and stop targeted person creation for that row. Repair the
canonical credit list into one person/role per row from stable IDs and exact
source evidence first. A composite row must remain a measured residual in
`work-coverage.json`; it is not evidence that one giant Person profile should be
created, and it must not be retried unchanged in the next cycle.

When a historical campaign item is still `waiting_user` only because an older
run requested blanket review, resume that exact item through the guarded
preflight command instead of manually rewriting campaign JSON:

```powershell
node tools/work-enrichment-campaign.mjs authorize-people --item-key <work-key> --preflight .local-data/people/<batch-slug>/person-preflight.json --report .local-data/people/<batch-slug>/reviewed-report.json --json
```

The command accepts only `ready_for_authorized_apply`, requires the preflight to
name the same report, and requires the selected work to be at the People stage.
That allows a newly clean preflight to recover a prior `blocked` or `deferred`
row caused by a stale index/provider failure; it does not override identity
ambiguity because that report cannot reach `ready_for_authorized_apply`.

If the historical reason instead says that a publication or metadata-only
coverage path did not exist, first re-evaluate it against the current tools.
Once an exact post-publish report proves a non-empty canonical credit set is
fully linked in both directions, run `settle-people-coverage` directly. That
authoritative readback supersedes the obsolete capability blocker and clears
its old reason and human-confirmation text; it does not require a new blanket
review. Continue to preserve genuine identity ambiguity as `waiting_user`.

Preview first. The preview reports estimated queries, maximum writes, readbacks, identity issues, and unresolved credits:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --state-dir .local-data/people/<batch-slug>/notion-state
```

Apply only after reviewing the exact report:

```powershell
node --import tsx tools/notion-people-upsert.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --preflight .local-data/people/<batch-slug>/person-preflight.json --identity-conflicts .local-data/people/<batch-slug>/notion-identity-conflicts.json --auto-remap-report .local-data/people/<batch-slug>/notion-remapped-report.json --state-dir .local-data/people/<batch-slug>/notion-state --apply --confirm-authorized-batch
```

The tool first performs a full People identity scan before any write. When an
incoming TMDB, IMDb, or Wikidata ID belongs to another Person ID, it writes the
complete conflict artifact. With `--auto-remap-report`, it automatically adopts
the existing canonical Person ID only when at least two stable IDs agree on one
existing row and no provider ID contradicts it, saves the effective remapped
report, reruns the full identity scan, and then continues the same authorized
batch. Incomplete evidence, one-ID matches, split ownership, and contrary IDs
still block all writes. It uses concurrency 1, a shared 1000 ms limiter,
checkpointed progress, readback, and stop-on-first-failure behavior. If exact
legacy duplicates are found and the report Person ID already has the stronger
canonical row, preview and apply the guarded repair before retrying:

```powershell
node --import tsx tools/notion-people-deduplicate-report.mjs --report .local-data/people/<batch-slug>/reviewed-report.json
node --import tsx tools/notion-people-deduplicate-report.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --apply --confirm-exact-external-id-duplicates
```

For an already saved complete conflict artifact, the standalone repair path is:

```powershell
node --import tsx tools/person-report-remap-existing-identities.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --conflicts .local-data/people/<batch-slug>/notion-identity-conflicts.json --output .local-data/people/<batch-slug>/remapped-report.json
node --import tsx tools/person-report-preflight.mjs --report .local-data/people/<batch-slug>/remapped-report.json --backend azure --output .local-data/people/<batch-slug>/remapped-preflight.json
```

Use this fallback only when resuming an older interrupted batch. Generate a new
preflight for the remapped report before retrying Notion. Never copy IDs out of
the human-readable exception text or remap a one-ID, split-owner,
incomplete-evidence, or contrary-provider match.

The repair requires at least two identical stable external IDs and rejects any
contrary provider ID. On repeated 429 responses, do not immediately rerun;
report progress and resume later from the same state directory.

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
node --import tsx tools/person-catalog-apply.mjs --report .local-data/people/<batch-slug>/remapped-report.json --preflight .local-data/people/<batch-slug>/remapped-preflight.json --notion-checkpoint .local-data/people/<batch-slug>/notion-state/notion-upsert-checkpoint.json --state-dir .local-data/people/<batch-slug>/catalog-state --apply --confirm-authorized-batch
```

`--notion-checkpoint` is the authority for preferring the reviewed Notion
Person IDs over stale catalog IDs. It must cover every proposed profile; the
apply fails otherwise. Its exact page IDs also replace stale Notion source
references inherited from retired catalog identities; this prevents a later
Notion sync from quarantining the newly canonical row as a different-page
conflict. For an independently proven catalog-only duplicate, use
the explicit repeatable `--merge-person <retired>=<canonical>` repair argument.
Compose multiple clean small reports before this step when their combined size
remains within the production batch limit, because Azure catalog reads and
atomic snapshot replacement have a substantial fixed cost.

Only set `SEARCH_INDEX_SNAPSHOT_PATH` when the snapshot is current and known to contain every target work. Otherwise let the Azure store read the complete current index. Use `SEARCH_INDEX_SNAPSHOT_PROGRESS=true` only when progress diagnostics are needed.
Azure Table reads use finite per-attempt timeouts and bounded retries. A timed-out
catalog or search-index read is a resumable publication verification failure;
release the production lock, retain the successful Notion/Azure checkpoint and
backup evidence, and retry the unchanged report later. Do not leave a silent
read holding the People lane indefinitely or reinterpret a replay timeout as a
failed earlier publication.

The production People catalog is a versioned, chunked snapshot. Read only the
generation named by the `current` manifest, using an indexed `PartitionKey` plus
`RowKey` prefix range and ordered chunk reconstruction. Never filter the history
by the non-key `generationId` property and never issue one request per chunk when
the table client supports a range query. Azure Table may still split a large
generation into several service pages because each response is size limited;
allow a bounded whole-read window, preserve the production lock, and expose
page/chunk progress when diagnosing a slow run instead of launching a duplicate
preflight or apply.

A metadata-first work may legitimately be absent from the playable search
index. This must not block People curation. After exact Notion readback, remap
the report to the page's stable `WW Work ID` and add `metadataOnlyWork` with the
exact source page ID and `completeCreditSet: true`. This guarded path requires a
non-empty, fully linked credit set, at least one stable external work ID, zero
unresolved credits, and a `wwm_*` work ID. It writes profiles and catalog reverse
relations but deliberately performs no search-index write. When the work later
enters the playable index, the normal Notion/index refresh must merge those
stable person identities rather than rediscovering them.

Use the guarded converter instead of manually editing the report:

```powershell
node tools/person-report-mark-metadata-only.mjs --report .local-data/people/<batch-slug>/reviewed-report.json --work-id <wwm-id> --source-page-id <notion-page-id> --output .local-data/people/<batch-slug>/metadata-only-report.json
# If the reviewed report still carries a legacy numeric ledger id, add:
# --source-work-id <legacy-ledger-id>
node --import tsx tools/person-report-preflight.mjs --report .local-data/people/<batch-slug>/metadata-only-report.json --backend azure --output .local-data/people/<batch-slug>/metadata-only-preflight.json
```

For a newly created or still-hidden Notion work page, run the Wikidata pilot with
`--title` and the stable `WW Work ID`; do not temporarily unhide the page merely
to make it appear in the playable search index. The authorized catalog apply
must use the metadata-only report and preflight above. In this branch the apply
does not require `--asset-key`, must report `searchIndexWrites: 0`, and must be
followed by the metadata-only coverage audit before settling the People stage.

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
node --import tsx tools/notion-people-sync.mjs --backend azure --dry-run --state-dir .local-data/people/<batch-slug>/sync-preview
node --import tsx tools/notion-people-sync.mjs --backend azure --apply --state-dir .local-data/people/<batch-slug>/sync-apply
node --import tsx tools/notion-people-sync.mjs --backend azure --dry-run --state-dir .local-data/people/<batch-slug>/sync-convergence
```

Require the convergence run to report zero applied changes, quarantined rows, invalid rows, and issues. A healthy established catalog normally reports all scanned rows as unchanged.
The sync report includes `issueDetails`; inspect those exact rows instead of
guessing from `issueCount` or rerunning an unbounded People scan.

The scheduled metadata index job also writes Azure movie rows from Notion. Its
Azure branch must merge and preserve already materialized `personId` credits;
otherwise a later Notion refresh can silently replace a complete reviewed
credit list with the shorter legacy list. If this drift is observed, repair the
affected work from the reviewed report, deploy the metadata-job fix, and rerun
the total/linked credit-count gate before declaring the batch complete.

The refreshed Notion credit list is nevertheless the source baseline for plain,
unlinked credits: stale unlinked index rows must not override corrected Notion
names or roles. Overlay enriched identity fields only onto a current credit with
the same department and compatible job. Keep separate role rows for a person who
both writes and acts in the same work, even when both rows share one `personId`.

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
- 当人物没有 Wikidata QID 时，不应直接判定为无法补录。若 IMDb 或 TMDB 提供稳定人物 ID，且能核验人物页、作品演职员页与作品 ID 的对应关系，可走“reviewed stable-ID supplement”路径；输入必须保存 `reviewedEvidence`、来源 URL、观察时间和作品信用 URL。未达到这组证据要求时才进入待人工确认。

### Transient provider failures

There is one controlled exception to preserving a reported `blocked` status: a
reason that is clearly a transient provider failure (timeout, HTTP 429/rate
limit, network or connection failure, or temporary API unavailability) is
converted to `deferred`. Use the provider retry time when available, otherwise
schedule the next review six hours after settlement. Preserve the exact reason,
residual credits, and next trigger. This is an automatic retry schedule, not a
human approval gate; durable identity or evidence defects remain `blocked` or
`waiting_user`.
