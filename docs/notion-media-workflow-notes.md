# Notion Media Workflow Notes

This document records the emerging operator rules for maintaining the Boccaro
Notion media library. Older entries were created manually, so formatting is not
fully uniform yet. Prefer learning from the current page shape first, then make
small normalizing edits only where the target page clearly uses placeholders.

## Page Layout Rules

Movie rows:

```text
movie page
  -> callout
    -> spec child page
      -> video block
divider
基地
  -> 片源
    -> size child page
      -> source/archive file blocks
  -> 字幕
    -> subtitle file blocks
```

TV season rows:

```text
season page
  -> callout
    -> spec child page
      -> Episode 01
        -> video block
      -> Episode 02
        -> video block
      ...
divider
基地
  -> 片源
    -> size child page
      -> source/archive file blocks
```

The `callout -> spec child page` area is for playable transcoded outputs. The
`基地 -> 片源` area is for source material, remuxes, raw encode inputs, or
archives that are not the normal browser-playable family-facing version.

TV seasons have one more structural layer than movies because the playable
variants are grouped by episode. The website parser follows
`season -> spec page -> episode page -> video/file` and can normalize visible
episode labels to `Episode NN` when the episode number is parseable. Legacy
manual Notion data may still contain inconsistent episode child-page titles; do
a read-only audit before renaming those pages in bulk.

## Placeholder Pages

Some pages contain pre-created child pages with duplicate or generic titles.
Treat these as placeholders, not as final labels. After attaching the video,
rename the spec page to match the actual file:

- `chs` -> `简`
- `cht` -> `繁`
- `chseng` or `chs&eng` -> `简英`
- `chteng` or `cht&eng` -> `繁英`
- `chschteng` / mixed simplified-traditional-English forms -> `繁简英`

For movies, include the local title and size when that matches the surrounding
library style:

```text
超级马力欧兄弟大电影 简 3.84GB
超级马力欧兄弟大电影 简英 2.93GB
```

For TV seasons, the spec page title is often just the subtitle/audio label:

```text
繁
繁简英
纸牌屋 第六季 繁简英
```

Do not infer from the placeholder title alone. Inspect the actual uploaded or
local file names first.

Title text is never proof that media exists. A spec child page may have an old
hand-written label like `繁简英 1080p h265 GB`, or even a nearly empty/generic
title, while containing no playable `video` or `file` block. If that happens:

- Do not create a `playable_video` asset row from the title alone.
- Do not show it on the website as a playable variant.
- Treat the title as `untrusted_title_only` until a real media block exists or
  a `Media Assets` row is explicitly created and verified.
- If the work has source files but no playable output, mark the work/asset as
  `Media Availability = source_only` or `needs_processing` and use `Developer
  Memo` to explain the gap.
- If it is just a stale placeholder, rename, delete, or hide it during cleanup.

## Media Spec Metadata

Playable spec pages should eventually be self-describing. Older rows encode too
much in the child-page title, for example:

- Titanic mixes `Open Matte`, subtitle language, audio/commentary tracks,
  resolution, codec, CQ/ICQ quality tags, and size across many spec pages.
- Nausicaa, Kung Fu Panda 3, Avatar, The Dark Knight, and Spirited Away use a
  mix of subtitle tags, dubbing language, codec, size, and sometimes regional
  traditional subtitle hints such as Taiwan/Hong Kong.
- Blade Runner source/original-disc details are often visible only in filenames,
  not in the spec page title.
- Some old spec pages have title metadata but no video block yet, so the title
  cannot be treated as proof that a playable asset exists.

Keep the current title as a compact human label, but do not make it the only
source of truth. A playable video spec should be able to carry:

- Availability: playable, source-only, needs-processing, blocked, unknown.
- Edition/version/cut: theatrical, extended, final cut, open matte, IMAX, etc.
- Video basics: container, resolution, codec, HDR/SDR if known, approximate
  file size, CQ/ICQ/CRF or similar encode-quality tag.
- Audio tracks: original language, Mandarin, Cantonese, Japanese, English,
  commentary, and notable dubbing source such as theatrical or regional dub.
- Subtitle tracks: simplified Chinese, Taiwan traditional, Hong Kong
  traditional, English, Japanese, none, burned-in vs selectable if known.
- Source lineage: generated encode, remux, Blu-ray/UHD Blu-ray, WEB-DL, ISO,
  original-disc archive, and whether it came from a repaired/problem source.
- Operator notes: what was verified, what is missing, and what should be
  reprocessed later.

Short-term, the website can parse conservative metadata from the spec title and
video filename into `MediaVariant.metadata`. That is useful for search and
future display, but it is still a fallback. For new uploads, prefer writing a
small structured metadata block at the top of each playable spec page, before
the video block.

For newly encoded, remuxed, or reprocessed files, do not rely on title parsing
as the primary metadata source. Run `ffprobe` on the final local media file
before Notion writeback and write the probed facts into `Media Assets` where
possible: container, duration, resolution, video codec/profile, HDR/SDR signal
when present, frame rate, audio codec/channel layout/languages when tags exist,
subtitle stream languages, and exact byte size. Old rows can be migrated from
titles and filenames as a fallback, but new or reprocessed playable files should
be self-contained enough for the website to display variant details without
guessing. Future upload/package helpers should treat this probe-and-writeback
step as normal production work, not as a later cleanup pass.

Long-term asset tracking now has a dedicated `Media Assets` database under the
same Notion project root. Each playable variant, episode file, and
source/original-disc package can have real Notion properties instead of
page-title parsing. This should become the target for bulk cleanup, website
display, and source-to-playable production planning.

Local `.env` records both the main library IDs and the new asset database IDs so
tools do not need to enumerate the root page first.

Before writing asset rows, run the read-only audit:

```powershell
node tools\notion-media-assets-audit.mjs --report .local-data\notion-media-assets-audit.json
```

For a small guarded write trial, use the Media Assets writer. It defaults to
dry-run and only creates rows with `--apply`:

```powershell
node tools\notion-media-assets-write.mjs --query "风之谷" --max-assets 3 --report .local-data\notion-media-assets-write-preview.json
node tools\notion-media-assets-write.mjs --query "风之谷" --max-assets 3 --apply --report .local-data\notion-media-assets-write-apply.json
```

The writer records `Source Page ID` and `Media Block ID` on each asset row so a
future migration can trace the structured asset back to the old Notion media
tree. It also skips an existing row when the same work/source/block has already
been written.

When producing new playable files, the upload/writeback helper should run
`ffprobe` against the final local file and persist the measured facts into
`Media Assets` instead of leaving the website to infer everything from human
titles. Record at least container, duration, exact byte size, resolution, frame
rate, video codec/profile, HDR/SDR signal when present, audio codec/channel
layout/language tags, and subtitle stream language tags. Old rows can still be
bootstrapped from titles and filenames during cleanup, but any newly encoded,
remuxed, repaired, or re-uploaded asset should be self-contained enough for the
website to display variant details without guessing.

For larger migrations, use a batch manifest instead of title queries:

```powershell
node tools\notion-media-assets-generate-batch.mjs --output .local-data\media-assets-batch.json --max-items 50
node tools\notion-media-assets-write.mjs --batch-manifest .local-data\media-assets-batch.json --report .local-data\media-assets-batch-preview.json
node tools\notion-media-assets-filter-batch.mjs --manifest .local-data\media-assets-batch.json --preview .local-data\media-assets-batch-preview.json --output .local-data\media-assets-batch-low-risk.json
node tools\notion-media-assets-write.mjs --batch-manifest .local-data\media-assets-batch-low-risk.json --report .local-data\media-assets-batch-low-risk-preview.json
node tools\notion-media-assets-write.mjs --batch-manifest .local-data\media-assets-batch-low-risk.json --apply --report .local-data\media-assets-batch-low-risk-apply.json
node tools\notion-media-assets-write.mjs --batch-manifest .local-data\media-assets-batch-low-risk.json --apply --report .local-data\media-assets-batch-low-risk-rerun.json
node tools\notion-media-assets-stats.mjs --report .local-data\media-assets-stats.json
```

The filter step is local-only. It keeps pages whose writer dry-run says there is
at least one row to create, no title mismatch, at most one issue, and at most
three selected assets. It also excludes series-looking titles by default and
requires single-asset pages to have a year or multilingual/native title signal.

Each manifest item must use a Notion `pageId` and should include
`expectedTitleContains`. If the retrieved page title does not contain every
expected fragment, that item is skipped and nothing is written. Use
`allowedAssetTypes` to keep a batch limited to low-risk asset classes. The
generator excludes existing Media Assets works, duplicate main-library titles
already covered by Media Assets, leading full-width bracket operator/status
prefixes such as `【敬请期待】`, `【仅供下载】`, or `【缺】`, and TV season-looking
titles by default. It also uses the main library `影别` property when present:
broad movie batches only include movie-like rows unless `--include-series` is
explicitly passed. TV series and miniseries need the separate episode-aware
structure.

When a preview has identified empty pages or high-issue pages, feed it back into
the next generator run so the same low-value rows do not keep consuming API
time. Filtered manifest reports can also be passed to `--exclude-preview`; their
`filteredOut` pages are skipped on later generated batches:

```powershell
node tools\notion-media-assets-generate-batch.mjs --output .local-data\media-assets-next.json --exclude-preview .local-data\media-assets-batch-preview.json --exclude-preview .local-data\media-assets-batch-low-risk.json
```

The writer checks existing rows by `Media Block ID`, `Source Page ID`, filename,
and title. If Notion indexing briefly lags after a write, rerun the same manifest
after a short pause; expected steady state is `created = 0` and all selected rows
reported as `skip_existing`.

Run the stats script after broad writes. It is read-only and reports active row
counts, Work coverage, asset type/availability distribution, website hide flags,
playback verification flags, and traceability gaps such as missing
`Source Page ID`, `Media Block ID`, or Work relation.

When a generated batch reaches `items = 0`, run the local leftovers report
before relaxing any write guard:

```powershell
node tools\notion-media-assets-leftovers-report.mjs --manifest .local-data\media-assets-round-final.json --markdown .local-data\media-assets-leftovers.md
npm run notion:asset-leftovers -- .local-data\media-assets-round-final.json .local-data\media-assets-leftovers.json .local-data\media-assets-leftovers.md
```

The report groups remaining skipped pages into already-covered rows, operator
prefix rows, TV/season rows, empty placeholder pages, weak-title rows, manual
title-pattern exclusions, and other cleanup buckets. A page may still have valid
media-block candidates even when it also has empty placeholder spec/source
pages. In that case, it is safe to create Media Assets rows only for the
verified media blocks; keep the empty placeholder pages in the cleanup backlog.
If a page has no real media candidates, do not create an asset row from the
title alone.

When migrating `基地` groups, subtitle-only groups should be represented as
`subtitle_package`, not as `source_archive`.

If local DNS routes `api.notion.com` to the unstable `198.18.x.x` path, use the
known working direct resolve override:

```powershell
node tools\notion-media-assets-audit.mjs --resolve-ip 208.103.161.1
node tools\notion-media-assets-write.mjs --query "风之谷" --resolve-ip 208.103.161.1
```

## Current Upload Helpers

Playable movie files:

```powershell
node tools\notion-upload-movie-video.mjs --file "E:\video_made\movie.mp4" --apply
```

Playable TV season files:

```powershell
node tools\notion-series-structure-audit.mjs --manifest .local-data\media-assets-round-final.json --limit 20 --report .local-data\series-structure-audit.json
node tools\notion-upload-series-videos.mjs --apply
node tools\notion-upload-series-videos.mjs --apply --max-files 1
```

Run the series structure audit before designing a TV Media Assets migration. It
is read-only and checks whether the old tree follows
`season -> spec page -> episode page -> media`, whether episode titles can be
normalized to `Episode NN`, and whether specs/episodes are empty placeholders.
Do not feed TV seasons into the movie batch writer just because the audit finds
playable media; episode rows need episode-aware asset names and `Episode Number`
values.

After a clean audit, write TV episode Media Assets rows with the series writer:

```powershell
node tools\notion-media-assets-write-series.mjs --audit-report .local-data\series-structure-audit.json --max-pages 2 --max-assets 50 --report .local-data\series-assets-preview.json
node tools\notion-media-assets-write-series.mjs --audit-report .local-data\series-structure-audit.json --max-pages 2 --max-assets 50 --apply --report .local-data\series-assets-apply.json
node tools\notion-media-assets-write-series.mjs --audit-report .local-data\series-structure-audit.json --max-pages 2 --max-assets 50 --apply --report .local-data\series-assets-rerun.json
node tools\notion-media-assets-write-series.mjs --audit-report .local-data\series-structure-audit.json --skip-pages 12 --max-pages 6 --max-assets 120 --apply --report .local-data\series-assets-next.json
node tools\notion-media-assets-write-series.mjs --audit-report .local-data\series-structure-audit.json --include-direct-spec --max-pages 1 --max-assets 20 --report .local-data\series-direct-spec-preview.json
node tools\notion-media-assets-stats.mjs --report .local-data\media-assets-stats-after-series.json
```

The series writer only creates rows for real playable media blocks inside
episode child pages. It sets `Episode Number`, keeps `Hide from Website`
unchecked for playable rows, and records the episode page as `Source Page ID`
plus the video/file block as `Media Block ID`. Direct media attached to the spec
page is reported as `direct_spec_media_not_written` for a later normalization
pass.

When parsing legacy filenames, prefer the actual media filename for technical
fields such as resolution and video codec, then fall back to the spec title only
when the filename has no signal. Spec titles can be stale or contradictory; for
example `太平洋战争` had spec-page titles saying h265 while the actual filenames
said h264. This is still only a migration fallback; new production should use
`ffprobe`.

For legacy pages where playable files sit directly under a spec page, use
`--include-direct-spec` only after checking a dry-run. The writer then parses
`Episode Number` from the media title or filename, such as `S02E01`; it does not
guess from block order. Unparseable direct media and duplicate parsed episode
numbers are reported as issues and are not written.

The first 2026-07-05 sample audit of 20 non-prefixed TV rows found mixed legacy
shapes: 19 pages had an episode layer, 10 pages already had playable media under
episode pages, 10 pages had empty episode placeholders, and one page (`辐射 第二季`)
had playable videos directly under the spec page instead of episode child pages.
All sampled episode titles were parseable to `Episode NN`. A future TV migration
should therefore handle both standard episode pages and direct spec-page media,
but should keep empty episode placeholders as cleanup/backlog rather than
creating playable assets from their titles.

The first TV Media Assets write pass on 2026-07-05 used the series writer on a
40-row non-prefixed TV audit sample. It created 202 episode-level playable rows
across standard episode-page structures, including `铁拳教育 第一季`,
`葬送的芙莉莲`, `中国奇谭`, `许愿吧，精灵`, `纸牌屋` seasons 1-6,
`big bang 2`, `生活大爆炸 第一季`, and `蜗居`. The rerun reported all 202 as
`skip_existing`. Post-write stats showed 2301 active Media Assets rows and zero
missing `Source Page ID`, `Media Block ID`, or Work relation. The 13 remaining
issues in that pass were empty episode placeholders under `许愿吧，精灵`.

The follow-up 80-row non-prefixed TV audit sample found 485 playable media
blocks under standard episode child pages and 14 direct spec-page media blocks.
The series writer created all 485 standard episode rows by the end of the
2026-07-05 pass; rerun reported all 485 as `skip_existing`. Post-write stats
showed 2584 active Media Assets rows, 842 covered works, and zero missing
`Source Page ID`, `Media Block ID`, or Work relation. Direct spec-page media
remains intentionally unwritten until a normalization pass decides whether to
move or map those blocks into episode pages.

A larger follow-up on 2026-07-06 used
`.local-data/notion-series-structure-audit-2026-07-06-remaining80.json` and
finished every automatically safe page in that audit. It created 157 rows in
the first batch, then 21 Rick and Morty rows, 78 Better Call Saul season 1-4
rows, 91 mixed TV rows, and 85 final safe rows. Each apply was rerun and
reported only `skip_existing` for the written rows. Final stats after this pass
showed 3016 active Media Assets rows, 872 covered works, 2389 playable rows,
627 source-only rows, and zero missing `Source Page ID`, `Media Block ID`, or
Work relation.

The series writer now supports `--skip-pages` because large follow-up batches
should not rescan already written TV pages. The option skips over the filtered
safe page list from the audit report, not raw Notion pages. Use it only after a
prior apply plus rerun has confirmed the earlier safe pages are already covered.
For operator-prefixed series pages, the writer strips leading full-width Notion
status markers such as `【敬请期待】` from the generated Media Assets `Name`. The
Work relation still points to the original Notion page, but website-facing asset
labels should not inherit operator/backlog markers.

After the safe pass, a fresh broad batch still produced `items: 0`. The
leftovers report counted 259 uncovered main-library pages: 180 operator/status
prefixed pages, 57 series pages, 13 no-media placeholders, 6 no-write pages, 2
weak-title pages, and 1 manually excluded title-pattern page. A fresh 20-page
series audit after the safe pass found no playable episode media in that sample:
most pages were empty episode shells, and `辐射 第二季` still had playable media
directly under a spec page instead of the episode layer. These are now manual
structure cleanup or direct-spec normalization work, not standard automatic
episode writes.

The first direct-spec normalization pass handled `辐射 第二季` because all 8
files were named with parseable `S02E01`-style episode markers. Dry-run reported
8 `would_create` rows and zero issues; apply created 8 rows; rerun reported 8
`skip_existing`. Stats after this pass showed 3024 active Media Assets rows,
873 covered works, 2397 playable rows, 627 source-only rows, and zero missing
`Source Page ID`, `Media Block ID`, or Work relation. A fresh leftovers report
then showed 258 uncovered pages, including 56 remaining series pages.

The remaining series scan was then chunked with `--skip-targets` on the read-only
series audit. The first two chunks after the safe/direct pass contained only
empty episode shells or empty specs. The final chunk still contained playable
media: standard episode rows for `绝命毒师` seasons 1-4, `间谍过家家 第二季`,
and `爱，死亡和机器人 第一季`, plus direct spec media for `太平洋战争`. The standard
writer created 85 rows and reran as 85 `skip_existing`; the direct-spec writer
created 10 rows for `太平洋战争` and reran as 10 `skip_existing`. Stats after this
pass showed 3119 active Media Assets rows, 880 covered works, 2492 playable
rows, 627 source-only rows, and zero missing `Source Page ID`, `Media Block ID`,
or Work relation. A fresh leftovers report then showed 251 uncovered pages,
including 49 remaining series pages.

The series writer also supports `--allow-partial-episodes` for pages where some
episode rows are parseable but special/bonus rows are not. This flag keeps the
default conservative behavior unchanged, but lets a confirmed page write the
parseable episode rows while leaving unparseable rows as issues. A full leftover
series audit of those 49 pages found 48 pages without writable media: mostly 20
episode empty shells, plus one empty spec page. The only playable page was
`兄弟连`, with 42 playable episode media blocks and 2 unparseable `Episode
Specials` rows. A partial write created the 40 parseable main-episode rows,
reran as 40 `skip_existing`, and left the two specials for manual structure or
numbering decisions. Stats after this pass showed 3233 active Media Assets rows,
928 covered works, 2559 playable rows, 674 source-only rows, and zero
traceability gaps. Fresh leftovers then showed 202 uncovered pages, including 48
remaining series pages.

Source archive files:

```powershell
node tools\notion-upload-series-source.mjs --package
node tools\notion-upload-series-source.mjs --apply --upload --max-upload-files 1
```

Movie package trial uploads:

```powershell
node tools\notion-upload-movie-package.mjs --page-id <movie-page-id> --apply --upload-videos
node tools\notion-upload-movie-package.mjs --page-id <movie-page-id> --apply --upload-meta
node tools\notion-upload-movie-package.mjs --page-id <movie-page-id> --apply --upload-source --max-source-files 1
```

All helpers should use `.local-data` manifests for resumability and to avoid
re-uploading already completed files. `.local-data` is ignored by Git.

## File Upload Constraints

Notion `fileUploads` supports multipart upload, but the pending upload object has
an expiry window of roughly one hour. A large file must finish all parts and the
`complete` call before expiry.

Operational defaults that have worked:

- Use 20MiB API parts for multipart sends.
- For source archives, package video inputs with `7z a -t7z -mx=0`.
- Split source archives into volumes that can finish within the Notion expiry
  window on the current network.
- Do not upload API filenames ending in `.7z.001`; create the upload with a safe
  name like `.7z.part-001.7z`, while keeping the visible Notion block name as
  `.7z.001`.
- Existing Notion media pages may contain real `child_page` blocks directly
  inside callout/toggle sections, and older workflows used that structure.
  Reuse nested `child_page` blocks when preserving the existing hand-built
  standard layout. In the 2026-07-03 Basketball Diaries trial, Notion Public
  API rejected both `blocks.children.append` with `child_page` and `pages.create`
  with a `block_id` parent, so new API-created pages should be created directly
  under the movie page. Do not create cosmetic callouts/toggles plus
  `link_to_page`; a root-level child page is acceptable as long as recursive
  parsing can find the media files.
- In the 2026-07-03 Basketball Diaries trial, Notion displayed an uploaded
  `.7z.001` source part as `.7z.001.7z` even when the file block name was set to
  the original part name. Treat this as a current API/UI naming quirk to inspect
  before bulk source uploads.

If the network is unstable, test one file or one archive part first, then
continue only after confirming a real Notion readback.

## One-Stop Encode To Upload Direction

A future workflow can combine compression and Notion publishing:

```text
source/remux input
  -> encode/transcode
  -> validate local outputs
  -> read target Notion page
  -> normalize placeholder spec page title
  -> upload playable videos to movie spec or TV episode pages
  -> optionally package original source with 7z
  -> upload archive parts under 基地 -> 片源 -> size page
  -> read back Notion structure and manifest status
```

Prior compression work to reuse as a reference:

- Codex thread/session: `019f2065-999d-77c2-9413-27f3720ccd87`

The one-stop workflow should remain conservative: inspect the target page first,
dry-run the mapping, upload a single episode or file as a smoke test, then run
the rest.

If a movie or season page title starts with `【敬请期待】`, treat that prefix as a
Notion waiting-view marker. If it starts with `【仅供下载】`, treat it as a
download-only backlog marker: source materials or archives are present, but a
browser-playable version has not been produced or verified.

For new or cleaned data, prefer `Media Availability = source_only` instead of a
title prefix. Use `Developer Memo` to record why the row is source-only and what
would be needed to make it playable. Neither title prefix should appear on the
website. Apply-mode production helpers may remove `【敬请期待】` once the item is
actually prepared. Only remove `【仅供下载】` after a playable version has been
produced, uploaded, and verified; source-only packaging should not change the
page's backlog status.

When promoting a `【敬请期待】` page, create/verify its Media Assets rows and remove
the title prefix in the same guarded operation. Use
`notion-title-prefix-cleanup.mjs` for the title change; it defaults to dry-run
and only updates explicit page IDs whose current title starts with the expected
prefix. Do not create public playable rows while leaving the main library title
with `【敬请期待】`.

Common reasons for `【仅供下载】` rows:

- TV seasons with too many episodes to prepare manually at the time.
- Imperfect source material: missing subtitles, hard-to-understand audio, no
  high-quality disc/remux source, or an encode/remux that previously failed.
- Tooling uncertainty: some old failures may be fixable with better remux,
  subtitle, or transcode settings, so do not treat the marker as permanent.

When converting these rows later, prioritize deliberately. Many entries may
require re-downloading source material locally, producing playable files,
validating subtitles and playback, then uploading the finished outputs back to
the Notion media tree.

On 2026-07-06, `【仅供下载】` source-only rows were migrated in two safe groups.
First, 19 non-series movie pages with real source/original-disc archives were
written as `source_only`; the duplicate short-title `【仅供下载】皮克斯短片集` page
was excluded because it pointed at the same source filename as the fuller
`The Pixar Shorts Collection` page. Then 14 TV/series pages with real source
archives were written as `source_only`, including `闯关东`, `模范出租车` seasons
1-2, `德雷尔一家` seasons 1-4, `弥留之国的爱丽丝 第二季`, and `神探亨特`.
Every apply pass was rerun and reported only `skip_existing` for the written
rows. Empty playable spec placeholders on these pages did not block writing the
source archive row, but no row was created from a title-only or empty source
group.

Stats after that source-only pass showed 3152 active Media Assets rows, 913
covered works, 2492 playable rows, 660 source-only rows, and zero missing
`Source Page ID`, `Media Block ID`, or Work relation. A fresh leftovers report
then showed 217 uncovered pages: 146 operator/status-prefixed pages, 49 series
pages, 13 no-media placeholders, 6 no-write pages, 2 weak-title pages, and 1
manually excluded title-pattern page. Remaining uncovered `【仅供下载】` rows are
either empty/title-only, duplicate source-file pages, or series pages such as
`疑犯追踪` and `权力的游戏` seasons where the current audit found no real source
file block to write.

The first guarded `【敬请期待】` promotion pass on 2026-07-06 used a dry-run
manifest for non-series waiting pages, then selected only pages with real media
and zero audit issues. Seven pages qualified: `冷山`, `安娜贝尔`, `活火熔城`,
`背靠背，脸对脸`, `天地无限`, `赤胆屠龙`, and `神探`. The Media Assets writer
created 20 rows and reran as 20 `skip_existing`; the title-prefix cleanup tool
then removed `【敬请期待】` from all 7 titles and a cleanup rerun reported
`skip_prefix_absent`. Stats after this pass showed 3172 active Media Assets
rows, 920 covered works, 2505 playable rows, 667 source-only rows, and zero
missing `Source Page ID`, `Media Block ID`, or Work relation. A fresh leftovers
report then showed 210 uncovered pages, including 139 operator/status-prefixed
pages.

The next waiting-prefix chunk promoted 4 more zero-issue pages:
`百战宝枪`, `奇异世界`, `隐藏人物`, and `里斯本丸沉没`. The writer created 13
Media Assets rows, reran as 13 `skip_existing`, then title cleanup removed
`【敬请期待】` from all 4 titles and reran as `skip_prefix_absent`. Stats after
this pass showed 3185 active Media Assets rows, 924 covered works, 2514 playable
rows, 671 source-only rows, and zero traceability gaps. Fresh leftovers then
showed 206 uncovered pages, including 135 operator/status-prefixed pages.

Two subsequent waiting-prefix chunks were lower-yield. Only `无间道3：终极无间`
and `囚徒` qualified as zero-issue pages. The writer created 2 rows for
`无间道3` and 3 rows for `囚徒`; both reran as `skip_existing`, and title cleanup
removed `【敬请期待】` from both titles with `skip_prefix_absent` on rerun. Stats
after these passes showed 3190 active Media Assets rows, 926 covered works, 2517
playable rows, 673 source-only rows, and zero traceability gaps. Fresh leftovers
then showed 204 uncovered pages, including 133 operator/status-prefixed pages.

The final waiting-prefix non-series chunk promoted only `少数派报告`, creating 3
rows, rerunning as 3 `skip_existing`, and removing its `【敬请期待】` prefix. Stats
after this pass showed 3193 active Media Assets rows, 927 covered works, 2519
playable rows, 674 source-only rows, and zero traceability gaps. Fresh leftovers
then showed 203 uncovered pages, including 132 operator/status-prefixed pages.
At that point all sampled non-series waiting pages had been audited once. The
remaining waiting pages either had no candidates or had candidates plus
structure issues: 86 `playable_spec_without_media` and 56
`source_group_without_media` observations across the waiting-preview reports.
Do not promote those automatically until the empty spec/source groups are
renamed, removed, or repaired.

A later operator-prefix pass checked the remaining `【敬请期待】` non-series pages
that had not been part of the waiting-preview batches. Out of 15 dry-run pages,
only `无依之地` and `饥饿站台2` had real media with zero issues. `无依之地` needed
`maxAssets: 4` to include all detected rows. The writer created 7 rows across
those two works, reran as 7 `skip_existing`, then title cleanup removed both
waiting prefixes and reran as `skip_prefix_absent`. Pages such as
`超级马力欧兄弟大电影` still had real media but also empty source-group issues,
so they remain structure cleanup rather than automatic promotion.

The two weak-title leftovers, `乱` and `翼`, were safe after switching from
auto-generated weak title guards to explicit page IDs plus full expected-title
guards. The writer created 6 rows, reran as 6 `skip_existing`, and cleared the
weak-title bucket. Stats after these two passes showed 3246 active Media Assets
rows, 932 covered works, 2568 playable rows, 678 source-only rows, and zero
traceability gaps. Fresh leftovers then showed 198 uncovered pages: 130
operator/status-prefixed pages, 48 series pages, 13 no-media placeholders, 6
no-write pages, and 1 manually excluded title-pattern page.

A prefixed-series audit then checked all 31 remaining operator-prefixed TV-like
rows: 14 `【敬请期待】` and 17 `【仅供下载】`. Most were empty episode shells or empty
spec pages. Three `【敬请期待】` pages had complete, parseable episode media and no
issues: `绝代双骄`, `沙丘：预言 第一季`, and `最后生还者 第一季`. The series writer
created 46 playable episode rows for those pages, reran as 46 `skip_existing`,
and title cleanup removed the three waiting prefixes with a `skip_prefix_absent`
rerun. `基地 第一季` still has 8 playable rows but is explicitly missing Episode
01 and Episode 02, so it remains incomplete and should not be promoted
automatically. Stats after this pass showed 3292 active Media Assets rows, 935
covered works, 2614 playable rows, 678 source-only rows, and zero traceability
gaps. Fresh leftovers then showed 195 uncovered pages, including 127
operator/status-prefixed pages.

The final small-bucket recheck revisited 6 `noWritePages` and the one
`manualExcludedTitlePatternPages` row. The 6 no-write rows still had zero
candidates and zero issues, so they are true Notion structure/content gaps rather
than missed safe rows. `耀眼` had a real source archive plus an empty playable
placeholder. It was written as one `source_only` `source_archive` row with `Hide
from Website = true`, reran as `skip_existing`, and the empty playable spec
remains a future structure cleanup item. Stats after this pass showed 3293
active Media Assets rows, 936 covered works, 2614 playable rows, 679 source-only
rows, and zero traceability gaps. Fresh leftovers then showed 194 uncovered
pages: 127 operator/status-prefixed pages, 48 series pages, 13 no-media
placeholders, and 6 no-write pages.

The next operator source-only pass reviewed all 127 remaining operator/status
leftovers in dry-run chunks and selected only real source-only candidates:
`original_disc`, `source_archive`, or `subtitle_package`. The safe ready subset
excluded the duplicate-risk short-title `【仅供下载】皮克斯短片集` and `【缺】闪灵`
because the missing prefix needs manual semantic review. The writer created 34
hidden `source_only` rows, all with `Hide from Website = true`, and reran as 34
`skip_existing`. This pass did not remove any Notion title prefixes, because the
rows are still not verified playable website assets. Stats after the pass showed
3327 active Media Assets rows, 970 covered works, 2614 playable rows, 713
source-only rows, and zero traceability gaps. A fresh round39 batch then showed
18 ordinary manifest items but a dry-run found zero candidates; refreshed
leftovers now show 101 uncovered pages: 53 operator/status-prefixed pages and 48
series pages.

A follow-up series audit covered all 68 remaining TV-like uncovered pages,
including operator-prefixed seasons, in three chunks. It found zero playable
episode media and zero direct spec-page playable media. Most remaining TV rows
are parseable `Episode NN` shells with empty episode pages; four pages are empty
spec shells. These rows are now resource-production or structure-fill backlog,
not standard automatic Media Assets writes.

A final operator playable promotion pass then dry-ran the remaining 53
operator/status pages with all asset types allowed. Ten pages had candidates:
seven `【敬请期待】` pages were safe playable promotions, while `【无字幕】秘密会议`
was left out because the status marker means it should not be published
automatically, `【仅供下载】皮克斯短片集` stayed excluded because of the duplicate
short-title source risk, and `【敬请期待】姜子牙` stayed excluded because its legacy
spec title produced an incomplete `GB` label and needs metadata cleanup first.
The safe seven pages were `搭错车`, `飞驰人生2`, `夜班`, `那些年，我们一起追的女孩`,
`戏梦巴黎`, `卧虎藏龙`, and `哪吒之魔童闹海`. The writer created 15 playable
rows, reran as 15 `skip_existing`, and title cleanup removed `【敬请期待】` from
those seven Notion work titles. Stats after the pass showed 3342 active Media
Assets rows, 977 covered works, 2629 playable rows, 713 source-only rows, and
zero traceability gaps. A fresh round40 batch still has 18 ordinary items, but
dry-run finds zero candidates; leftovers now show 94 uncovered pages: 46
operator/status-prefixed pages and 48 series pages.

The `姜子牙` leftover was then promoted after tightening the Media Assets
writer/audit display-label cleanup. Legacy spec titles can contain a dangling
size unit such as `GB` without a numeric value; the tools now strip standalone
`GB`/`GiB` from generated `Name`/`Display Label` while preserving valid sizes
such as `1.76GB`. The targeted dry-run changed the candidate label from
`姜子牙 繁简英 普通话 GB` to `姜子牙 繁简英 普通话`, then created one playable row,
reran as `skip_existing`, and removed the `【敬请期待】` title prefix. Stats after
this pass showed 3343 active Media Assets rows, 978 covered works, 2630
playable rows, 713 source-only rows, and zero traceability gaps. Fresh round41
leftovers now show 93 uncovered pages: 45 operator/status-prefixed pages and 48
series pages. A new operator/status dry-run found only two remaining candidate
pages: `【无字幕】秘密会议`, which should not be published automatically without
subtitle/operator review, and the duplicate-risk `【仅供下载】皮克斯短片集`. The other
43 operator/status pages had zero candidates and are backlog/placeholder work.

Movie video spec page titles should use the movie title, subtitle-language label,
and file size, for example `再见列宁 繁 4.67GB`. Do not add quality tier words
such as `高`, `中`, or `低`; the size already distinguishes variants, and future
CQ/bitrate variants may not map cleanly to those tiers.

## Normalization Backlog

The library has manual history from different periods. Future cleanup should
standardize, but only after inspecting examples:

- Spec page title grammar for movies and TV seasons.
- Placeholder pages with duplicated titles.
- TV episode child-page title cleanup. Target `Episode NN` after verifying the
  episode number against the live block tree and attached file/video names.
- `【仅供下载】` backlog triage. Decide which rows deserve re-download,
  subtitle/remux repair, transcode, upload, and verification first.
- Migrate title-prefix-only download backlog rows to `Media Availability` plus
  `Developer Memo` after auditing examples.
- Add structured spec/source metadata for representative rows before relying on
  the website to display variant details.
- TV seasons that have more episode placeholders than available local files.
- Source archive size page names under `基地 -> 片源`.
- Whether old entries use `片源` or `资源`.
- Subtitle placement and naming under `字幕`.
