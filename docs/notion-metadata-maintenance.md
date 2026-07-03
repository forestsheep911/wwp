# Notion Metadata Maintenance

This tool upgrades the Notion movie library from hand-written page metadata into structured fields that the site can sync safely.

## Data Ownership

- Notion remains the human-readable library and display surface.
- The site catalog/search index remains the structured runtime store.
- The shared identity fields are `WW Work ID`, `IMDb ID`, `Douban Subject ID`, and `TMDB ID`.

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
- 30 managed Notion properties are tracked. The identity/display/quality schema was first added on 2026-07-02, and box office fields were added on 2026-07-03; the current schema check reports 0 missing managed properties.
- A gated write-back on 2026-07-02 applied structured metadata to 1118 pages with parsed external IDs and skipped the 13 pages without external IDs.

The current full report is:

```text
.local-data/notion-metadata-apply-full.json
```
