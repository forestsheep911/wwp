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

- The default film cycle automatically enqueues exact current work IDs. It must
  not reset stages already completed in an earlier round.
- For an explicit historical batch, run
  `node tools/work-enrichment-campaign.mjs enqueue --input <batch.json> --source historical_backfill --json`.
- Resume without scanning film inputs with
  `node tools/film-workflow-cycle.mjs --mode enrichment-only --json`.
- Before executing a due stage, record `in_progress`. After the real stage and
  required readback, record `completed`; otherwise record `blocked`,
  `waiting_user`, or `deferred` with exact reasons, missing fields, and a review
  time when one exists. Never leave an attempted stage as an unexplained
  `in_progress` item.

`enrichmentCampaign.due` is an execution handoff, not a planning result. Consume
the bounded due items through the named skills in sequence. If no item is due,
report `waitingForHuman`, `blocked`, and `scheduledReviews` before saying the
campaign is idle.

People completeness means the key creators needed for the current work's
editorial claims are verified. It does not require materializing every minor
cast credit. Honors completeness is either `verified` or the explicit
`checked_none_found`; an empty unchecked field is not completion.

Only route a work to highlights when its assessment is `ready`. Report
`blocked_metadata`, `blocked_people`, or `blocked_honors` with the exact missing
facts instead of generating generic prose.
