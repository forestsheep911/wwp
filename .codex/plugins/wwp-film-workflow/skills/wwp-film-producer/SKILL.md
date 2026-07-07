---
name: wwp-film-producer
description: Use when coordinating WWP film or series production, choosing the next workflow step, or routing between source scanning, encoding, Notion publishing, Media Assets, source archives, and metadata backfill.
---

# WWP Film Producer

Coordinate WWP film work end to end. Load this first when the user asks to make, continue, publish, repair, or summarize a film/series production task.

## Route

- New input directory or "which one should we do": use `wwp-film-candidate-selector`.
- Playable transcode, subtitles, audio variants, QC, or output files: use `wwp-playable-encoder`.
- Series, seasons, episodes, SxxEyy mapping, or episode pages: use `wwp-series-producer`.
- Upload playable files or create/update Notion work/spec pages: use `wwp-notion-publisher`.
- "I uploaded some videos/source myself", recent uploads, or missing Media Assets: use `wwp-media-assets-backfiller`.
- Source/original-disc packaging, source-only pages, 7z volumes, or manual/API source upload: use `wwp-source-archive-operator`.
- Missing film-level metadata, Douban/OMDb/poster/basic info, or AI advisory fields: use `wwp-metadata-backfiller`.

## Default Flow

1. Confirm the user-specified input directory. Do not assume a fixed input path.
2. Select candidates by value, source quality, Chinese subtitle availability, Notion state, and production risk.
3. Produce playable MP4 variants into the user-specified output directory, or `E:\video_made` when none is specified.
4. Run probe/QC before upload.
5. Publish playable output to Notion, then write Media Assets from `ffprobe` and production manifests.
6. Backfill film metadata when the work page is new or incomplete.
7. Report IDs, output paths, Media Assets state, metadata state, skipped items, and any deferred user decisions.

## Guardrails

- Existing Notion works should be reused; do not create duplicate work pages for supplemental specs.
- Spec backfill can be as important as new-film creation when the existing specs are weak.
- Source/original-disc upload is not the default playable production path.
- Do not claim completion until Notion or Media Assets readback proves the external state.

## References

- Selection and value rules: `../../references/decision-rules.md`
- Encoding and stream reuse rules: `../../references/encoding-rules.md`
- Notion and Media Assets rules: `../../references/notion-media-assets.md`
- Metadata sources: `../../references/metadata-sources.md`
- Script inventory: `../../references/script-map.md`
