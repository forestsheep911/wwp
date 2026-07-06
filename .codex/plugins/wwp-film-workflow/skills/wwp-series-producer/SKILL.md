---
name: wwp-series-producer
description: Use when WWP work involves TV series, seasons, episodes, SxxEyy mapping, episode playable uploads, series source archives, or series Media Assets relationships.
---

# WWP Series Producer

Series are not movie pages with many files. They have an additional episode layer and require episode-aware mapping, upload, and Media Assets writes.

## Structure

- Movie: work page -> spec page -> video/file.
- Series: series/season page -> spec page -> episode page -> video/file.
- Media Assets must preserve work, season, episode, spec, and media relationship instead of relying on filenames alone.

## Workflow

1. Confirm series title, season, input directory, and intended spec.
2. Scan filenames and embedded metadata for SxxEyy, episode number, title, duration, language, subtitle, and version.
3. Create a dry-run mapping from source files to episode pages.
4. Smoke-test one or a few episodes before starting the whole season when subtitle timing, color, naming, or upload behavior is uncertain.
5. Encode/upload in episode-aware batches.
6. Use series-specific Notion and Media Assets tools from `../../references/script-map.md`.
7. Report missing episodes, duplicate matches, ambiguous episode pages, produced episodes, and Media Assets coverage.

## Guardrails

- Do not flatten all episodes into one movie-style spec page.
- Do not create playable Media Assets rows from placeholder titles alone.
- Keep source/archive upload separate from playable episode upload.
- When in doubt, stop at a dry-run map and ask before applying page mutations.

## Reference

Read `../../references/series-rules.md` for mapping and Notion shape details.
