# OMDb enrichment notes

OMDb is planned as website-side metadata enrichment, not as a Notion write-back source.

## Current repository support

- `.env.example` declares `OMDB_API_KEY`.
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
