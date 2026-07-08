# WWP Notion and Media Assets Rules

## Page Shape

- New API-created pages should favor stable structure, machine parsing, and Media Assets completeness.
- Historical base/toggle/callout layouts are compatibility targets for reading old pages, not required shape for new API output.
- Movie shape: work page -> spec page -> playable video/file.
- Series shape: series/season page -> spec page -> episode page -> playable video/file.
- A video/file block directly under a movie work page, series page, or season page is only a temporary manual-upload landing spot. It is not final structure.
- Notion API cannot move uploaded media blocks between pages in this workflow. Therefore planned manual uploads require the destination pages before upload: movie spec child page first, or series spec page plus episode child pages first.
- When a manual upload lands at the root, create or reuse the correct spec/episode child page and report the required destination. The block remains structure-incomplete until the user manually moves/reuploads it or an explicit accepted local-file reupload is performed.
- Do not create final playable Media Assets rows that point at root-level landing media blocks. Use those blocks only as evidence for an organizer report until the media is moved or reuploaded into the correct child-page structure.

## Spec Titles

Use positive labels in spec page titles: work title, subtitle/language label, and file size. Example shape: `Work Title 简英 1.16GB`.

Do not encode hidden technical truth in title text. Media Assets is the authoritative structured record for codec, duration, resolution, frame rate, audio, subtitle, source lineage, and availability.

## Media Assets Write Rules

- Before uploading a playable through Notion, check the exact local file size. The normal Notion playable path uses the workflow cap of 5,000,000,000 bytes unless the user explicitly changes it. Official Notion wording may use 5 GiB, but keep the lower decimal-byte cap as upload safety margin.
- Files above the limit are not playable-upload-ready. Re-encode under the limit, split only if the workflow explicitly supports split playback, or route the asset to a source/archive workflow rather than a playable spec.
- Run `ffprobe` on the exact local final file that corresponds to the uploaded playable.
- Prefer ffprobe output plus production manifest over filename guessing.
- When the writer supports batch manifests, use page IDs and expected-title guards for apply runs. Put ffprobe-confirmed values in the manifest `metadata` object when filename/page parsing would be lossy or ambiguous.
- For series rows, use the episode-aware writer and pass a metadata manifest when local final-file `ffprobe` data is available. Match overrides by `Media Block ID` when known, otherwise by `Source Page ID` plus original filename.
- Run writers in dry-run mode first when available.
- Apply only after the dry-run matches the intended work/spec/page.
- Read back created/updated rows or run stats/audit before claiming completion.
- Rerun idempotency checks when a writer supports them.
- Notion-hosted media URLs are often temporary signed URLs. Do not treat an empty persistent `Asset URL` field as a failure when `Source Page ID`, `Media Block ID`, filename, work relation, and readback metadata are present.

## Early Page Creation

- It is valid to create/reuse the work page and intended spec page before the playable upload is ready. This lets work-level metadata backfill run while encode, QC, or upload continues.
- Treat destination preparation as the mandatory preflight gate for planned production, not only as a cleanup fallback after a bad manual upload.
- For accepted encodes, prepare the upload destination before long encode starts when manual upload is possible. Movie uploads need a spec child page. Series uploads need a spec page plus episode child pages. Give the user the exact target page title and ID.
- Treat pre-created pages as required because uploaded media blocks cannot be moved by API. Do not plan around uploading media to the root page and moving it later.
- Early work/spec pages are not evidence for playable Media Assets rows. Create playable Media Assets only after a real uploaded video/file block or a final local file with a planned upload has been verified.
- When upload is deferred or unsuitable, record the operational state in notes/reporting or `Media Availability` only when the media workflow has enough evidence. Do not let metadata backfill infer availability.

## Metadata Track

- Work-level metadata is independent from playable Media Assets. If scanning finds a film or series worth cataloging and no work page exists, create/reuse the work page and run metadata enrichment even when playable production is blocked, deferred, or skipped.
- Lack of playback resources should keep visibility/review gates conservative, but it should not prevent Douban, OMDb, TMDb, poster, basic info, or AI advisory fields from being filled.
- Media Assets remain media-specific. Do not create playable rows without real uploaded/probed media evidence just because the work-level metadata is complete.

## Visibility and Review Gates

- Keep `Hide from Website` true when there is no verified playable path: no suitable upload, no playable Media Assets row, source-only state, blocked encode/QC, missing required Chinese subtitles, broken media relationship, or unresolved playback risk.
- Treat a user-set `Hide from Website` as intentional. Do not clear it automatically. If the playable specs and Media Assets look good but the work is still hidden, report the evidence and ask the user before un-hiding.
- Use `Needs Review` for fixable uncertainty rather than visibility alone: ambiguous work/spec matching, Media Assets mismatch, duplicate or missing episode/spec links, missing ffprobe evidence, subtitle/audio uncertainty, metadata conflict, low-confidence AI advisory, or any condition where a human should inspect before relying on the row.
- Clearing `Needs Review` requires the named issue to be resolved and read back. Clearing it should not automatically clear `Hide from Website`.

## Backfill Rules

- For recent manual or remote uploads, scan recently updated Notion pages or the user-provided page set.
- Identify video/file blocks and classify playable, episode playable, source archive, original disc, or unknown.
- Prefer local samples, produced files, manifests, or existing ffprobe JSON. Ask before downloading Notion-hosted media solely to probe metadata.
- Pure Media Assets backfill is metadata-only and should not move pages or reupload files. If uploaded playable media is still sitting at the page root or at the wrong hierarchy level, route to a manual-upload organization step before writing final playable rows.
- Because API movement is unavailable, report the exact source page/block and required destination page for root-level uploads. If the final local MP4 is available and the user accepts the cost, reupload to the correct child page instead of copying a temporary signed Notion URL.
- If page title, spec page, and schema disagree, report the conflict before changing human-authored fields.
- For backfills after manual uploads, prefer durable Notion IDs and block IDs over copying transient file URLs into durable fields.

## Availability Vocabulary

Use these states consistently in notes/reports when exact schema fields vary:

- `playable`
- `source_only`
- `needs_processing`
- `blocked`
- `unknown`

Source-only availability never means the work is playable.
