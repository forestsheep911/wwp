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
8. Run OMDb after IMDb ID exists to fill `分级`, `IMDB评分`, `Metascore`, `烂番茄新鲜度`, `Box Office`, `Box Office Amount`, `Box Office Currency`, and `Box Office Source`.
9. If OMDb misses ratings that a trusted source likely has, run rating fallbacks before AI:
   - IMDb score: `scripts/imdb-rating-inspect.mjs <ttid>` uses IMDb's official dataset, then IMDb title-page JSON-LD. Apply confirmed fallback values with `node tools/notion-imdb-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>` so only empty `IMDB评分` is filled.
   - Rotten Tomatoes: prefer OMDb, then a confirmed official Rotten Tomatoes page. Find the page by Wikidata external ID, user-provided URL, saved official-page HTML, official title/year search, or a manually confirmed official URL from the user's evidence. Verify title/year/scope before writing. The inspector parses RT `media-scorecard-json`, official `<score-board>` markup, and official JSON-LD `AggregateRating`.
   - Metascore: prefer OMDb, then a confirmed official Metacritic page found by Wikidata external ID, user-provided URL, saved official-page HTML, official title/year search, or a manually confirmed official URL from the user's evidence. The inspector parses current `global-score-value` markup, legacy `metascore_w` markup, and official JSON-LD `AggregateRating`. If Metacritic is unavailable but IMDb's official title page displays a same-scope Metascore, use `scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>`.
   - Licensed/manual structured fallback: when official lookups are blocked but a trusted export or manually verified evidence exists, put it in a small JSON file and run `scripts/critic-rating-inspect.mjs --ratings-json <json>` or `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --ratings-json <json>`. Each score must carry a source label such as `licensed-source:<name>` or `manual-evidence:<name>` plus URL/date evidence.
   - For RT/Metacritic discovery, run `scripts/critic-rating-inspect.mjs --imdb-id <ttid> --discover-only`; if missing, generate official search URLs with `--title <title> --year <year> --search-only`, confirm the official page identity, then parse with `--rotten-url` or `--metacritic-url`.
   - After a confirmed fallback score is parsed, use `node tools/notion-critic-rating-enrichment.mjs --page-id <page> ...` to preview/apply only missing `烂番茄新鲜度` and `Metascore` fields. It must not overwrite existing human or OMDb values.
   Do not use screenshots unless the user supplies them as manual evidence.
10. Use AI only for advisory/generated fields such as `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, family viewing notes, or summary phrasing; do not invent external facts.
11. Apply patches conservatively and verify readback.

## Source Split

- Douban: Chinese title, Douban ID/URL, Chinese summary, poster, rating, basic Chinese metadata.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, English structured credits, rated, box office.
- IMDb fallback: official IMDb ratings dataset first, then IMDb title-page JSON-LD when OMDb is stale or rejects a current ID.
- Metascore fallback: OMDb first, Metacritic official page second, IMDb official title-page Metascore third. Official Metacritic page parsing has current markup, legacy markup, and JSON-LD fallbacks. Record whether the value came from `metacritic-page` or `imdb-page-metascore`.
- Rotten Tomatoes fallback: OMDb first; then confirmed official Rotten Tomatoes page found through Wikidata external ID, user-provided URL, saved official-page HTML, official-site search, or manually confirmed official evidence. Official page parsing has `media-scorecard-json`, `<score-board>`, and JSON-LD fallbacks. Require title/year/page identity verification before writing.
- Critic-score fallback: confirmed official page HTML, IMDb same-scope Metascore display, or trusted licensed/manual structured evidence only. Search URLs and Wikidata records are discovery evidence, not score evidence.
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
- Wikidata can discover critic-site page IDs but is not itself the critic-score source; use it to find official pages, not to invent ratings.
- Official RT/Metacritic search pages may be dynamic. Use them to locate candidate official URLs, then parse the confirmed page or saved HTML; never write scores from snippets, mirrors, Wikipedia summaries, or AI guesses.
- If Douban search is unstable or ambiguous, use explicit subject ID or ask for confirmation.
- Truncate overlong cast lists for field hygiene while preserving source evidence in memo/report output.

## Reference

Read `../../references/metadata-sources.md` and `../../references/script-map.md`.
