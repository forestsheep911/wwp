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

## Current Upload Helpers

Playable movie files:

```powershell
node tools\notion-upload-movie-video.mjs --file "E:\video_made\movie.mp4" --apply
```

Playable TV season files:

```powershell
node tools\notion-upload-series-videos.mjs --apply
node tools\notion-upload-series-videos.mjs --apply --max-files 1
```

Source archive files:

```powershell
node tools\notion-upload-series-source.mjs --package
node tools\notion-upload-series-source.mjs --apply --upload --max-upload-files 1
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

## Normalization Backlog

The library has manual history from different periods. Future cleanup should
standardize, but only after inspecting examples:

- Spec page title grammar for movies and TV seasons.
- Placeholder pages with duplicated titles.
- TV seasons that have more episode placeholders than available local files.
- Source archive size page names under `基地 -> 片源`.
- Whether old entries use `片源` or `资源`.
- Subtitle placement and naming under `字幕`.
