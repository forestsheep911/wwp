# WWP Series Rules

## Structure

Series have one more layer than movies:

- Movie: work page -> spec page -> video/file
- Series: series/season page -> spec page -> episode page -> video/file

Use a season label only when the verified external identity explicitly names a season or the work has multiple separately released seasons. Do not invent `第一季`, `Season 1`, `本传`, or similar labels for a single canonical series page merely to distinguish a spec. Specs should be named from the canonical series title plus actual audio, subtitle, codec, edition, and measured size dimensions.

## Spec Titles

For episode-bearing specs, the size dimension is the measured decimal-GB size **per episode**, not the aggregate size of a season, a source folder, or a batch. When episodes differ materially, use the measured range: `银河英雄传说 日语中字 H.265 0.08-0.40GB/集`. Use one measured per-episode value only when the spread is negligible. Put aggregate totals in the production ledger or source/archive record, never in the playable spec title. Use concrete attributes such as `原盘`, codec, audio, and subtitle labels instead of subjective labels.

Media Assets must preserve episode relationships. Filename-only matching is not enough.

Notion API cannot move uploaded media blocks between pages in this workflow. For manual upload handoff, create the series/season page, target spec page, and all expected episode child pages before the user uploads episode files.

## Mapping

Build a dry-run map before applying Notion changes:

- detected series and season
- episode number and SxxEyy
- source file path
- duration and stream facts
- subtitle/audio choice
- target episode page
- target spec
- uncertainty or collision

Do not proceed when episode page mapping is ambiguous.

## Production

- Smoke-test one or a few episodes when subtitle timing, color, upload behavior, or naming is uncertain.
- Before full-season encoding or manual upload handoff, prepare the target spec page and episode child pages with the series upload prepare-only flow. Report the destination page IDs to the user.
- Batch encode/upload only after the mapping and sample are sane.
- Use episode-aware tools for upload and Media Assets writes.
- When a series/season page does not exist, create it only through an explicit create path. The intended API shape is series/season page -> spec page -> episode page -> media block; legacy callout/toggle containers are not required for new API-created content.
- After uploading an episode, run a structure audit before writing Media Assets. The audit should show parseable episode pages, no duplicate episode numbers, and playable media under episode pages rather than direct spec-page media.
- Report missing episodes, duplicate detected episodes, skipped extras, and produced episode count.

## Source Archives

Series source/archive upload is separate from episode playable upload. Source-only pages do not imply playable episode coverage.
