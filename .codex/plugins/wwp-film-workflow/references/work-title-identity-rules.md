# Work Title And Identity Rules

## Canonical Title

Use the complete Douban display title when a verified Douban subject exists. Preserve its Chinese title, displayed original/foreign title, and release year. If Douban has no subject, use a verified authoritative source such as the official work page, IMDb/TMDb, or Wikipedia and compose `Chinese title Foreign/original title (year)`.

Do not leave a work title as Chinese-only, foreign-only, yearless, a filename, or a temporary production label when sourced identity is available. Series season pages include the season label and that season's release year.

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
