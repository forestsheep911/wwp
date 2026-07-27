# Work Title And Identity Rules

## Canonical Title

Use the complete Douban display title when a verified Douban subject exists. The title shown in the Douban page heading is authoritative for the library title, including its displayed Chinese and foreign/original title and release year. Do not reconstruct a longer title by concatenating structured title fields when those fields contain a subtitle, plot phrase, edition label, or AKA. Store such extra text in aliases, basic information, or source evidence instead. If Douban has no subject, use a verified authoritative source such as the official work page, IMDb/TMDb, or Wikipedia and compose `Chinese title Foreign/original title (year)`.

Do not leave a work title as Chinese-only, foreign-only, yearless, a filename, or a temporary production label when sourced identity is available. Series season pages include the season label and that season's release year.

For a series whose verified source identifies one canonical run rather than distinct seasons, keep one series title and do not create a parallel `第一季` or `本传` naming branch. When the existing Notion page is explicitly a season page with episode children, preserve that season label during metadata normalization even if the external source heading omits it. Distinct related films, prequels, side stories, and specials remain separate work pages when their Douban/IMDb/TMDb IDs or runtime differ.

During metadata backfill, a page with a verified Douban, IMDb, or TMDb identity may have an incomplete title rebuilt from its structured Chinese title, English/original title, and release year. Auto-repair is allowed only when the current title already contains at least one of those verified title components and does not contain a conflicting year. If an existing complete title conflicts with the structured identity, do not overwrite it; set `Needs Review` and preserve both sides as review evidence.

When a verified Douban subject is available, metadata backfill must first parse and use the Douban display heading. Structured `Simplified Chinese Title` and `Original Title` are supporting metadata, not permission to append every subtitle or alternate title to the page title. A title correction must also update those fields when they are demonstrably carrying the wrong subtitle-bearing identity, and the correction should be recorded for review.

After an exact Notion title correction, update the matching SQLite work identity with `film-ledger.mjs rename-work` and an `--expected-current` guard. Notion and the local ledger must not retain different canonical titles for the same page ID.

## Creation Preflight

Before creating any work page:

1. Build aliases from the proposed Chinese title, English title, original title, regional titles, source-directory name, filename title, known AKA values, and temporary/legacy titles.
2. Normalize punctuation, spaces, `Season N`, `SNN`, and `第N季` for comparison, but retain the unmodified evidence.
3. Search existing works using every alias, with and without the year. Search exact Douban, IMDb, TMDb, and WW Work IDs whenever available.
4. Inspect all candidates before creating. Exact external-ID matches block creation. Alias matches with the same year/season block creation. Alias matches without reliable year become `Needs Review`; they do not authorize a new page.
5. Reuse and repair the existing work page. A weak, Chinese-only, yearless, hidden, or temporary title is still an existing work, not permission to create another one.

Run the executable preflight before creation:

```powershell
node tools/notion-work-identity-preflight.mjs --title "<proposed title>" --year <year> --chinese-title "<Chinese>" --english-title "<English>" --original-title "<original>" --alias "<source/filename alias>" --imdb-id <ttid> --douban-id <id>
```

Exit code `2` means one or more existing candidates were found and creation must stop for inspection/reuse.

## Duplicate Repair

Do not archive a duplicate until child pages, uploaded media blocks, Media Assets relations, and website visibility have been compared. Choose the page with the strongest structure and identity as canonical, migrate or intentionally retire dependent assets, verify readback, then archive the redundant page. When API limitations prevent a safe merge, hide and mark the redundant page `Needs Review` with an explicit pending-merge title instead of deleting playback evidence.
