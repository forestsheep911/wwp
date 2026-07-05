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

Work-level metadata is not enough for playback. Each playable spec and each
source/original-disc package should also become self-describing.

The dedicated asset database is `Media Assets`:

- `NOTION_MEDIA_ASSETS_DATABASE_ID=9bacb469-eff7-4c92-80bd-8db16838f2e2`
- `NOTION_MEDIA_ASSETS_DATA_SOURCE_ID=5d2f4cad-caca-43eb-9b0a-99bede43bd8d`
- It has a single-property `Work` relation to the main library data source
  `7eced5e7-83de-492f-80f8-31eecd5679b0`.

Use one `Media Assets` row per playable video, episode video, source archive,
original-disc package, subtitle package, or extra. The structured fields to
preserve per asset are edition/version, audio tracks, subtitle tracks,
container, resolution, codec, file size, encode-quality tag, source lineage,
verification status, website visibility, original filename/URL, and operator
notes. Asset rows should also keep `Source Page ID` and `Media Block ID` when
they are migrated from the old nested page/block structure.

The API may parse conservative `MediaVariant.metadata` from old spec titles and
filenames, but that is a migration aid. New cleaned data should store the same
facts explicitly in Notion so the website does not have to infer them from
human-written labels.

Use the guarded writer for representative rows before any bulk migration:

```bash
npm run notion:asset-write -- --query "风之谷" --max-assets 3
npm run notion:asset-write -- --query "风之谷" --max-assets 3 --apply
```

The writer is idempotent for the same work/source page/media block and creates
rows only when `--apply` is present.

For broader batches, prefer a manifest over title queries:

```bash
npm run notion:asset-batch -- --output .local-data/media-assets-batch.json --max-items 50
npm run notion:asset-write -- --batch-manifest .local-data/media-assets-batch.json --report .local-data/media-assets-batch-preview.json
npm run notion:asset-write -- --batch-manifest .local-data/media-assets-batch.json --apply --report .local-data/media-assets-batch-apply.json
```

Manifest entries are guarded by `expectedTitleContains` so broad-title mistakes
such as matching a sequel/prequel are skipped before any write. See
`tools/notion-media-assets-batch.example.json` for the structure. The generator
is read-only and excludes works that already have Media Assets rows unless
`--include-existing` is passed.

Use `--exclude-preview <previous-preview.json>` on the generator to skip pages
that a prior preview already proved empty, title-mismatched, or too issue-heavy
for automatic migration.

Subtitle-only groups under the old `基地` structure should become
`subtitle_package` asset rows. Do not collapse them into `source_archive`.

Asset titles have limited trust. A spec/source page title without a real media
block is `untrusted_title_only`, even if it does not use `【仅供下载】` or
`【敬请期待】`. Do not sync it as playable, do not create a verified asset from it,
and do not let it appear on the website as a playable option. Use
`Media Availability`, `Playback Verified`, `Hide from Website`, and
`Developer Memo` to record the real state.

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
