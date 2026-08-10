# WWP Source Archive Rules

## Boundary

Source/original-disc upload means handling original discs, remuxes, BDMV/ISO folders, source archives, or 7z volumes. It does not mean uploading the playable MP4.

New playable production does not automatically upload source/original discs. Enter this workflow only when the user asks, when source-only state must be reconciled, or when a manual source upload needs Media Assets alignment.

Work-level metadata still has priority in source/archive workflows. Once the work page exists, start metadata backfill from Douban, OMDb, TMDb when available, and AI advisory fields, even if playable encoding or source upload is blocked, slow, or only partially complete.

## Expansion Retention

- Keep a playable source after the first release while any concrete higher-bitrate, alternate-audio, subtitle, commentary, or cut variant is selected or deferred.
- A work-level `Workflow Status=已完成` means the current release is live; it does not mean the source has been exhausted.
- Permit source cleanup only after the expansion decision is `[规格扩展:CLOSED]`, every linked variant is `sync_ready` or terminally cancelled, and no encode, QC, upload, or publication state is open.
- Outputs that are individually `sync_ready` may be quarantined under their normal proof rules without moving the still-active source.

## Manual Upload Alignment

When the user manually uploads source files:

1. Read Notion blocks and source page structure.
2. Compare local manifest, file names, sizes, and known source lineage.
3. Confirm the work page has a metadata backfill plan or run it before/while reconciling source Media Assets.
4. Create/update source Media Assets rows only from real file evidence.
5. Keep availability as `source_only`, `needs_processing`, `blocked`, or `unknown` unless playable output exists.
6. Record uncertainty in memo/report output.

## API Source Upload

If the user explicitly asks for API source upload:

- Prepare package/volume manifests before upload.
- Use retry-safe upload state.
- Avoid silent bandwidth/proxy-heavy paths.
- Read back uploaded file blocks.
- Keep playable upload and source upload manifests separate.
- Use upload wait time for work-level metadata preview/apply/readback, and report that metadata state separately from upload state.

## Local State

Use `.local-data/source-archives/` for source archive manifests unless the user names another state directory. Do not put large generated source archives into tracked plugin files.
