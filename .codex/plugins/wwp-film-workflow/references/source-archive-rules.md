# WWP Source Archive Rules

## Boundary

Source/original-disc upload means handling original discs, remuxes, BDMV/ISO folders, source archives, or 7z volumes. It does not mean uploading the playable MP4.

New playable production does not automatically upload source/original discs. Enter this workflow only when the user asks, when source-only state must be reconciled, or when a manual source upload needs Media Assets alignment.

## Manual Upload Alignment

When the user manually uploads source files:

1. Read Notion blocks and source page structure.
2. Compare local manifest, file names, sizes, and known source lineage.
3. Create/update source Media Assets rows only from real file evidence.
4. Keep availability as `source_only`, `needs_processing`, `blocked`, or `unknown` unless playable output exists.
5. Record uncertainty in memo/report output.

## API Source Upload

If the user explicitly asks for API source upload:

- Prepare package/volume manifests before upload.
- Use retry-safe upload state.
- Avoid silent bandwidth/proxy-heavy paths.
- Read back uploaded file blocks.
- Keep playable upload and source upload manifests separate.

## Local State

Use `.local-data/source-archives/` for source archive manifests unless the user names another state directory. Do not put large generated source archives into tracked plugin files.
