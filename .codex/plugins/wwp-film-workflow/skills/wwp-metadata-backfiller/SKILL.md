---
name: wwp-metadata-backfiller
description: Use when WWP film or series work pages need title, Douban, IMDb, OMDb, TMDb, poster, release, genre, runtime, cast, ratings, or AI advisory metadata after upload or during cleanup.
---

# WWP Metadata Backfiller

This fills work-level metadata. It is separate from Media Assets, which describes specific media files and specs.

## Workflow

1. Inspect existing Notion fields before fetching external data.
2. If a scanned film or series does not have a work page yet, create/reuse the work page for cataloging even when playable media is blocked, low quality, missing, or deferred. Metadata collection is a high-priority track and is not gated by video readiness.
3. Before trusting existing IDs or old text, compare the work title/year and external identity against concrete media evidence: original filenames, spec titles, source-page titles, and Media Assets. A conflict such as a `1959` filename attached to a page whose IMDb/basic info describes a 2008 remake is an identity incident, not a missing-field case. Stop normal enrichment, determine which identity the actual media represents, correct or clear all mismatched IDs/ratings/posters/credits, and set `Needs Review` until readback is coherent. When Douban is verified, use its page heading as the canonical display title; never concatenate subtitle-bearing structured fields into the primary title. For an existing season page, preserve the verified season number in the canonical title even when Douban returns only the parent series title.
4. Parse and clean old Douban-style text blocks when present: directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb.
5. Run identity maintenance for `WW Work ID`, parsed IDs, title-derived fields, and schema readiness.
6. Use explicit IDs when available, especially Douban Subject ID and IMDb ID, only after the media/identity conflict check passes. Existing coherent IDs override title search; same-title/remake works must not be rematched by title alone.
7. Fetch missing fields from the appropriate source and record source/status.
8. Fill the current structured field set, not only `基本信息`: `Release Year`, `上映日期`, `Countries`, `Languages`, `Traditional Chinese Title (Taiwan)`, `Traditional Chinese Title (Hong Kong)`, `旨趣`, `外部类型原文`, `未映射类型`, `Runtime Minutes`, `Directors`, `Writers`, `Cast`, ratings, poster fields, IDs/URLs, `Match Status`, `Metadata Status`, `Metadata Source`, `Metadata Confidence`, and `Metadata Updated At`.
9. Run OMDb after IMDb ID exists to fill `分级`, `IMDB评分`, `Metascore`, `烂番茄新鲜度`, `Box Office`, `Box Office Amount`, `Box Office Currency`, and `Box Office Source`.
10. If OMDb misses ratings that a trusted source likely has, run rating fallbacks before AI:
   - IMDb score: do not interpret OMDb `N/A`, `Incorrect IMDb ID`, quota failure, or stale new-series data as "no rating". First run `scripts/imdb-rating-inspect.mjs <ttid>` (the ID is positional; it uses the official IMDb dataset, then title-page JSON-LD) when available. The metadata backfill also continues automatically from an empty OMDb result to one official IMDb ratings-page fallback. Apply only a confirmed value with `node tools/notion-imdb-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>` or the metadata backfill readback; never use a title-search snippet or agent guess.
   - Rotten Tomatoes: prefer OMDb, then a confirmed official Rotten Tomatoes page. Find the page by Wikidata external ID, user-provided URL, saved official-page HTML, official title/year search candidate, or a manually confirmed official URL from the user's evidence. Verify title/year/scope before writing. The inspector parses RT `media-scorecard-json`, official `<score-board>` markup, and official JSON-LD `AggregateRating`.
   - Metascore: prefer OMDb, then a confirmed official Metacritic page found by Wikidata external ID, user-provided URL, saved official-page HTML, official title/year search candidate, or a manually confirmed official URL from the user's evidence. The inspector parses current `global-score-value` markup, legacy `metascore_w`, IMDb page embedded `metacriticScore`, and official JSON-LD `AggregateRating`. If Metacritic is unavailable but IMDb's official title page displays a same-scope Metascore, use `scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>`.
   - Licensed/manual structured fallback: when official lookups are blocked but a trusted export or manually verified evidence exists, put it in a small JSON file and run `scripts/critic-rating-inspect.mjs --ratings-json <json>` or `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --ratings-json <json>`. Each score must carry a source label such as `licensed-source:<name>` or `manual-evidence:<name>` plus URL/date evidence.
   - For RT/Metacritic discovery, run `scripts/critic-rating-inspect.mjs --imdb-id <ttid> --discover-only`; if Wikidata has no matching critic-site IDs or the page is still missing a critic score, continue with official site search discovery using the work title/year. In page mode, `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --discover-search` must carry the page title/year even when an IMDb ID exists. If official search is blocked or poor, use `--url-hints <search-result-html-or-text>` on saved browser/search-result text to extract RT/Metacritic official detail-page candidates. Confirm the official page identity, then parse with `--rotten-url` or `--metacritic-url`. Search result scores/snippets and generic URL hints are not score evidence.
   - After a confirmed fallback score is parsed, use `node tools/notion-critic-rating-enrichment.mjs --page-id <page> ...` to preview/apply only missing `烂番茄新鲜度` and `Metascore` fields. It must not overwrite existing human or OMDb values. The tool can reuse official RT/Metacritic URLs already present in Notion URL/text fields or `Developer Memo`, so manual confirmation can be recorded once and reused later. If parsing saved HTML files, pass `--rotten-source-url`, `--metacritic-source-url`, or `--imdb-source-url`, or keep those official URLs in `Developer Memo`. Preserve the official RT/Metacritic URL in evidence memo or `--ratings-json`; the website index can reuse those URLs as `externalIds.rottenTomatoes` and `externalIds.metacritic` for exact badge links instead of search-page fallback.
   Do not use screenshots unless the user supplies them as manual evidence.
11. Use AI only for advisory/generated fields such as `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, family viewing notes, or summary phrasing; do not invent external facts.
12. At the end of a valid AI inspection, write `Last AI Check Time` even when no metadata changed. Keep `Metadata Updated At` for actual metadata changes only.
13. Put only concrete unresolved AI findings in `AI Issue`. Never write, replace, or clear `Human Issue`; it is the renamed legacy `Issue` field and belongs to people. Set/keep `Needs Review` when either issue field is non-empty. Remove an `AI Issue` only after readback evidence confirms that specific issue is resolved.
14. Apply patches conservatively and verify readback.
15. Treat metadata completeness as a core-field gate, not an instruction to invent every optional value. Missing TMDb, regional title, official rating, critic score, box office, `未映射类型`, or `人工年龄覆盖` is acceptable when the source does not provide it. Empty `未映射类型` means all observed genres mapped successfully; empty `人工年龄覆盖` means no human override. Promote to `verified` only when core identity/descriptive/poster/AI advisory fields are present and `Human Issue` plus `AI Issue` are empty.
16. If stronger sourced metadata resolves a low-confidence AI age check, refresh only the exact work page. Clear only the corresponding resolved AI issue; preserve all human text and unrelated AI findings.

## Source Split

- Douban: Chinese title, Douban ID/URL, Chinese summary, poster, rating, basic Chinese metadata.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, English structured credits, rated, box office.
- IMDb fallback: official IMDb ratings dataset first, then IMDb title-page JSON-LD when OMDb is stale or rejects a current ID.
- Metascore fallback: OMDb first, Metacritic official page second, IMDb official title-page Metascore third. Official Metacritic page parsing has current markup, legacy markup, and JSON-LD fallbacks. Record whether the value came from `metacritic-page` or `imdb-page-metascore`.
- Rotten Tomatoes fallback: OMDb first; then confirmed official Rotten Tomatoes page found through Wikidata external ID, user-provided URL, saved official-page HTML, official-site search candidate, generic official URL hints, or manually confirmed official evidence. IMDb ID presence is useful for discovery, but lack of Wikidata IDs is not proof that RT has no page. Official page parsing has `media-scorecard-json`, `<score-board>`, and JSON-LD fallbacks. Require title/year/page identity verification before writing.
- Critic-score fallback: confirmed official page HTML, IMDb same-scope Metascore display, or trusted licensed/manual structured evidence only. Search URLs, parsed official search candidates, generic official URL hints, and Wikidata records are discovery evidence, not score evidence. Keep official RT/Metacritic URLs as reusable evidence because the site index recognizes them for direct rating-badge links.
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
- `Human Issue` preserves human-authored and migrated legacy issues. AI automation must treat it as read-only. `AI Issue` is limited to unresolved findings from AI inspections; do not use it as a run log or copy successfully resolved findings into it.
- `Last AI Check Time` records a completed AI inspection, including no-change checks. Use it to avoid repeat work and schedule later rating refreshes; newly released or airing works, missing fields, and unresolved issues may be checked sooner than stable completed works.
- For family-age fields, run the AI advisory enrichment after sourced metadata is present so the model sees title, year, genres, summary, rating, runtime, and credits.
- `TMDB ID` and `TMDB URL` must come from TMDb or a trusted existing hint. Do not generate them with AI. A verified IMDb ID may resolve through Wikidata `P4947` (movie) or `P4983` (TV); write only a unique single-kind match with the corresponding `/movie/` or `/tv/` URL. Ambiguous, multi-valued, and unresolved results remain blank for review.

## Guardrails

- OMDb has a limited daily quota; reuse existing IDs and cached data, batch carefully, and avoid speculative calls.
- Repeated AI family-age batches must use a local candidate cache plus JSONL progress instead of rescanning the full Notion data source for every batch. Build the cache once, then pass `--candidate-cache` for later batches. Progress records must retain the title and complete generated advisory, not only the page ID, so interrupted runs remain locally auditable. If Notion returns `429`, honor `Retry-After`, stop further reads for that window, and do not start another full scan.
- Wikidata can discover critic-site page IDs but is not itself the critic-score source; use it to find official pages, not to invent ratings.
- Official RT/Metacritic search pages may be dynamic. Use `--discover-search` to locate candidate official URLs when direct IDs are missing, or `--url-hints` to extract official detail-page candidates from saved browser/search-result text. Then parse the confirmed page or saved HTML; never write scores from search snippets, URL hint pages, mirrors, Wikipedia summaries, or AI guesses.
- If Douban search is unstable or ambiguous, use explicit subject ID or ask for confirmation.
- Truncate overlong cast lists for field hygiene while preserving source evidence in memo/report output.

## Reference

Read `../../references/metadata-sources.md` and `../../references/script-map.md`.
