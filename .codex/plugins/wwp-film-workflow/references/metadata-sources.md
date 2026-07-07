# WWP Metadata Sources

This reference covers work-level metadata. Media Assets covers media-file/spec metadata.

## Order of Operations

1. Inspect existing Notion fields and page text.
2. Parse old Douban-style basic-info text when present.
3. Use existing IDs first: Douban Subject ID, IMDb ID, TMDb ID.
4. If the accepted work page does not exist yet, create/reuse the work page and intended spec page before waiting for long encodes or uploads.
5. Run identity maintenance so `WW Work ID`, parsed external IDs, schema, match status, and source/status fields are initialized.
6. Fetch missing sourced fields from Douban, OMDb, and TMDb lanes as soon as the work page exists and the required IDs/credentials are available.
7. Run AI advisory fields only after sourced metadata is present.
8. Apply conservatively and verify readback.

## Current Notion Field Contract

- `上映日期` is the active release-date field. Do not write the removed legacy `Release Date` field.
- `Release Year` is a numeric derived field for sort/filter/matching/index use.
- `WW Work ID` is a local stable identity field and belongs to identity maintenance.
- `TMDB ID` and `TMDB URL` must come from TMDb or a trusted existing hint; do not generate them with AI.
- `Traditional Chinese Title (Taiwan)` and `Traditional Chinese Title (Hong Kong)` come from Douban regional aliases, TMDb localized data, or trusted existing text.
- `Countries`, `Languages`, `Runtime Minutes`, `Directors`, `Writers`, and `Cast` are structured fields and should be filled when the source gives them.
- `旨趣` is the canonical Chinese genre multi-select.
- `外部类型原文` preserves raw external genre text.
- `未映射类型` records genre values that did not map cleanly and should trigger review.
- `Box Office`, `Box Office Amount`, `Box Office Currency`, and `Box Office Source` normally come from OMDb. Leave them empty when OMDb has `N/A` or no trusted source exists.
- `Metadata Source`, `Metadata Status`, `Metadata Confidence`, `Match Status`, and `Metadata Updated At` should reflect the latest sourced metadata pass.
- `Media Availability` is media-operations state. Sourced work metadata must not mark a work playable without uploaded/probed media evidence.
- `Hide from Website` is a visibility safety gate. Keep it true when the work has no playable verified media, upload/encoding/subtitle requirements are blocked, Media Assets are missing or inconsistent, or the user manually hid the work. Do not clear it just because metadata is now complete. If other specs look good but the flag is true, ask the user before clearing it.
- `Needs Review` is a quality/review gate. Set it when sourced metadata conflicts, the match is ambiguous, `未映射类型` is non-empty, AI advisory confidence is low or marks review, schema/media state disagrees, or a manual decision is pending. Clear it only after the specific review reason is resolved and readback confirms the corrected state.
- `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, and `人工年龄覆盖` are advisory/family fields. Run the AI advisory step after sourced fields are present.

## Old Data Cleanup

When older entries contain plain Douban-style text, parse and normalize fields such as directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb. Remove links and truncate oversized cast lists for schema hygiene while preserving evidence in report output.

## Source Split

- Identity maintenance: `WW Work ID`, parsed IMDb/Douban/TMDb hints, title-derived fields, match/status/confidence, and schema readiness.
- Douban: Chinese title, Douban ID/URL, Douban rating, Chinese summary, poster, Chinese basic info, regional AKA, country/region, language, release date, runtime, directors, writers, cast, and Chinese genre text.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, Rated, English credits, box office, runtime.
- TMDb: TMDB ID/URL, localized titles, original title, release disambiguation, poster/credit support, title checks.
- IMDb: identity and disambiguation support.
- AI: minimum age suggestion, family viewing notes, local editorial summary, advisory labels.

## Quotas and Stability

- OMDb daily quota is limited; batch cautiously, reuse IDs, and avoid speculative calls.
- Douban search/suggest can be unstable or challenged. Prefer explicit Subject ID when available or when same-title ambiguity exists.
- TMDb fields require TMDb credentials or a trusted existing TMDb hint. If no key is configured, report the gap instead of fabricating IDs or localized titles.
- Do not invent external facts. If a field cannot be sourced, leave it blank or mark uncertainty.
