# WWP Metadata Sources

This reference covers work-level metadata. Media Assets covers media-file/spec metadata.

## Order of Operations

1. Inspect existing Notion fields and page text.
2. Parse old Douban-style basic-info text when present.
3. Use existing IDs first: Douban Subject ID, IMDb ID, TMDb ID.
4. If a scanned work is worth cataloging and the work page does not exist yet, create/reuse the work page even when playable media is unavailable, unsuitable, or deferred.
5. If playable or manual upload work is also planned, create/reuse the intended spec/episode pages before waiting for long encodes or uploads. This destination step is a media workflow requirement, not a metadata prerequisite.
6. Run identity maintenance so `WW Work ID`, parsed external IDs, schema, match status, and source/status fields are initialized.
7. Fetch missing sourced fields from Douban, OMDb, and TMDb lanes as soon as the work page exists and the required IDs/credentials are available.
8. Run AI advisory fields only after sourced metadata is present.
9. Apply conservatively and verify readback.

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
- Work-level metadata may be complete while `Media Availability` remains `needs_processing`, `source_only`, `blocked`, or `unknown`.
- `Hide from Website` is a visibility safety gate. Keep it true when the work has no playable verified media, upload/encoding/subtitle requirements are blocked, Media Assets are missing or inconsistent, or the user manually hid the work. Do not clear it just because metadata is now complete. If other specs look good but the flag is true, ask the user before clearing it.
- `Needs Review` is a quality/review gate. Set it when sourced metadata conflicts, the match is ambiguous, `未映射类型` is non-empty, AI advisory confidence is low or marks review, schema/media state disagrees, or a manual decision is pending. Clear it only after the specific review reason is resolved and readback confirms the corrected state.
- `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, and `人工年龄覆盖` are advisory/family fields. Run the AI advisory step after sourced fields are present.

## Old Data Cleanup

When older entries contain plain Douban-style text, parse and normalize fields such as directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb. Remove links and truncate oversized cast lists for schema hygiene while preserving evidence in report output.

## Source Split

- Identity maintenance: `WW Work ID`, parsed IMDb/Douban/TMDb hints, title-derived fields, match/status/confidence, and schema readiness.
- Douban: Chinese title, Douban ID/URL, Douban rating, Chinese summary, poster, Chinese basic info, regional AKA, country/region, language, release date, runtime, directors, writers, cast, and Chinese genre text.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, Rated, English credits, box office, runtime.
- IMDb rating fallback: when an IMDb ID exists and OMDb lags, rejects it, or lacks data, run `scripts/imdb-rating-inspect.mjs`. Prefer IMDb's official non-commercial `title.ratings.tsv.gz` dataset, then IMDb title-page JSON-LD. Apply values with `node tools/notion-imdb-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>` so only empty `IMDB评分` is filled and existing human or OMDb values are preserved. User screenshots are only manual evidence when the user supplies them; they are not the normal agent workflow.
- Metascore fallback: when OMDb lacks Metascore, parse the confirmed Metacritic official page first. The inspector accepts current `global-score-value` markup, legacy `metascore_w` markup, and official JSON-LD `AggregateRating`. If that page cannot be found or parsed but IMDb shows a Metascore on the official title page, run `scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>` and record source `imdb-page-metascore`.
- Rotten Tomatoes and Metacritic fallback: when OMDb lacks critic fields, use official or trusted structured evidence only. If IMDb ID exists, first run `scripts/critic-rating-inspect.mjs --imdb-id <ttid> --discover-only` to discover Rotten Tomatoes/Metacritic official page URLs through Wikidata external IDs. If Wikidata lacks those IDs, run `scripts/critic-rating-inspect.mjs --title <title> --year <year> --search-only`, use the official search URLs to find a candidate official page, verify title/year/scope, then parse with `--rotten-url` or `--metacritic-url`. Rotten Tomatoes official parsing accepts `media-scorecard-json`, `<score-board>`, and official JSON-LD `AggregateRating`. A user-provided official URL, saved official-page HTML, or trusted licensed/manual structured JSON is also acceptable evidence when identity and scope are recorded; run it through `--ratings-json` and require source labels like `licensed-source:<name>` or `manual-evidence:<name>`. Apply values with `node tools/notion-critic-rating-enrichment.mjs --page-id <page> ...` only after identity verification; otherwise leave fields blank and set/keep `Needs Review`.
- TMDb: TMDB ID/URL, localized titles, original title, release disambiguation, poster/credit support, title checks.
- IMDb: identity and disambiguation support.
- AI: minimum age suggestion, family viewing notes, local editorial summary, advisory labels.

## Critic Rating Evidence Order

| Field | Evidence order | Never use |
|---|---|---|
| `烂番茄新鲜度` | OMDb Rotten Tomatoes rating; confirmed Rotten Tomatoes official page from Wikidata ID, user URL, saved official-page HTML, official title/year search, or manually confirmed official URL; trusted `--ratings-json` licensed/manual structured evidence with URL/date | IMDb page, AI guesses, search snippets, mirrors, Wikipedia summaries, unmatched title pages |
| `Metascore` | OMDb Metascore; confirmed Metacritic official page from Wikidata ID, user URL, saved official-page HTML, official title/year search, or manually confirmed official URL; IMDb official title-page Metascore for the same work/season; trusted `--ratings-json` licensed/manual structured evidence with URL/date | AI guesses, search snippets, mirrors, Wikipedia summaries, mixed work/season scopes |

Record the source in the report/memo with a stable label such as `omdb`, `rotten-tomatoes-page`, `metacritic-page`, `imdb-page-metascore`, `licensed-source:<name>`, or `manual-evidence:<name>`. Saved HTML is evidence only when it came from the official URL and the captured page identity is visible. `--ratings-json` is the fallback container for structured licensed/manual values; it is not a way to bypass identity checks.

Minimum `--ratings-json` shape:

```json
{
  "rottenTomatoes": {
    "score": 88,
    "reviewCount": 90,
    "source": "licensed-source:rt-export",
    "url": "https://www.rottentomatoes.com/m/example",
    "observedAt": "2026-07-10"
  },
  "metacritic": {
    "score": 71,
    "source": "manual-evidence:metacritic-page-check",
    "url": "https://www.metacritic.com/movie/example"
  }
}
```

## Quotas and Stability

- OMDb daily quota is limited; batch cautiously, reuse IDs, and avoid speculative calls.
- OMDb may return `Incorrect IMDb ID` or stale `N/A` for newly listed series even when IMDb's own page already shows a rating. Treat this as an OMDb coverage gap, not as proof that the IMDb rating is absent.
- IMDb dataset fallback is ID-level and usually stronger than page scraping. Record source as `imdb-datasets` when available; use `imdb-page` only when the official dataset has no row yet.
- Rotten Tomatoes and Metacritic direct-page fallbacks are page-level and markup-dependent. Record the source URL and observed date in the report or memo. Use Wikidata only to discover official page IDs/URLs, not as a score source. If Wikidata has no critic-site ID, official-site search may be used for candidate discovery, but do not write values from search snippets or unverified result pages. If official pages change visible markup, try the official page's JSON-LD `AggregateRating` before considering the page unparseable. Prefer saved official HTML, `--ratings-json` from trusted exports/manual verification, and parser updates over non-official mirrors. Do not use random mirrors, AI-generated guesses, Wikipedia summaries, or unverified title-search hits as rating sources.
- IMDb-page Metascore is acceptable only as a Metascore fallback when the official IMDb title page clearly displays it for the same work/season. It is not a Rotten Tomatoes fallback.
- For newly released or still-airing works, critic-site coverage may lag or be season-specific. Prefer the work/season page matching the Notion work scope; if only episode-level or ambiguous pages exist, keep the field empty and set/keep `Needs Review` rather than collapsing different scopes into one score.
- Douban search/suggest can be unstable or challenged. Prefer explicit Subject ID when available or when same-title ambiguity exists.
- TMDb fields require TMDb credentials or a trusted existing TMDb hint. If no key is configured, report the gap instead of fabricating IDs or localized titles.
- Do not invent external facts. If a field cannot be sourced, leave it blank or mark uncertainty.
