# OMDb enrichment notes

OMDb is used as a conservative metadata enrichment source. The Notion write-back tool only fills empty managed fields and should be run in small batches first.

## Current repository support

- `.env.example` declares `OMDB_API_KEY`.
- `npm run notion:omdb -- --limit=30 --max-updates=5` previews a small Notion write-back batch.
- Add `--apply` only after reviewing the dry-run report.
- `MovieMetadata.external.omdb` stores OMDb-derived fields.
- `MovieMetadata.externalIds.imdb` gives future enrichment code a stable lookup key.
- The search index includes OMDb fields in searchable text once they are present.

## Useful OMDb fields

- Ratings: `Ratings`, `imdbRating`, `imdbVotes`, `Metascore`
- Viewing filters: `Rated`, `Runtime`, `Genre`, `Language`, `Country`
- Detail page context: `Plot`, `Awards`, `BoxOffice`, `Production`
- Posters: `Poster`, as a fallback when Notion has no poster
- Series metadata: `totalSeasons`, plus episode fields when querying episodes

OMDb has `BoxOffice`, but not reliable production budget data.

## Integration rule

Do not call OMDb from the user-facing search path. Use metadata sync or a slow admin backfill, cache by IMDb id, and merge with Notion metadata before writing the search index.

The Notion write-back path defaults to OMDb `Type=movie` and skips `series`/`episode` rows. Use `--include-non-movies` only after designing separate series/season rules.

`Rated` maps to the existing Notion `分级` multi-select. `Not Rated`, `Unrated`,
and `N/A` are normalized to `未分级`; values such as `G`, `PG`, `PG-13`, `R`,
`NC-17`, `TV-14`, and `TV-MA` are written directly when the field is empty.
This official/country-specific rating is only one input for the custom family
age fields. Do not treat it as the final child-viewing decision when
`AI建议最低年龄` or `人工年龄覆盖` is available.

Preferred source precedence:

1. Notion manual metadata
2. Cached OMDb enrichment for missing or secondary fields
3. OMDb poster only when Notion has no poster

## Quota rule

Free OMDb keys are limited. Treat each enrichment run as quota-budgeted work:

- Look up by `imdbId` first.
- Skip rows without `imdbId` unless a manual backfill explicitly allows title/year matching.
- Cache `notFound` results to avoid repeated misses.
- Keep daily requests below the real OMDb limit with a configurable budget.
