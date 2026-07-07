---
name: wwp-metadata-backfiller
description: Use when WWP film or series work pages need title, Douban, IMDb, OMDb, TMDb, poster, release, genre, runtime, cast, ratings, or AI advisory metadata after upload or during cleanup.
---

# WWP Metadata Backfiller

This fills work-level metadata. It is separate from Media Assets, which describes specific media files and specs.

## Workflow

1. Inspect existing Notion fields before fetching external data.
2. Parse and clean old Douban-style text blocks when present: directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb.
3. Use explicit IDs when available, especially Douban Subject ID and IMDb ID.
4. Fetch missing fields from the appropriate source and record source/status.
5. Use AI only for advisory/generated fields such as minimum age suggestion, family viewing notes, or summary phrasing; do not invent external facts.
6. Apply patches conservatively and verify readback.

## Source Split

- Douban: Chinese title, Douban ID/URL, Chinese summary, poster, rating, basic Chinese metadata.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, English structured credits, rated, box office.
- TMDb/IMDb: auxiliary identity, release, poster, credit, or disambiguation support.
- Existing Notion text: first-pass parsing for older entries before external calls.

## Guardrails

- OMDb has a limited daily quota; reuse existing IDs and cached data, batch carefully, and avoid speculative calls.
- If Douban search is unstable or ambiguous, use explicit subject ID or ask for confirmation.
- Truncate overlong cast lists for field hygiene while preserving source evidence in memo/report output.

## Reference

Read `../../references/metadata-sources.md` and `../../references/script-map.md`.
