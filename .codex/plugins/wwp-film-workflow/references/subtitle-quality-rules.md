# Subtitle Candidate Quality Rules

Select a subtitle in two stages. Compatibility is a hard gate; quality scoring
only compares candidates that plausibly fit the exact source.

## Compatibility Gate

Require the strongest available agreement across:

1. Work identity, year, season, and episode.
2. Cut/edition and source family: theatrical/director/extended, Blu-ray,
   WEB-DL, HDTV, DVD, and regional variants.
3. Runtime and frame rate. A matching FPS label alone does not prove sync.
4. Release group or exact release filename when supplied.
5. Chinese language presence and complete subtitle coverage.

Reject or defer a candidate when the underlying cut differs, episodes are
misaligned, the subtitle is incomplete, or timing drifts materially across the
work. A simple constant offset may be corrected and recorded; progressive drift
or scene-dependent discontinuities require a different subtitle or manual work.

## Quality Preference

Among compatible candidates, prefer approximately:

1. Verified official subtitle for the matching release.
2. Reputable human-corrected or subtitle-group release for the matching source.
3. Other complete human translation with credible revision evidence.
4. OCR-derived subtitle with documented correction.
5. AI/machine translation only when clearly labelled and independently checked.

Use provider rating, comments, download count, recency, and uploader history as
supporting signals, never as substitutes for compatibility. Prefer Traditional
Chinese-English, Simplified Chinese-English, Traditional Chinese, then Simplified
Chinese when otherwise comparable, following the playable encoder defaults.

## File and Content Checks

- Preserve the downloaded original, calculate SHA-256, and work from a staged
  copy. Do not execute archive contents.
- Allow expected subtitle formats such as ASS, SSA, SRT, SUP, and SUB only after
  format inspection. Reject executables, scripts, shortcuts, links, absolute
  paths, and archive traversal.
- Detect text encoding, normalize a working copy to UTF-8 when appropriate, and
  retain the original encoding in the manifest.
- Confirm that sampled dialogue contains Chinese, timestamps are ordered, and
  first/last events plausibly cover the feature or episode.
- Check real subtitle events near the beginning, middle, and end against the
  video. Do not validate an external subtitle with an input-side seek that shifts
  video but not subtitle time.
- Never pair a sidecar subtitle with a video from the episode number in the
  filename alone. Some release folders contain swapped, legacy, or misleading
  episode labels. Before encoding, cross-check the sidecar's own title/content,
  duration and several timed dialogue events against the selected video; if the
  identity is ambiguous, keep the variant in `Needs Review`/deferred state until
  the mapping is resolved.

## Decision Record

Record every compared candidate's provider, ID, URL, claimed release/language,
compatibility decision, score/reason, and rejection reason. For the selected
artifact also record filename, byte count, SHA-256, encoding, parsed event count,
coverage, applied offset/stretch, sample timestamps, and final visual QC.
