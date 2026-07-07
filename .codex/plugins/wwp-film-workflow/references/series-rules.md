# WWP Series Rules

## Structure

Series have one more layer than movies:

- Movie: work page -> spec page -> video/file
- Series: series/season page -> spec page -> episode page -> video/file

Media Assets must preserve episode relationships. Filename-only matching is not enough.

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
- Batch encode/upload only after the mapping and sample are sane.
- Use episode-aware tools for upload and Media Assets writes.
- When a series/season page does not exist, create it only through an explicit create path. The intended API shape is series/season page -> spec page -> episode page -> media block; legacy callout/toggle containers are not required for new API-created content.
- After uploading an episode, run a structure audit before writing Media Assets. The audit should show parseable episode pages, no duplicate episode numbers, and playable media under episode pages rather than direct spec-page media.
- Report missing episodes, duplicate detected episodes, skipped extras, and produced episode count.

## Source Archives

Series source/archive upload is separate from episode playable upload. Source-only pages do not imply playable episode coverage.
