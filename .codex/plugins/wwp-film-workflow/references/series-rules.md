# WWP Series Rules

## Structure

Series have one more layer than movies:

- Movie: work page -> spec page -> video/file
- Series: series/season page -> spec page -> episode page -> video/file

Use a season label only when the verified external identity explicitly names a season or the work has multiple separately released seasons. Do not invent `第一季`, `Season 1`, `本传`, or similar labels for a single canonical series page merely to distinguish a spec. Specs should be named from the canonical series title plus actual audio, subtitle, codec, edition, and measured size dimensions.

## Spec Titles

The default size dimension is the measured decimal-GB size per episode or per-episode range, for example `银河英雄传说 日语中字 H.265 0.08-0.44GB/集`. Never use a season or source-folder total in the playable spec title.

Multi-episode collections are not a default optimization. Use them only after an explicit user instruction or a documented exceptional requirement. An approved collection spec uses measured size per collection, for example `4.7-4.85GB/合集`.

Media Assets must preserve inclusive `Episode Number` and `Episode End` relationships. Filename-only matching is not enough. Website display should render `第1-5集`.

Notion API cannot move uploaded media blocks between pages in this workflow. Create the series/season page, target spec page, and all expected Episode child pages before automatic or manual upload.

## Mapping

Build a dry-run map before applying Notion changes:

- detected series and season
- episode number and SxxEyy
- source file path
- duration and stream facts
- subtitle/audio choice
- target Episode page
- target spec
- uncertainty or collision

Do not proceed when Episode page mapping is ambiguous.

## Production

- Smoke-test one or a few episodes when subtitle timing, color, upload behavior, or naming is uncertain.
- Normalize/QC each episode output and keep it as a separate playable file by default.
- Before full-season upload, prepare the target spec page and Episode child pages with the series upload prepare-only flow.
- Each final episode file must be below 5,000,000,000 bytes.
- Run `build-series-collections.mjs` only for an explicitly approved collection delivery. In that mode, group only consecutive episodes, preserve inclusive ranges, and keep every collection below 5,000,000,000 bytes.
- Batch encode/upload only after the mapping and sample are sane.
- Before handoff, prove that the main integer episode sequence is complete and has no duplicates. Missing episodes keep the batch deferred and must be written to the work page's `AI Issue`.
- A multi-part collection directory must be split into independently catalogued season/part sources before variants are registered.
- Do not transcode an already compatible `avc1`/`yuv420p` MP4 batch merely to change codec. Probe every file, decode bounded start/end samples, verify hard Chinese subtitles visually, and adopt the originals when all checks pass.
- Decimal recap numbers such as `13.5` are extras, not substitutes for Episode 13. Exclude them from the main season handoff unless an explicit recap/extras page structure has been approved.
- Use episode-aware tools for upload and Media Assets writes. Store `Episode End` only for approved multi-episode collections.
- When a series/season page does not exist, create it only through an explicit create path. The intended API shape is series/season page -> spec page -> Episode page -> media block; legacy callout/toggle containers are not required for new API-created content.
- After uploading episodes, run a structure audit before writing Media Assets. The audit should show parseable Episode pages with playable media rather than direct spec-page media.
- After website sync, verify the live API returns the full continuous Episode sequence, not merely the newest configured maximum. Keep the ingestion variant limit above the largest series in scope; the current local workflow uses 200 so a 110-episode series remains complete.
- Report missing episodes, duplicate detected episodes, skipped extras, and produced episode count.

## Source Archives

Series source/archive upload is separate from episode playable upload. Source-only pages do not imply playable episode coverage.
