# WWP Series Rules

## Structure

Series have one more layer than movies:

- Movie: work page -> spec page -> video/file
- Series: series/season page -> spec page -> episode-range page -> video/file

Use a season label only when the verified external identity explicitly names a season or the work has multiple separately released seasons. Do not invent `第一季`, `Season 1`, `本传`, or similar labels for a single canonical series page merely to distinguish a spec. Specs should be named from the canonical series title plus actual audio, subtitle, codec, edition, and measured size dimensions.

## Spec Titles

For collection-bearing specs, the size dimension is the measured decimal-GB size **per collection**, for example `银河英雄传说 日语中字 H.265 4.7-4.85GB/合集`. A one-episode collection is allowed when the next episode would cross the cap. Never use a season or source-folder total in the playable spec title.

Media Assets must preserve inclusive `Episode Number` and `Episode End` relationships. Filename-only matching is not enough. Website display should render `第1-5集`.

Notion API cannot move uploaded media blocks between pages in this workflow. For manual upload handoff, create the series/season page, target spec page, and all expected episode-range child pages before the user uploads collection files.

## Mapping

Build a dry-run map before applying Notion changes:

- detected series and season
- episode start/end and SxxEyy-Eyy
- source file path
- duration and stream facts
- subtitle/audio choice
- target episode-range page
- target spec
- uncertainty or collision

Do not proceed when episode-range page mapping is ambiguous.

## Production

- Smoke-test one or a few episodes when subtitle timing, color, upload behavior, or naming is uncertain.
- Normalize/QC episode outputs, then plan collections with `build-series-collections.mjs`. The planner groups only consecutive episodes and leaves gaps in separate files.
- Before full-season manual upload handoff, prepare the target spec page and episode-range child pages with the series upload prepare-only flow. Report the destination page IDs to the user.
- Default to about 4.85GB per collection; the final local file must be below 5,000,000,000 bytes.
- Batch encode/upload only after the mapping and sample are sane.
- Before handoff, prove that the main integer episode sequence is complete and has no duplicates. Missing episodes keep the batch deferred and must be written to the work page's `AI Issue`.
- A multi-part collection directory must be split into independently catalogued season/part sources before variants are registered.
- Do not transcode an already compatible `avc1`/`yuv420p` MP4 batch merely to change codec. Probe every file, decode bounded start/end samples, verify hard Chinese subtitles visually, and adopt the originals when all checks pass.
- Decimal recap numbers such as `13.5` are extras, not substitutes for Episode 13. Exclude them from the main season handoff unless an explicit recap/extras page structure has been approved.
- Use episode-range-aware tools for upload and Media Assets writes.
- When a series/season page does not exist, create it only through an explicit create path. The intended API shape is series/season page -> spec page -> episode-range page -> media block; legacy callout/toggle containers are not required for new API-created content.
- After uploading a collection, run a structure audit before writing Media Assets. The audit should show parseable, non-overlapping episode ranges and playable media under episode-range pages rather than direct spec-page media.
- Report missing episodes, duplicate detected episodes, skipped extras, and produced episode count.

## Source Archives

Series source/archive upload is separate from episode playable upload. Source-only pages do not imply playable episode coverage.
