# Notion Metadata Maintenance

This tool upgrades the Notion movie library from hand-written page metadata into structured fields that the site can sync safely.

## Data Ownership

- Notion remains the human-readable library and display surface.
- The site catalog/search index remains the structured runtime store.
- The shared identity fields are `WW Work ID`, `IMDb ID`, `Douban Subject ID`, and `TMDB ID`.

## Title Field Model

Structured title metadata should distinguish language and market, not collapse
everything into one Chinese title:

- `Simplified Chinese Title`: mainland/simplified Chinese display title.
- `Traditional Chinese Title (Taiwan)`: Taiwan traditional Chinese release or
  common title.
- `Traditional Chinese Title (Hong Kong)`: Hong Kong traditional Chinese
  release or common title. This may differ from the Taiwan title.
- `English Title`: English release/common title.
- `Original Title`: native-language title for the work. For an Italian film,
  this should be the Italian title; for a Japanese film, the Japanese title;
  for an English-language film, repeating the English title is acceptable.
- `Chinese Title`: legacy compatibility field. Keep it while older scripts and
  existing Notion rows still use it, but new sync logic should prefer the
  specific simplified/traditional fields above.

Do not force completeness. Title sources will be mixed: Douban may be strongest
for simplified Chinese, TMDb/IMDb/OMDb may cover English and original titles,
Taiwan/Hong Kong titles may require regional release data or manual review. If
the native-language title duplicates one of the localized fields, keep the
duplicate; the fields answer different questions.

For runtime display, prefer `Simplified Chinese Title`, then legacy
`Chinese Title`, then Taiwan/Hong Kong traditional titles, then the Notion page
title. For matching/search, index all title fields as aliases.

`【敬请期待】` at the start of a Notion page title is an operator/status marker
for unfinished rows and waiting views. `【仅供下载】` marks rows where only source
materials or downloadable archives exist and a browser-playable version has not
been produced yet. Neither prefix is part of the work title. Website sync should
strip them from display/search results.

Only remove `【仅供下载】` from the Notion page title after a playable version is
actually produced, uploaded, and verified. Source-only uploads should preserve
the marker so the dedicated Notion view can continue to route operators to
download-only backlog items.

Prefer structured fields over title prefixes for new data:

- `Media Availability` is the operational media state. Use `source_only` for
  rows that currently only have original/source/download material and no
  verified browser-playable file. Other intended values are `playable`,
  `needs_processing`, `blocked`, and `unknown`.
- `Developer Memo` is an internal operator note. Use it for resource traits,
  missing subtitles, bad source quality, failed transcode/remux notes, suspected
  tooling mistakes, and future processing plans. Do not rely on this field for
  public website copy.

## Website Visibility Control

Use `Hide from Website` as the emergency visibility switch.

- It is a checkbox managed field in Notion.
- Unchecked or missing means the row is eligible for normal website sync.
- Checked means the row should not appear on the website. Metadata sync skips
  parsing that page and deletes the existing search-index entry for
  `notion-page-<pageId>` when it sees the edited page.
- This field is intentionally negative rather than `Sync to Website`: a new
  Notion checkbox defaults to unchecked, so the negative field keeps all
  existing rows visible until an operator explicitly hides one.

Use it when a page is temporarily wrong, unsuitable, legally questionable, or
otherwise should be pulled from the family-facing site before the underlying
metadata or media structure is fully repaired.

## Tokens

- `NOTION_READ_ONLY_TOKEN` is used by dry-runs and deployed read sync.
- `NOTION_WRITE_TOKEN` is preferred for local write-back.
- `NOTION_TOKEN` is accepted as a legacy local write token.

Local CLI runs load the repository `.env` with override enabled, so project-specific Notion tokens and page IDs win over machine-level environment variables.

For `--apply`, the write integration must be shared with the target Notion library database or a parent page that contains it.

## Safe Workflow

1. Preview current coverage:

   ```bash
   npm run notion:metadata -- --limit=2000 --block-depth=1 --block-limit=120 --report=.local-data/notion-metadata-dryrun-full.json
   ```

2. Add the managed schema only:

   ```bash
   npm run notion:metadata -- --apply --schema-only --report=.local-data/notion-metadata-schema-apply.json
   ```

3. Verify one known page:

   ```bash
   npm run notion:metadata -- --apply --page-url=https://wwpdw.notion.site/Citizen-Kane-1941-7fd72dd225f241d68fb2c984f0902ed0 --report=.local-data/notion-metadata-citizen-kane-apply.json
   ```

4. Write only pages with a parsed external ID:

   ```bash
   npm run notion:metadata -- --apply --limit=2000 --only-with-external-ids --report=.local-data/notion-metadata-apply-full.json
   ```

5. Run metadata sync so the site sees the structured fields:

   ```bash
   npm run sync:meta --workspace @wwpdw/api -- --mode=full
   ```

## Current Baseline

The latest full dry-run scanned 1132 Notion pages:

- 1119 pages already expose IMDb/Douban/TMDB IDs in existing page content.
- 13 pages have no parsed external ID.
- 0 conflicts were detected.
- Before the title split, 30 managed Notion properties were tracked. The
  identity/display/quality schema was first added on 2026-07-02, and box office
  fields were added on 2026-07-03.
- The title split adds
  `Simplified Chinese Title`, `Traditional Chinese Title (Taiwan)`, and
  `Traditional Chinese Title (Hong Kong)`. Run schema-only apply before relying
  on these fields in Notion writes.
- `Hide from Website` adds a manual website downline switch. Run schema-only
  apply before using it in Notion.
- A gated write-back on 2026-07-02 applied structured metadata to 1118 pages with parsed external IDs and skipped the 13 pages without external IDs.

The current full report is:

```text
.local-data/notion-metadata-apply-full.json
```
