---
name: wwp-series-producer
description: Use when WWP work involves TV series, seasons, episodes, SxxEyy mapping, episode playable uploads, series source archives, or series Media Assets relationships.
---

# WWP Series Producer

Series require episode-range-aware mapping, upload, and Media Assets writes. To reduce manual Notion uploads, the default playable delivery is now a bounded collection of consecutive episodes rather than one upload per episode.

## Structure

- Movie: work page -> spec page -> video/file.
- Series: series/season page -> spec page -> episode-range page -> video/file.
- A single-episode range remains valid, but prefer the largest consecutive range that stays safely below 5,000,000,000 bytes.
- Media Assets must preserve work, season, episode start, episode end, spec, and media relationship instead of relying on filenames alone.

## Workflow

1. Confirm series title, season, input directory, and intended spec.
2. Scan filenames and embedded metadata for SxxEyy, episode number, title, duration, language, subtitle, and version.
3. Create a dry-run mapping from source files to consecutive episode collections. Target about 4.7-4.85GB per collection and never exceed 5,000,000,000 bytes.
4. Normalize and QC individual episode MP4s first when needed, then run `build-series-collections.mjs` to stream-copy compatible consecutive episodes into `S01E01-E05` style collection files.
5. Before manual upload is expected, run the prepare-only series upload flow to create or reuse the target spec page and every needed episode-range child page so each finished collection has a precise destination.
6. Verify episode coverage before declaring a season upload-ready. Parse every main episode number, detect gaps, duplicates, and overlapping ranges, then compare against the authoritative season count.
7. Existing MP4 episodes may be adopted without transcoding when every file passes probe and bounded decode checks and uses a website-compatible combination such as `avc1` H.264, `yuv420p`, AAC audio, and verified hard Chinese subtitles.
8. Keep recap/interstitial numbering such as `13.5` outside the main integer episode sequence. Publish recap files only under an explicitly approved extras/recap structure.
9. For seasons with many collection pages, create pages in bounded batches, read back the child-page count after each batch, and resume from the first missing range.
10. Smoke-test one or a few episodes before starting the whole season when subtitle timing, color, naming, or upload behavior is uncertain.
11. Encode in episode-aware batches, build size-bounded collections, then upload one file per collection.
12. Use series-specific Notion and Media Assets tools from `../../references/script-map.md`.
13. Report missing episodes, duplicate matches, overlapping or ambiguous ranges, produced collections, and Media Assets coverage.

## Guardrails

- Do not flatten an unbounded season into one file. Split on episode boundaries before the 5,000,000,000-byte cap.
- Do not leave playable videos directly under the series/season root page. Root-level uploads are temporary landing media and must be organized into spec -> episode-range child pages before final Media Assets writes.
- When preparing a manual-upload series, report the series/season page ID, spec page ID, episode-range page IDs, and inclusive ranges before upload handoff.
- Do not create playable Media Assets rows from placeholder titles alone.
- Keep source/archive upload separate from playable episode upload.
- When in doubt, stop at a dry-run map and ask before applying page mutations.

## Reference

Read `../../references/series-rules.md` for mapping and Notion shape details.
