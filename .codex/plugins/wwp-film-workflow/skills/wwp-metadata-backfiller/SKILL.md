---
name: wwp-metadata-backfiller
description: Use when WWP film or series work pages need title, Douban, IMDb, OMDb, TMDb, poster, release, genre, runtime, cast, ratings, or AI advisory metadata after upload or during cleanup.
---

# WWP Metadata Backfiller

This fills work-level metadata. It is separate from Media Assets, which describes specific media files and specs.

## Workflow

1. Inspect existing Notion fields before fetching external data.
2. If a scanned film or series does not have a work page yet, create/reuse the work page for cataloging even when playable media is blocked, low quality, missing, or deferred. Metadata collection is a high-priority track and is not gated by video readiness.
3. Parse and clean old Douban-style text blocks when present: directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb.
4. Run identity maintenance for `WW Work ID`, parsed IDs, title-derived fields, and schema readiness.
5. Use explicit IDs when available, especially Douban Subject ID and IMDb ID. Existing IDs on the page override title search; same-title/remake works must not be rematched by title alone.
6. Fetch missing fields from the appropriate source and record source/status.
7. Fill the current structured field set, not only `基本信息`: `Release Year`, `上映日期`, `Countries`, `Languages`, `Traditional Chinese Title (Taiwan)`, `Traditional Chinese Title (Hong Kong)`, `旨趣`, `外部类型原文`, `未映射类型`, `Runtime Minutes`, `Directors`, `Writers`, `Cast`, ratings, poster fields, IDs/URLs, `Match Status`, `Metadata Status`, `Metadata Source`, `Metadata Confidence`, and `Metadata Updated At`.
8. Run OMDb after IMDb ID exists to fill `分级`, `Metascore`, `烂番茄新鲜度`, `Box Office`, `Box Office Amount`, `Box Office Currency`, and `Box Office Source`.
9. Use AI only for advisory/generated fields such as `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, family viewing notes, or summary phrasing; do not invent external facts.
10. Apply patches conservatively and verify readback.

## Source Split

- Douban: Chinese title, Douban ID/URL, Chinese summary, poster, rating, basic Chinese metadata.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, English structured credits, rated, box office.
- TMDb: TMDB ID/URL by IMDb lookup or title/year search, original title, localized zh-CN/zh-TW/zh-HK titles, release disambiguation, poster/credit support. Require TMDb credentials or a trusted existing TMDb hint.
- IMDb: identity and disambiguation support.
- Existing Notion text: first-pass parsing for older entries before external calls.

## Current Field Contract

- `上映日期` is the authoritative date field. Do not write the removed legacy `Release Date` field.
- `Release Year` remains as a numeric sort/filter/index field derived from sourced release date or title evidence.
- `旨趣` is the canonical Chinese genre multi-select. Store raw source genre text in `外部类型原文`; put values that cannot be mapped into `未映射类型` and set review state when needed.
- `分级` is official/source rating. It is separate from AI age suggestion fields.
- `Media Availability` is an operational media state and should not be inferred by this metadata skill unless a media workflow has verified the state.
- A complete metadata page may remain hidden and non-playable. Do not treat lack of playable media as a reason to skip metadata enrichment.
- `Hide from Website` is a visibility safety gate. Metadata tools should not clear it automatically; if playback/spec evidence looks complete, ask the user before un-hiding.
- `Needs Review` can be set by metadata conflicts, unmapped genres, ambiguous matching, low-confidence AI advisory, or unresolved manual decisions. Clear it only after the concrete review reason is resolved.
- For family-age fields, run the AI advisory enrichment after sourced metadata is present so the model sees title, year, genres, summary, rating, runtime, and credits.
- `TMDB ID` and `TMDB URL` must come from TMDb or a trusted existing hint. Do not generate them with AI.

## Guardrails

- OMDb has a limited daily quota; reuse existing IDs and cached data, batch carefully, and avoid speculative calls.
- If Douban search is unstable or ambiguous, use explicit subject ID or ask for confirmation.
- Truncate overlong cast lists for field hygiene while preserving source evidence in memo/report output.

## Reference

Read `../../references/metadata-sources.md` and `../../references/script-map.md`.
