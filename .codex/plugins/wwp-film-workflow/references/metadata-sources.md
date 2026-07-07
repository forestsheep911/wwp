# WWP Metadata Sources

This reference covers work-level metadata. Media Assets covers media-file/spec metadata.

## Order of Operations

1. Inspect existing Notion fields and page text.
2. Parse old Douban-style basic-info text when present.
3. Use existing IDs first: Douban Subject ID, IMDb ID, TMDb ID.
4. Fetch missing fields from the most appropriate external source.
5. Use AI only for generated/advisory fields.
6. Apply conservatively and verify readback.

## Old Data Cleanup

When older entries contain plain Douban-style text, parse and normalize fields such as directors, writers, cast, genre, country/region, language, release dates, runtime, AKA, and IMDb. Remove links and truncate oversized cast lists for schema hygiene while preserving evidence in report output.

## Source Split

- Douban: Chinese title, Douban ID/URL, Douban rating, Chinese summary, poster, Chinese basic info, AKA, country/region, language.
- OMDb: IMDb ID, IMDb rating, Metascore, Rotten Tomatoes, Rated, English credits, box office, runtime.
- TMDb/IMDb: auxiliary IDs, release disambiguation, poster/credit support, title checks.
- AI: minimum age suggestion, family viewing notes, local editorial summary, advisory labels.

## Quotas and Stability

- OMDb daily quota is limited; batch cautiously, reuse IDs, and avoid speculative calls.
- Douban search/suggest can be unstable or challenged. Prefer explicit Subject ID when available or when same-title ambiguity exists.
- Do not invent external facts. If a field cannot be sourced, leave it blank or mark uncertainty.
