# WWP Notion and Media Assets Rules

## Page Shape

- New API-created pages should favor stable structure, machine parsing, and Media Assets completeness.
- Historical base/toggle/callout layouts are compatibility targets for reading old pages, not required shape for new API output.
- Movie shape: work page -> spec page -> playable video/file.
- Series shape: series/season page -> spec page -> episode page -> playable video/file.

## Spec Titles

Use positive labels in spec page titles: work title, subtitle/language label, and file size. Example shape: `Work Title 简英 1.16GB`.

Do not encode hidden technical truth in title text. Media Assets is the authoritative structured record for codec, duration, resolution, frame rate, audio, subtitle, source lineage, and availability.

## Media Assets Write Rules

- Run `ffprobe` on the exact local final file that corresponds to the uploaded playable.
- Prefer ffprobe output plus production manifest over filename guessing.
- When the writer supports batch manifests, use page IDs and expected-title guards for apply runs. Put ffprobe-confirmed values in the manifest `metadata` object when filename/page parsing would be lossy or ambiguous.
- For series rows, use the episode-aware writer and pass a metadata manifest when local final-file `ffprobe` data is available. Match overrides by `Media Block ID` when known, otherwise by `Source Page ID` plus original filename.
- Run writers in dry-run mode first when available.
- Apply only after the dry-run matches the intended work/spec/page.
- Read back created/updated rows or run stats/audit before claiming completion.
- Rerun idempotency checks when a writer supports them.
- Notion-hosted media URLs are often temporary signed URLs. Do not treat an empty persistent `Asset URL` field as a failure when `Source Page ID`, `Media Block ID`, filename, work relation, and readback metadata are present.

## Backfill Rules

- For recent manual or remote uploads, scan recently updated Notion pages or the user-provided page set.
- Identify video/file blocks and classify playable, episode playable, source archive, original disc, or unknown.
- Prefer local samples, produced files, manifests, or existing ffprobe JSON. Ask before downloading Notion-hosted media solely to probe metadata.
- Do not move pages or reupload files during a Media Assets backfill.
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
