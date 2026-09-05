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

People completeness means the key creators needed for the current work's
editorial claims are verified. It does not require materializing every minor
cast credit. Honors completeness is either `verified` or the explicit
`checked_none_found`; an empty unchecked field is not completion.

Only route a work to highlights when its assessment is `ready`. Report
`blocked_metadata`, `blocked_people`, or `blocked_honors` with the exact missing
facts instead of generating generic prose.
