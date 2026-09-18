---
name: wwp-work-enricher
description: Coordinate WWP work-level enrichment after or apart from playable production, sequencing base metadata, key People coverage, verified honors, and editorial highlights without running those network lanes concurrently.
---

# WWP Work Enricher

Own the complete work-level enrichment sequence:

1. base metadata through `wwp-metadata-backfiller`;
2. key creator and principal cast coverage through `wwp-people-curator`;
3. award and festival facts through `wwp-honors-curator`;
4. editorial highlights through `wwp-highlight-curator`.

Run these stages serially under the shared WWP production network lock. Do not
start a separate People, honors, or highlight task beside film production.

Use `apps/api/src/work-enrichment.ts` as the state contract. Record each stage
separately; playable completion, base metadata completion, and enrichment
completion are different outcomes. Missing optional enrichment never retracts
an already verified playable release.

Save each bounded batch as `{ "works": [...] }`, then run
`npx tsx tools/work-enrichment-audit.ts --input <batch.json> --json`. Its report
must retain every blocked work's exact missing fields and next action, plus a
separate list of human-confirmation reasons. “No ready work” is not a complete
report while either list is non-empty.

Persist the execution queue with `tools/work-enrichment-campaign.mjs`:

Before People authorization, reconcile stable identities against the Notion
checkpoint as well as Azure. If duplicate legacy Notion pages exist for one
person, select one canonical existing page, reuse that identity, preserve the
duplicate page IDs as evidence, and write a `canonicalization` artifact. Do
not let successive retries remap the same report between legacy pages or create
a third person page; rerun preflight on the canonicalized report.

- The default film cycle automatically enqueues exact current work IDs. It must
  not reset stages already completed in an earlier round.
- A historical People coverage audit is also an intake source for this
  campaign. When a saved authoritative coverage report contains
  `missing_credits`, `unlinked_only`, or `partially_linked` works, reconcile
  each candidate by its exact `ww_work_id`/page ID and enqueue it with source
  `historical_people_coverage` before reporting the People lane. A coverage
  candidate that is absent from the campaign must never be silently omitted
  just because it was discovered outside the current film batch. If its work
  identity cannot be reconciled uniquely, keep it in the audit's human/identity
  blocker list instead of inventing an ID.
- Use `node tools/work-enrichment-campaign.mjs enqueue-coverage --coverage
  <coverage.json> --limit <n> --json` to persist a bounded handoff from a saved
  authoritative coverage report. The command accepts only incomplete candidates
  with an exact work ID, canonical page ID, and title; malformed or ambiguous
  candidates remain in the report for identity review.
- For an explicit historical batch, run
  `node tools/work-enrichment-campaign.mjs enqueue --input <batch.json> --source historical_backfill --json`.
- Resume without scanning film inputs with
  `node tools/film-workflow-cycle.mjs --mode enrichment-only --json`.
- Before executing a due stage, record `in_progress`. After the real stage and
  required readback, record `completed`; otherwise record `blocked`,
  `waiting_user`, or `deferred` with exact reasons, missing fields, and a review
  time when one exists. Never leave an attempted stage as an unexplained
  `in_progress` item. The cycle automatically recovers an `in_progress` stage
  with no new record for six hours to `deferred`, preserving its old reason and
  setting a one-hour review time plus a concrete resume trigger. This is claim
  recovery, not completion evidence.
- Treat every external worker as a resumable run, not as a permanent state:
  before claiming `in_progress`, save the report/preflight/checkpoint paths and
  owner-process evidence in the batch directory. If the process exits, times
  out, or is terminated before a verified result is written, immediately
  record `deferred` for a transient provider/transport failure or `blocked` for
  an identity, permission, data, or integrity failure. Include the exact error,
  preserved artifacts, and the next trigger. Do not leave Notion
  `Workflow Status=AI处理中` as the only evidence that work is active.
- If the authoritative People coverage readback cannot be established because
  the report uses the wrong backend, the provider is unavailable, or the
  canonical index is temporarily unreadable, immediately record the People
  stage as `deferred` with the exact error, a review time, and a concrete
  Azure-readback trigger. Do not turn this transport/backend problem into a
  durable identity blocker. Malformed counts, ambiguous identities,
  permission failures, and contradictory IDs remain fail-closed blockers and
  must retain their exact evidence.
- For Azure People catalog/index writes, use independently reviewable
  sub-batches of at most 20 profiles and prefer 10-16 once the catalog is
  large. A timeout is a batch failure, not a reason to repeat the full batch:
  preserve the backup, verify rollback/readback, split the same reviewed
  report, then apply and verify one sub-batch before starting the next.
  `tools/person-catalog-apply.mjs` writes `catalog-apply-run.json` in the
  batch directory. Treat `status=failed_resumable` as an interrupted apply,
  not as completion; inspect its error and retry the same reviewed report or
  split it before selecting new identities. An apply that leaves the
  authoritative residual-credit count unchanged and writes no catalog/index
  change must fail with a no-progress error, so a clean-looking no-op cannot
  advance the campaign cursor. A
  batch is not `completed` until Notion Person IDs, catalog relations, search
  index relations, convergence, and replay all pass.
- When a reviewed stable identity has a historical credit spelling already
  present in the work's source credit set, put that spelling in the targeted
  supplement credit's explicit `legacyAliases` list. Treat aliases as
  evidence-backed identity data, not fuzzy matching: validate the alias
  against the same IMDb/TMDB/Wikidata person and work-credit source, then let
  the apply step merge it into the existing credit row. Never repair a
  duplicate by manually editing the catalog or guessing from a similar name.
  If the alias cannot be verified, leave the credit unresolved and record the
  exact source and next action.
- A source may expose the same person with a generic job (`Actor`) while IMDb
  or another reviewed source exposes a role description (`Self - Narrator`,
  `Director of Photography`, and similar). The reviewed stable person ID is
  stronger than the display job: when department and name/alias evidence agree,
  bind the existing unlinked credit instead of appending a second credit row.
  If an earlier run already appended duplicates, use a guarded complete-credit
  replacement with the exact asset key, source credit count, linked-person set,
  work identity, and an authoritative IMDb/TMDB/Wikidata work-credit source;
  never delete rows by name alone.
- An empty Wikidata credit result is a source miss, not a completed People stage.
  Preserve the residual source credits, then try the bounded fallback order:
  IMDb title/fullcredits plus stable name IDs, TMDb credits when the work ID is
  verified, then a second independent source or explicit human identity
  evidence. IMDb suggestion results may discover candidates, but publication
  requires the matching official name page and work-credit page. Do not create
  a profile or settle coverage from a name-only search result.
- Record mutations with the campaign item's exact `--item-key`. Historical
  carrier pages can share a stale external work ID with a canonical item;
  non-key selectors must fail when they match more than one item rather than
  updating the first match.

`enrichmentCampaign.due` is an execution handoff, not a planning result. Consume
the bounded due items through the named skills in sequence. If no item is due,
report `waitingForHuman`, `blocked`, and `scheduledReviews` before saying the
campaign is idle.

For the People stage, an explicit user request to fill missing people or
continue People work is batch-level write authorization after a clean person
report preflight. Keep `ready_for_authorized_apply` work actionable. Do not
convert it to `waiting_user`; reserve that state for named identity ambiguity or
another concrete human decision. A large count of clean reports awaiting the
same redundant confirmation is a routing defect, not a valid Goal blocker.

If exact post-publish coverage returns `creditCount=0`, treat it as an
incomplete or stale canonical-index readback, not as People completion and not
as a permanently actionable loop. Record the missing `canonical people
credits`, retain the source/readback evidence, and defer the stage to a bounded
retry (normally six hours) with a trigger to reread the canonical source and
create a bounded supplement. If the next readback still has no authoritative
credits, keep the item deferred or escalate a concrete provider/data blocker;
do not leave it in `AI处理中` or repeatedly consume every normal cycle.

People completeness means the key creators and significant cast in the
canonical source-credit set are verified. It does not require materializing
every minor cast credit, but every remaining significant unlinked credit must
be individually deferred with evidence and a next trigger; an exhausted
Wikidata result or a completed profile-budget batch is not completion evidence.
Honors completeness is either `verified` or the explicit
`checked_none_found`; an empty unchecked field is not completion.

Only route a work to highlights when its assessment is `ready`. Report
`blocked_metadata`, `blocked_people`, or `blocked_honors` with the exact missing
facts instead of generating generic prose.
