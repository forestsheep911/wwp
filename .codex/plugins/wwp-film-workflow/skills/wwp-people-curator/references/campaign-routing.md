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

## Keep two evidence queues under one active work

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
coverage are different outcomes and each must retain its own counts and
completion evidence. They do, however, share one work-level routing decision:
ordinary repair and expansion candidates must belong to the same pinned work.

`people-cycle-state.json` records at least:

```json
{
  "schemaVersion": 1,
  "mode": "balanced",
  "repairQuota": 4,
  "expansionQuota": 6,
  "repairCursor": 0,
  "expansionCursor": 0,
  "activePeopleWorkId": null,
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

`activePeopleWorkId` is a work-level pin shared by repair and expansion, not
merely a batch hint. If an older saved state contains
`activeExpansionWorkId`, migrate that value to `activePeopleWorkId` before
selection. A successful sub-batch may clear `activeBatch`, but it retains the
work pin while important creator/cast credits remain unlinked or important
linked profiles still carry actionable P0-P2 defects. Advance the work cursor
and choose another work only after a recorded coverage-and-quality closure or a
recorded blocker permits the campaign to continue elsewhere.

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

For an ordinary four-person repair allocation, first determine the active work:

1. Resume `activePeopleWorkId` when present.
2. Otherwise prefer an exact current work handed off by the film stage.
3. Otherwise take the highest-ranked actionable repair candidate and choose one
   of that person's linked works, preferring the work with the largest number
   of important actionable profiles or unlinked important credits. Pin that
   work before selecting the rest of the batch.

Then select repairs for that work:

1. Select all actionable P0 entries first. P0 may replace the entire allocation.
2. Fill remaining places from P1, then P2, in score order, restricted to
   important profiles linked to `activePeopleWorkId`.
3. When possible, include at least one core creator and one actor without
   displacing a higher-severity entry.
4. Never select a P3-only entry.
5. If fewer than four actionable P0-P2 entries remain on the active work,
   transfer unused places to that same work's expansion allocation rather than
   selecting repairs from unrelated works.

Global P0 identity/integrity and P1 public-correctness defects may interrupt
this work-scoped allocation. Record the detour, preserve `activePeopleWorkId`,
and return to it after the urgent defect passes publication and convergence.
An explicit named-person correction also preserves the work pin.

`generic_biography` alone is a valid P2 reason, but the size of the generic
backlog must not cause random selection. Linked-work impact, department, stable
identity, and the deterministic tie break decide which generic profiles come
first.

## Build and consume the work-centered People queue

Use the production work-coverage audit described in `workflow.md`. Prefer
important unlinked identities already named in canonical work credits, then
partially linked works, then works whose credits still need bounded discovery.
Preserve complete credit lists and do not impose a fixed cast maximum.

Consume this as a queue of works, never as one flat queue of people. The same
work pin governs both repair and expansion:

1. Resume `activePeopleWorkId` before considering any other work.
2. If no work is active, prefer the exact current work handed off by the film
   stage; otherwise select one work from the saved coverage queue and pin it.
3. Build a work-local plan containing both actionable repairs for existing
   important linked profiles and important unlinked creator/cast identities.
4. Spend the effective repair and expansion allocations only on that work.
   Existing reviewed people may be linked without counting as newly created
   profiles; unused balanced-mode capacity may transfer between the two lanes
   without leaving the active work.
5. When the quota or safe sub-batch limit is reached, publish and verify the
   batch, update work coverage, then resume the same work next cycle.
6. Close the work only when every important in-scope credit is linked,
   explicitly retained as unresolved with a reason, or excluded as a verified
   non-person, and every important linked profile has no actionable P0-P2
   defect. Record linked, unresolved, excluded, repair-due, and remaining
   counts.
7. If identity ambiguity, missing source coverage, provider failure, or a
   human decision blocks closure, keep the work open, record the blocker and
   remaining credits, and only then continue with another work.

Do not fill a repair or expansion batch with convenient candidates from several
works. This avoids a catalog where many works each have a few good profiles but
none has useful creator-and-cast coverage and quality.

Balanced mode consumes both allocations in one cycle, but each lane produces
its own reviewed sub-batch and convergence evidence. A failure in one lane does
not advance that lane's cursor and does not erase a successfully completed
other lane.

A missing, truncated, or invalid local intermediate artifact is recoverable AI
work whenever its upstream report and selected stable IDs still exist. Rebuild
the artifact atomically and resume the pinned batch. Do not convert this local
staging failure into a Goal-level blocker or human-review state. Reserve a
blocker for missing source evidence, ambiguous identity, provider/API failure,
or another condition the AI cannot resolve from retained state.

For a person identity that remains unresolved after two bounded passes using
different source families, stop treating the same residual as ordinary queue
work. Record an explicit work-local `blocked` residual with the exact name,
department, checked evidence, and next trigger (`new provider evidence or
manual identity confirmation`). This blocker belongs to that credit only; the
People cursor may continue with other works and lanes, and the same searches
must not be repeated until the trigger changes.

## Explain every selection

Before provider research or any write, create `selection-explanation.json` and
summarize it to the user. Include:

- command interpretation and selected mode;
- requested and effective repair/expansion quotas;
- any P0 preemption or unused-quota transfer;
- every selected repair person with priority, score, reason codes, linked-work
  count, and departments;
- every selected expansion work/person with its coverage reason;
- the pinned People work, its linked/unresolved/remaining important-credit
  counts, its repair-due count, and whether this batch is expected to close or
  continue that work;
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

For ordinary repair and expansion, "those exact queue entries" means the
published person entries, not the work entry. Keep the work entry pinned and do
not advance the work cursor until its work-level coverage and quality gates
close. A blocked work may be parked only with its blocker, remaining-credit,
and repair-due report intact.

When reporting a balanced cycle, report repair and expansion results separately
as well as the combined total. Do not count an updated existing profile as a
new person.
