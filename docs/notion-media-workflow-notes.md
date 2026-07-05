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
as the primary metadata source. Run `ffprobe` on the final local media file and
write the probed facts into `Media Assets` where possible: container, duration,
resolution, video codec/profile, HDR/SDR signal when present, frame rate, audio
codec/channel layout/languages when tags exist, subtitle stream languages, and
exact byte size. Human-readable titles should remain compact summaries; the
website should prefer structured `Media Assets` fields and only fall back to
title/filename parsing for older migrated rows.

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
node tools\notion-media-assets-stats.mjs --report .local-data\media-assets-stats-after-series.json
```

The series writer only creates rows for real playable media blocks inside
episode child pages. It sets `Episode Number`, keeps `Hide from Website`
unchecked for playable rows, and records the episode page as `Source Page ID`
plus the video/file block as `Media Block ID`. Direct media attached to the spec
page is reported as `direct_spec_media_not_written` for a later normalization
pass.

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
