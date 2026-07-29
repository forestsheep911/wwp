---
name: wwp-series-producer
description: Use when WWP work involves TV series, seasons, episodes, SxxEyy mapping, episode playable uploads, series source archives, or series Media Assets relationships.
---

# WWP Series Producer

Series require episode-aware mapping, upload, and Media Assets writes. Now that automatic Notion upload is available, the default playable delivery is one video per episode. Build multi-episode collections only when the user explicitly requests them or a documented exceptional delivery constraint requires them.

## Structure

- Movie: work page -> spec page -> video/file.
- Series: series/season page -> spec page -> episode page -> video/file.
- Each normal episode page represents exactly one episode. An inclusive episode-range page is reserved for an explicitly approved collection file.
- Media Assets must preserve work, season, episode start, episode end, spec, and media relationship instead of relying on filenames alone.

## Workflow

1. Confirm series title, season, input directory, and intended spec.
2. Scan filenames and embedded metadata for SxxEyy, episode number, title, duration, language, subtitle, and version.
3. Create a dry-run mapping from each source file to its single episode number and target Episode page.
4. Normalize and QC individual episode MP4s when needed. Do not run `build-series-collections.mjs` unless collection delivery was explicitly requested.
5. Before encoding or upload, run the prepare-only series upload flow to create or reuse the target spec page and every needed Episode child page so each finished episode has a precise destination.
6. Verify episode coverage before declaring a season upload-ready. Parse every main episode number, detect gaps, duplicates, and overlapping ranges, then compare against the authoritative season count.
7. Existing MP4 episodes may be adopted without transcoding when every file passes probe and bounded decode checks and uses a website-compatible combination such as `avc1` H.264, `yuv420p`, AAC audio, and verified hard Chinese subtitles.
8. Keep recap/interstitial numbering such as `13.5` outside the main integer episode sequence. Publish recap files only under an explicitly approved extras/recap structure.
9. For seasons with many Episode pages, create pages in bounded batches, read back the child-page count after each batch, and resume from the first missing episode.
10. Smoke-test one or a few episodes before starting the whole season when subtitle timing, color, naming, or upload behavior is uncertain.
11. Encode in episode-aware batches, then automatically upload one file per episode.
12. Use series-specific Notion and Media Assets tools from `../../references/script-map.md`.
13. Report missing episodes, duplicate matches, ambiguous mappings, produced episodes, and Media Assets coverage. Report collections separately only when explicitly enabled.

## Guardrails

- Do not merge episodes merely to reduce upload count. Each episode must independently stay below the 5,000,000,000-byte cap.
- Do not leave playable videos directly under the series/season root page. Root-level uploads are temporary landing media and must be organized into spec -> Episode child pages before final Media Assets writes.
- When preparing a series, report the series/season page ID, spec page ID, and Episode page IDs before upload.
- Collection delivery is opt-in. Require an explicit user instruction before merging consecutive episodes or creating `S01E01-E05` assets.
- Do not create playable Media Assets rows from placeholder titles alone.
- Keep source/archive upload separate from playable episode upload.
- When in doubt, stop at a dry-run map and ask before applying page mutations.

## Reference

Read `../../references/series-rules.md` for mapping and Notion shape details.
