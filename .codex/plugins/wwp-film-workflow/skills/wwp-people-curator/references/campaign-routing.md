# WWP People campaign routing

Use this reference whenever a people request could repair existing profiles,
expand new identities from work credits, or resume an earlier campaign.

The production coordinator owns when this campaign may run. `people-only`
resumes the saved campaign directly; `enrichment-only` runs it after the saved
base-metadata stage; `film-and-current-enrichment` may create an
exact-current-work expansion sub-batch only after the film checkpoint. These
outer production modes are separate from the campaign's inner `repair_only`,
`expansion_only`, and `balanced` selection modes. Never use the inner mode to
start a concurrent People task beside film production.

## Keep two candidate queues

Maintain separate, resumable queues under one campaign directory:

```text
.local-data/people/<campaign-slug>/
  people-cycle-state.json
  repair-audit.json
  repair-queue.json
  expansion-coverage.json
  expansion-queue.json
  selection-explanation.json
  batches/
```

Do not merge these queues into one opaque ranking. Repair quality and work-credit
coverage are different outcomes and each must retain its own cursor, counts,
and completion evidence.

`people-cycle-state.json` records at least:

```json
{
  "schemaVersion": 1,
  "mode": "balanced",
  "repairQuota": 4,
  "expansionQuota": 6,
  "repairCursor": 0,
  "expansionCursor": 0,
  "lastCompletedBatch": null,
  "activeBatch": null,
  "catalogGeneratedAt": null,
  "status": "ready"
}
```

Write this state before a campaign starts, update a cursor only after the
corresponding publish/readback/convergence succeeds, and resume an unfinished
`activeBatch` before selecting more candidates. A bare “继续” uses this file;
conversation memory is not campaign state.

## Build the repair queue cheaply

Audit the current Azure person catalog and saved batch/sync issue artifacts
before calling Notion or external providers. Reuse a cached audit while its
`catalogGeneratedAt` matches the production catalog. Do not rescan Notion or
research every person merely to choose four candidates. Query Notion and
external sources only for the selected repair batch.

Generate or refresh the deterministic queue with:

```powershell
node --import tsx tools/people-repair-audit.mjs --backend azure --candidate-limit 100 --output-dir .local-data/people/<campaign-slug>
```

This read-only command writes `repair-audit.json` and `repair-queue.json`. Reuse
them while `catalogGeneratedAt` still matches; do not rerun it between every
person in the same cycle.

Record machine-detectable issue codes rather than a prose-only judgement:

- P0, identity or publication integrity: `identity_conflict`,
  `external_id_conflict`, `duplicate_person_binding`, `non_human_identity`,
  `notion_azure_drift`, `notion_row_invalid`, `missing_catalog_profile`, or
  `broken_reverse_link`.
- P1, public correctness: `wrong_display_name`, `traditional_public_name`,
  `known_factual_error`, `wrong_work_title`, or a verified biography attached
  to the wrong identity.
- P2, core quality: `generic_biography`, `short_zh_biography`,
  `short_en_biography`, `single_source_biography`,
  `quality_score_below_80`, `review_stale`,
  `missing_stable_external_id`, `missing_verified_zh_name`,
  `missing_verified_en_name`, `missing_verified_department`,
  `missing_verified_zh_biography`, `missing_verified_en_biography`, or an
  existing profile that still fails the core verification gate.
- P3, optional enrichment: `missing_portrait`, `missing_birth_date`,
  `missing_birth_place`, `missing_original_name`, or `missing_alias` when the
  verified core is already complete. Education and award detail remain manual
  optional observations until the structured schema supports them.

P3 entries are observations, not normal repair candidates. Do not spend the
four repair slots on them unless the user explicitly requests optional metadata
enrichment.

A repair candidate contains enough evidence to explain and reproduce selection:

```json
{
  "personId": "person_<uuid>",
  "displayName": "人物名",
  "priority": "P2",
  "score": 250,
  "qualityScore": 62,
  "qualityPolicyVersion": "people-quality-v1",
  "lastReviewedAt": "2025-03-01T00:00:00.000Z",
  "nextReviewAt": "2025-03-01T00:00:00.000Z",
  "reviewDue": true,
  "reasons": ["generic_biography", "single_source_biography"],
  "linkedWorkCount": 4,
  "departments": ["acting"],
  "stableIdentity": true,
  "status": "queued"
}
```

## Rank repair candidates

Use deterministic scores only to order candidates inside the gates below:

- P0 base score: 1000.
- P1 base score: 500.
- P2 base score: 200.
- Add the profile quality deficit, `100 - qualityScore`.
- Add 30 when the versioned assessment says the profile is review-due.
- Add `min(linkedWorkCount, 10) * 10`.
- Add 20 for a core creator department: directing, writing, production,
  camera/cinematography, editing, or music.
- Add 10 when a stable external identity already exists and the repair can be
  researched without guessing identity.
- Break ties by higher linked-work count, then stable `personId` lexical order.

These scores choose research order; they never authorize automatic identity
merges or publication. A P0 identity conflict still requires human-quality
identity review and may end in quarantine.

## Assess profile quality and review age

`people-quality-v1` is a 100-point internal editorial assessment, not a public
rating and not a measure of fame:

- identity, 25: stable external ID 15; no identity conflict 10;
- names and departments, 15: verified Chinese name 5, verified English name 5,
  and at least one department 5;
- biographies and evidence, 45: eligible Chinese biography 15, eligible
  English biography 15, at least two independent source families 10, and no
  rejected workflow-template prose 5;
- optional metadata, 15: portrait, birth date, birthplace, original name, and
  a checked alias contribute 3 each.

Apply hard caps after summing: P0 identity conflict caps at 39, P1 public
correctness defects cap at 69, and missing or ineligible bilingual biographies
cap at 79. Store both the score and policy version in the runtime profile so a
future rubric change is distinguishable from a real data improvement. Notion
needs only the current `Quality Score`; component details and the policy version
stay in the catalog and audit artifacts.

`Last Reviewed At` records the last complete editorial review of identity,
names, departments, both biographies, and sources. Set it after a successful
review even if the reviewer decides no content change is needed. Never copy
`Last Enriched At`, a sync time, or a provider fetch time into it. Existing
profiles may infer an initial value from the older of two eligible bilingual
editorial-biography observation times; otherwise leave it empty until reviewed.

Profiles are review-due immediately for P0/P1 issues, a score below 80, or no
review timestamp. For a living person, schedule 80-89 after 12 months and 90+
after 24 months. For a deceased person at 80+, schedule after 60 months. Review
age adds a P2 queue reason but never outranks a P0 or P1 severity gate.

For an ordinary four-person repair allocation:

1. Select all actionable P0 entries first. P0 may replace the entire allocation.
2. Fill remaining places from P1, then P2, in score order.
3. When possible, include at least one core creator and one actor without
   displacing a higher-severity entry.
4. Never select a P3-only entry.
5. If fewer than four actionable P0-P2 entries remain, transfer unused places
   to the expansion quota rather than manufacturing repair work.

`generic_biography` alone is a valid P2 reason, but the size of the generic
backlog must not cause random selection. Linked-work impact, department, stable
identity, and the deterministic tie break decide which generic profiles come
first.

## Build and consume the expansion queue

Use the production work-coverage audit described in `workflow.md`. Prefer
important unlinked identities already named in canonical work credits, then
partially linked works, then works whose credits still need bounded discovery.
Preserve complete credit lists and do not impose a fixed cast maximum.

Balanced mode consumes both allocations in one cycle, but each lane produces
its own reviewed sub-batch and convergence evidence. A failure in one lane does
not advance that lane's cursor and does not erase a successfully completed
other lane.

## Explain every selection

Before provider research or any write, create `selection-explanation.json` and
summarize it to the user. Include:

- command interpretation and selected mode;
- requested and effective repair/expansion quotas;
- any P0 preemption or unused-quota transfer;
- every selected repair person with priority, score, reason codes, linked-work
  count, and departments;
- every selected expansion work/person with its coverage reason;
- remaining queue counts and the state file used for resumption.

Do not say only that the batch is “high priority”. The explanation must make it
possible to understand why these people were selected instead of the next
candidates.

## Completion and continuation

After each sub-batch passes Notion readback, Azure convergence, live readback,
and canonical zero-write replay, mark those exact queue entries `completed`,
advance the relevant cursor, clear `activeBatch`, and persist counts. On a
failure, retain the active batch and its checkpoints; “继续” resumes it rather
than selecting replacements.

When reporting a balanced cycle, report repair and expansion results separately
as well as the combined total. Do not count an updated existing profile as a
new person.
