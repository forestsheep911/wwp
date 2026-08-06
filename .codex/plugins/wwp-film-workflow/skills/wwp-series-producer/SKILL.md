---
name: wwp-series-producer
description: Use when WWP work involves TV series, seasons, episodes, SxxEyy mapping, episode playable uploads, series source archives, or series Media Assets relationships.
---

# WWP Series Producer

Series require episode-aware mapping, upload, and Media Assets writes. Now that automatic Notion upload is available, the default playable delivery is one video per episode. Build multi-episode collections only when the user explicitly requests them or a documented exceptional delivery constraint requires them.

## Structure

- Movie: work page -> spec page -> video/file.
- Single-season series: season work page -> spec page -> episode page -> video/file.
- Multi-season series: one database work page per independently released season -> spec page -> episode page -> video/file. A parent-series page may remain as catalog/navigation metadata, but it must not be the canonical playable work page for several seasons.
- Each normal episode page represents exactly one episode. An inclusive episode-range page is reserved for an explicitly approved collection file.
- Media Assets must preserve work, season, episode start, episode end, spec, and media relationship instead of relying on filenames alone.

## Workflow

1. Confirm series title, season, input directory, and intended spec. For a multi-season source, split and identify every season before creating any destination pages; create/reuse one database work entry for each verified season, rather than ordinary child pages below the parent series. Immediately read back the canonical work page's `影别`: normal series/season work must be `TV Series` (not `Movie`) before any spec, Episode, release, or website-sync action. Correct a mismatch through the work-page tool and retain the page hidden until the normal release gates pass.
2. Scan filenames and embedded metadata for SxxEyy, episode number, title, duration, language, subtitle, and version.
3. Create a dry-run mapping from each source file to its single episode number and target Episode page.
4. Normalize and QC individual episode MP4s when needed. Do not run `build-series-collections.mjs` unless collection delivery was explicitly requested.
5. Before encoding or upload, run the prepare-only series upload flow to create or reuse the target spec page and every needed Episode child page so each finished episode has a precise destination. Re-enumerate that exact spec beneath the requested season database work page immediately before upload; a supplied parent-series page, another season page, or another work ID is a hard failure.
6. Verify episode coverage before declaring a season upload-ready. Parse every main episode number, detect gaps, duplicates, and overlapping ranges, then compare against the authoritative season count.
7. Existing MP4 episodes may be adopted without transcoding when every file passes probe and bounded decode checks and uses a website-compatible combination such as `avc1` H.264, `yuv420p`, AAC audio, and verified hard Chinese subtitles.
8. Keep recap/interstitial numbering such as `13.5` outside the main integer episode sequence. Publish recap files only under an explicitly approved extras/recap structure.
9. For seasons with many Episode pages, create pages in bounded batches, read back the child-page count after each batch, and resume from the first missing episode.
10. Smoke-test one or a few episodes before starting the whole season when subtitle timing, color, naming, or upload behavior is uncertain.
11. Encode in episode-aware batches, then automatically upload one file per episode. Before any upload session is created, read every selected Episode page; an existing video block is a fail-closed condition even when its filename is blank. Reconcile the existing block or request a distinct target before trying another upload.
12. Use series-specific Notion and Media Assets tools from `../../references/script-map.md`.
13. Report missing episodes, duplicate matches, ambiguous mappings, produced episodes, and Media Assets coverage. Report collections separately only when explicitly enabled.
14. When a human re-parents a legacy series subtree, re-read the exact recorded season work page even when Workflow Status and Workflow Note are unchanged. Treat its Notion edit time only as a recheck hint; then audit the real tree. If a same-titled legacy season wrapper remains between the work page and specification, inspect through that wrapper rather than misclassifying its spec page as an episode or declaring the season empty.
15. Before release, group Media Assets by main episode number. Two playable entries for one episode are allowed only when they are intentionally separate quality tiers, each has current `hvc1`/pixel-format/AAC/subtitle QC evidence, and their labels distinguish the per-episode size ranges. A replacement that merely fixes compatibility supersedes the defective entry: hide the exact old Media Asset instead of leaving it selectable. Never infer supersession from a filename alone.

## Guardrails

- Do not merge episodes merely to reduce upload count. Each episode must independently stay below the 5,000,000,000-byte cap.
- Do not leave playable videos directly under the series/season root page. Root-level uploads are temporary landing media and must be organized into spec -> Episode child pages before final Media Assets writes.
- When preparing a series, report the series/season page ID, spec page ID, and Episode page IDs before upload.
- Collection delivery is opt-in. Require an explicit user instruction before merging consecutive episodes or creating `S01E01-E05` assets.
- Do not create playable Media Assets rows from placeholder titles alone.
- `Playback Verified=true` is not enough to keep a legacy duplicate visible after a browser or iOS decoder failure. Retain it only when its current technical evidence proves it is a distinct, compatible quality tier; otherwise hide the precise affected asset and release the replacement through the normal readback gate.
- Keep source/archive upload separate from playable episode upload.
- When in doubt, stop at a dry-run map and ask before applying page mutations.

## Reference

Read `../../references/series-rules.md` for mapping and Notion shape details.
