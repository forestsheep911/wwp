# WWP Metadata Sources

This reference covers work-level metadata. Media Assets covers media-file/spec metadata.

## Order of Operations

1. Inspect existing Notion fields and page text.
2. Cross-check existing IDs/basic info against the work title, original media filenames, spec/source-page titles, and Media Assets before enrichment. Year/title/remake conflicts are identity incidents: correct the identity and clear every mismatched dependent field before filling anything else.
3. Parse old Douban-style basic-info text when present.
4. Use existing IDs first only after that cross-check passes: Douban Subject ID, IMDb ID, TMDb ID.
5. If a scanned work is worth cataloging and the work page does not exist yet, create/reuse the work page even when playable media is unavailable, unsuitable, or deferred.
5a. Before that first write, resolve `movie` versus `series` from strong source/external evidence and persist it in the ledger. Invoke the work-page creator with the ledger work ID; never allow a movie/series default at the Notion boundary. Exact readback must prove `movie -> Movie` or `series -> TV Series`, and any mismatch blocks metadata completion and publication reconciliation.
6. If playable or manual upload work is also planned, create/reuse the intended spec/episode pages before waiting for long encodes or uploads. This destination step is a media workflow requirement, not a metadata prerequisite.
7. Run identity maintenance so `WW Work ID`, parsed external IDs, schema, match status, and source/status fields are initialized.
8. Fetch missing sourced fields from Douban, OMDb, and TMDb lanes as soon as the work page exists and the required IDs/credentials are available.
   For a season page, this means the verified season identity, not the parent-series OMDb record: a season title/year, season-specific Douban Subject ID, or season-specific IMDb ID must win over a parent-series match. Never copy the parent series' release year, runtime, poster, rating, or descriptive text into every season page merely because OMDb returns the parent record.
9. Run AI advisory fields only after sourced metadata is present.
10. Apply conservatively and verify readback.
11. Calculate core completeness from the exact readback. Complete the ledger
    metadata task only for `Metadata Status=verified`; keep `partial` pending or
    defer it with exact missing-core/source/blocker/review evidence.
12. Before current-release completion, verify that the maintained poster can be
    fetched/cached and that the targeted live website result contains that
    poster and the core metadata projection.

## Current Notion Field Contract

- `上映日期` is the active release-date field. Do not write the removed legacy `Release Date` field.
- `Release Year` is a numeric derived field for sort/filter/matching/index use. Derive it from a sourced release date first. A canonical title may be fallback evidence only when the year is the terminal parenthesized suffix, such as `(2004)`; never treat arbitrary four-digit title text such as `2046`, `1917`, `2001: A Space Odyssey`, or `Blade Runner 2049` as the release year.
- `WW Work ID` is a local stable identity field and belongs to identity maintenance.
- `影别` is an identity field, not descriptive enrichment. Its only valid workflow mapping is ledger `movie -> Movie` and ledger `series -> TV Series`. Derive the ledger decision before page creation from strong evidence such as TMDb kind, episode/first-air metadata, and `SxxEyy` source structure; do not infer it from the presence or absence of playable media.
- `TMDB ID` and `TMDB URL` must come from TMDb or a trusted existing hint; do not generate them with AI. A verified IMDb ID may use Wikidata as a discovery bridge: `P4947` is a TMDb movie ID and `P4983` is a TMDb television-series ID. Accept only one value from exactly one property, build the matching `/movie/<id>` or `/tv/<id>` URL, and leave multi-valued or simultaneous movie/TV matches for manual review.
- `Traditional Chinese Title (Taiwan)` and `Traditional Chinese Title (Hong Kong)` come from Douban regional aliases, TMDb localized data, or trusted existing text.
- `Countries`, `Languages`, `Runtime Minutes`, `Directors`, `Writers`, and `Cast` are structured fields and should be filled when the source gives them.
- Keep organizations in three optional rich-text fields: `Production Companies` for companies credited with producing or presenting the work, `Distributors` for distribution companies, and `Studios` only for an explicitly identified production or animation studio. Preserve the entity name credited at the time of the work or release; a later acquisition, merger, rename, parent company, or current rights holder must not replace that historical credit. Do not infer a studio from a company name, and do not mechanically duplicate every production company into `Studios`.
- A company may hold more than one role on the same work. Record it independently in every role explicitly supported by the credits or source; shared ownership alone is not role evidence.
- Distributor evidence is scoped. When available, store `Company — territory, medium, release period`, for example `Sony Pictures Releasing — United States theatrical (2026)`. Theatrical, home-video, television, and streaming distributors may differ, as may distributors by country.
- Parent-company lineage is company authority metadata, not a film credit. For example, a Columbia Pictures production credit remains `Columbia Pictures`; Sony Pictures Entertainment or Sony Group Corporation may be retained separately as current corporate lineage, never substituted automatically into the film's production or distribution fields.
- `旨趣` is the canonical Chinese genre multi-select.
- `外部类型原文` preserves raw external genre text.
- `未映射类型` records genre values that did not map cleanly and should trigger review.
- `Box Office`, `Box Office Amount`, `Box Office Currency`, and `Box Office Source` normally come from OMDb. Leave them empty when OMDb has `N/A` or no trusted source exists.
- `Metadata Source`, `Metadata Status`, `Metadata Confidence`, `Match Status`, and `Metadata Updated At` should reflect the latest sourced metadata pass. `Metadata Updated At` changes only when metadata changes. `Metadata Source` is a page-level union, not field-level provenance: it must never be used to claim that an existing `简介` or `基本信息` came from a particular source.
- Field provenance rule: the normal Douban pass is authoritative for `简介` and `基本信息`; OMDb may provide those fields only through the explicit Douban-failure fallback. Backfill must not overwrite a non-empty legacy value merely to relabel it. When a field is already populated and is not changed, report its provenance as `unknown/legacy` unless an evidence record proves it; report `updatedFieldSources` for fields actually written in the current pass.
- Legacy source correction: when an existing page is verified against a Douban subject but its `简介` or `基本信息` was previously filled from OMDb, use the explicit `--force-douban-fields` correction pass. This replaces only those two descriptive fields, records `updatedFieldSources`, and never silently rewrites a complete legacy field during an ordinary backfill.
- `Metadata Status=verified` is the metadata completion gate. A successful tool
  run or `partial` result is not enough to complete the ledger task or the
  whole-work workflow.
- `Last AI Check Time` records the end of a valid AI inspection even when it makes no metadata change. Candidate selection should use it to skip recently checked stable works while allowing earlier refresh for airing/new works, missing fields, or unresolved issues.
- `Human Issue` is human-owned and contains values migrated from the former `Issue` field. Automation may read it but must not overwrite or clear it. `AI Issue` contains only concrete issues an AI check could not resolve during that pass; it is not an activity log.
- `Media Availability` is media-operations state. Sourced work metadata must not mark a work playable without uploaded/probed media evidence.
- Work-level metadata may be complete while `Media Availability` remains `needs_processing`, `source_only`, `blocked`, or `unknown`.
- `Hide from Website` is a visibility safety gate. Keep it true when the work has no playable verified media, upload/encoding/applicable subtitle requirements are blocked, Media Assets are missing or inconsistent, or the user manually hid the work. A verified `国配` branch without Chinese subtitles has no blocked subtitle requirement; missing subtitles are optional later enrichment and do not justify hiding or review by themselves. Do not clear the flag just because metadata is now complete. If other specs look good but the flag is true, ask the user before clearing it.
- `Needs Review` is a quality/review gate. Set it when sourced metadata conflicts, the match is ambiguous, `未映射类型` is non-empty, AI advisory confidence is low or marks review, schema/media state disagrees, a manual decision is pending, or either issue field is non-empty. Clear it only after every concrete review reason is resolved and readback confirms the corrected state. Clearing review never clears `Human Issue` and must not automatically change `Hide from Website`.
- `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, `AI年龄建议理由`, and `人工年龄覆盖` are advisory/family fields. Run the AI advisory step after sourced fields are present.
- `内容风险标签` must describe concrete, observable content such as violence,
  gore, horror, sex/nudity, language, drugs, self-harm, war, discrimination,
  crime, or death/bereavement. Do not use `成人主题`, `成人内容`, `成人向`,
  or similar catch-all wording. Theme complexity, politics, ethics, identity,
  and life experience belong in a specific `AI年龄建议理由`; the reason must
  name the actual content or comprehension barrier rather than restating the age.
- Sexual content requires an explicit check. Do not infer `性/裸露` only from
  the synopsis, genre, or official age rating, because these sources often omit
  brief or secondary nudity. Check the available content advisory/parent-guide
  evidence and any reliable human observation. A human report of visible
  nudity is sufficient evidence to add `性/裸露`; preserve the report in the
  human-owned note and set `Needs Review` when the extent or age consequence is
  still uncertain. Do not clear the tag merely because OMDb or a synopsis does
  not mention it.

## Old Data Cleanup

When older entries contain plain Douban-style text, parse and normalize fields such as directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb. Remove links and truncate oversized cast lists for schema hygiene while preserving evidence in report output.

## Source Split

- Identity maintenance: `WW Work ID`, parsed IMDb/Douban/TMDb hints, title-derived fields, match/status/confidence, and schema readiness.
- Douban: Chinese title, Douban ID/URL, Douban rating, Chinese summary, poster, Chinese basic info, regional AKA, country/region, language, release date, runtime, directors, writers, cast, and Chinese genre text.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, Rated, English credits, box office, runtime, and `Production` as production-company evidence. Current OMDb responses may omit `Production`; treat that as a coverage gap rather than proof that no production company exists. OMDb runtime is advisory: for a `series` response, a value below 10 minutes is suspicious, so leave it empty and record `Needs Review`/`AI Issue` instead of writing it.
- Season-scope guard: OMDb often resolves a season page to the parent series. If the Notion title contains `第N季`/`Season N`, do not use a parent-series OMDb response as season metadata unless the response is explicitly season-scoped and its year, episode count, and identity agree. Prefer the verified Douban season page or a season-specific IMDb record; when scope cannot be proved, keep the sourced fields partial and write a concrete `AI Issue` rather than silently reusing parent data.
- Wikidata `P272`: production-company fallback after exact IMDb `P345` identity matching. Preserve every returned company entity and label in evidence, but remember that the entity label is normally its current name. For releases before 2020, or whenever a rename/acquisition conflict is plausible, require another source that proves the historical on-screen/release-period name before writing. Do not reinterpret parent-company lineage as a production credit.
- TMDb: use `production_companies` as production-company evidence. Do not treat TV `networks` as studios. TMDb does not provide a general distributor field.
- IMDb company credits or Wikidata `P750`: distributor evidence after exact work identity verification; preserve territory annotations when available.
- Studio evidence: only an explicit source role such as animation studio or production studio. A generic production-company credit alone is insufficient for `Studios`.
- IMDb rating fallback: when an IMDb ID exists and OMDb lags, rejects it, returns `N/A`, hits quota, or lacks data, treat that as an OMDb coverage gap, not proof that the rating is absent. Prefer `scripts/imdb-rating-inspect.mjs <ttid>` (the ID is positional) with IMDb's official non-commercial `title.ratings.tsv.gz` dataset, then IMDb title-page JSON-LD; the metadata backfill also continues automatically from an empty OMDb result to one official IMDb ratings-page fallback. Apply only confirmed values with `node tools/notion-imdb-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>` or the metadata backfill readback, preserving existing human/OMDb values. User screenshots are manual evidence only when the user supplies them; they are not the normal agent workflow.
- Metascore fallback: when OMDb lacks Metascore, parse the confirmed Metacritic official page first. The inspector accepts current `global-score-value` markup, legacy `metascore_w` markup, and official JSON-LD `AggregateRating`. If that page cannot be found or parsed but IMDb shows a Metascore on the official title page, run `scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>` and record source `imdb-page-metascore`.
- Rotten Tomatoes and Metacritic fallback: when OMDb lacks critic fields, use official or trusted structured evidence only. If the Notion page already contains official RT/Metacritic URLs in URL/text fields or `Developer Memo`, `node tools/notion-critic-rating-enrichment.mjs --page-id <page>` can reuse those URLs automatically after normalizing review/detail suffixes. If IMDb ID exists, run `scripts/critic-rating-inspect.mjs --imdb-id <ttid> --discover-only` to discover Rotten Tomatoes/Metacritic official page URLs through Wikidata external IDs. If Wikidata lacks those IDs, or only one critic site is discovered, continue with official search discovery from the work title/year; in page mode use `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --discover-search`, which carries the page title/year even when IMDb ID exists. If official-site search is blocked or incomplete, run `scripts/critic-rating-inspect.mjs --url-hints <search-result-html-or-text> --search-only` or the Notion wrapper equivalent to extract official detail-page candidates from browser/search-result text. Search candidates and URL hints are only discovery; verify title/year/scope, then parse the confirmed page with `--rotten-url` or `--metacritic-url`. Rotten Tomatoes official parsing accepts `media-scorecard-json`, `<score-board>`, and official JSON-LD `AggregateRating`. A user-provided official URL, saved official-page HTML, or trusted licensed/manual structured JSON is also acceptable evidence when identity and scope are recorded; run it through `--ratings-json` and require source labels like `licensed-source:<name>` or `manual-evidence:<name>`. When parsing saved HTML, pass `--rotten-source-url`, `--metacritic-source-url`, or `--imdb-source-url`, or keep the official URLs in `Developer Memo` so the evidence memo records the original official page. Apply values with `node tools/notion-critic-rating-enrichment.mjs --page-id <page> ...` only after identity verification; otherwise leave fields blank and set/keep `Needs Review`. Preserve the official page URL in the evidence memo or JSON so later search-index runs can expose it as `externalIds.rottenTomatoes` or `externalIds.metacritic`, and so later enrichment passes can parse the official page without manual CLI URL entry.
- Treat Rotten Tomatoes, Metacritic, and IMDb Metascore retrieval as independent lanes. A 404, timeout, rate limit, or parse failure from one lane must be recorded in structured `errors` but must not discard a valid score obtained from another lane.
- TMDb: TMDB ID/URL, localized titles, original title, release disambiguation, poster/credit support, title checks.
- IMDb: identity and disambiguation support.
- AI: minimum age suggestion, family viewing notes, local editorial summary, advisory labels.

## Critic Rating Evidence Order

| Field | Evidence order | Never use |
|---|---|---|
| `烂番茄新鲜度` | OMDb Rotten Tomatoes rating; confirmed Rotten Tomatoes official page from Wikidata ID, user URL, saved official-page HTML, official title/year search candidate, generic official URL hint, or manually confirmed official URL; trusted `--ratings-json` licensed/manual structured evidence with URL/date | IMDb page, AI guesses, search snippets, URL hint snippets, mirrors, Wikipedia summaries, unmatched title pages |
| `Metascore` | OMDb Metascore; confirmed Metacritic official page from Wikidata ID, user URL, saved official-page HTML, official title/year search candidate, generic official URL hint, or manually confirmed official URL; IMDb official title-page Metascore for the same work/season; trusted `--ratings-json` licensed/manual structured evidence with URL/date | AI guesses, search snippets, URL hint snippets, mirrors, Wikipedia summaries, mixed work/season scopes |

Record the source in the report/memo with a stable label such as `omdb`, `rotten-tomatoes-page`, `metacritic-page`, `imdb-page-metascore`, `licensed-source:<name>`, or `manual-evidence:<name>`. Saved HTML is evidence only when it came from the official URL and the captured page identity is visible; attach that official URL through `--*-source-url`, an existing memo URL, or trusted JSON. `--ratings-json` is the fallback container for structured licensed/manual values; it is not a way to bypass identity checks. When an official RT or Metacritic URL is known, keep the absolute URL rather than only a guessed slug; Notion source parsing recognizes those URLs and the frontend can use them for direct rating links.

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
- Rotten Tomatoes and Metacritic direct-page fallbacks are page-level and markup-dependent. Record the source URL and observed date in the report or memo. Use Wikidata only to discover official page IDs/URLs, not as a score source. If Wikidata has no critic-site ID or discovers only one site, official-site search may be used for candidate discovery; `--discover-search` can parse official search result pages into candidate official URLs, but the search-page score snippets remain non-evidence. If official search is unusable, `--url-hints` can parse generic browser/search-result text for official RT/Metacritic detail-page URLs only; those hints remain non-evidence until the confirmed official page is parsed. If official pages change visible markup, try the official page's JSON-LD `AggregateRating` before considering the page unparseable. Prefer saved official HTML, `--ratings-json` from trusted exports/manual verification, and parser updates over non-official mirrors. Do not use random mirrors, AI-generated guesses, Wikipedia summaries, or unverified title-search hits as rating sources.
- The website index can extract official `rottentomatoes.com/m/...`, `rottentomatoes.com/tv/...`, `metacritic.com/movie/...`, and `metacritic.com/tv/...` URLs from Notion text and developer memo fields. This is for exact external links and source traceability; it does not make a search snippet or unparsed page a valid score source.
- IMDb-page Metascore is acceptable only as a Metascore fallback when the official IMDb title page clearly displays it for the same work/season. It is not a Rotten Tomatoes fallback.
- For newly released or still-airing works, critic-site coverage may lag or be season-specific. Prefer the work/season page matching the Notion work scope; if only episode-level or ambiguous pages exist, keep the field empty and set/keep `Needs Review` rather than collapsing different scopes into one score.
- Douban search/suggest can be unstable or challenged. Prefer explicit Subject ID when available or when same-title ambiguity exists.
- TMDb localized metadata requires TMDb credentials. Without a key, a unique Wikidata `P4947`/`P4983` mapping from a verified IMDb ID may fill only TMDb ID/URL; localized titles, posters, credits, and other TMDb fields remain unfilled rather than fabricated.
- Do not invent external facts. If a field cannot be sourced, leave it blank or mark uncertainty.
