---
name: wwp-honors-curator
description: Collect and verify awards, nominations, festival selections, and special mentions for WWP film or series works when enrichment or highlight readiness needs trustworthy honor facts.
---

# WWP Honors Curator

Create auditable work-honor facts, not promotional award summaries. Use the
record contract and validator in `apps/api/src/work-honor.ts`.

For every retained fact, establish the exact work identity, awarding body,
event or edition, year, category, result, recipient scope, source URL, and check
time. Keep `winner`, `nominee`, `selection`, and `special_mention` distinct.
Never convert “nominated”, “in competition”, “official selection”, or an OMDb
`Awards` summary into a win.

Prefer official award or festival archives. A reliable institutional source is
an acceptable fallback. Wikipedia, databases, search snippets, and AI recall
may locate candidates but do not independently verify a production write.

Run a bounded exact-work batch. Cache discovery results, use one shared limiter,
and stop on repeated rate limits. Preview proposed records and validation errors
before any Notion or catalog write. Record `checked_none_found` only after the
configured sources were actually checked; otherwise retain `not_checked` or
`partial` with the missing source.

Do not make a new Notion schema or write live records without an explicit
production apply step. Preserve source evidence and exact readback in the batch
artifact.

Use `references/schema.md` for the proposed canonical record and Notion-facing
projection. Keep honor facts separate from the legacy `闻达` field.
