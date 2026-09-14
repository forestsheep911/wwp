# WWP Storage and External-Disk Rules

## Storage Roles

- The input root is always supplied by the current request or enabled in the
  ledger. `G:` is not an input root merely because the drive exists.
- `E:\video_made` remains the default final-output root only when the user did
  not specify another output directory. The actual output path must be recorded
  in the ledger.
- `G:` is an optional external-disk fallback. It may be used as a temporary
  staging area for encode intermediates, completed outputs, or cleanup items
  when another working volume lacks space, or when the user explicitly asks for
  it. It is never the preferred output volume.
- A G-drive quarantine destination must be outside the configured output root.
  Use the configured same-volume quarantine convention; if none exists, use a
  clearly named top-level directory such as `G:\待人工删除`, never
  `G:\video_made\待人工删除`.

## Availability and Performance Gate

Before using `G:` in a cycle, verify all of the following at runtime:

1. The drive is present, the selected directory is writable, and free space is
   sufficient for the planned copy or temporary encode files.
2. A small write/read probe succeeds. Because this is an external disk and may
   be slow or intermittently absent, do not begin a large transfer solely from
   its drive letter being visible.
3. The transfer has an exact source and destination path, expected byte size,
   and ledger record. After copying, verify the byte count (and checksum when
   available) before removing the original or changing its ledger path.

If any check fails, record `external_storage_unavailable` or
`external_storage_slow`, keep the current file in place, and continue with
another safe lane. Do not treat a missing G drive as a workflow failure and do
not retry it in a tight loop.

## Allowed Uses

- Cleanup discovery must inspect exact ledger output paths on every volume,
  including temporary output directories. Never restrict a complete cycle to
  `E:\video_made`. An explicit `--output-root` remains a scoped audit filter.
- Pass each cleanup candidate's actual parent directory to the cleanup executor.
  Exclude paths already under `待人工删除` so later cycles do not move them again.
- Consume the bounded cleanup queue after publication and before declaring idle;
  continue while eligible files remain. External disks are temporary storage and
  must not silently accumulate already published outputs.

- Put encode intermediates on `G:` with `--temp-dir` when the final output
  remains in the configured output root and the external-disk probe passes.
- Temporarily stage a completed, QC-passed output on `G:` when the normal
  output volume is short on space. Record the actual path and relocate or
  quarantine it only through the guarded relocation/cleanup workflow.
- Move a cleanup-eligible output or source to a G-drive quarantine only when
  same-volume handling on its current drive is impossible or the user has
  selected G as the temporary holding destination. This is reversible
  organization, not final deletion.

Never use G-drive availability to waive Notion publication, Media Assets,
playback/QC, source-expansion, or human-confirmation gates. A file on G remains
an active ledger item until the normal evidence and disposition rules pass.
