# WWP Decision Rules

## Inputs

- The video/source input directory is provided by the user for the current task. Do not treat any historical path as fixed.
- If the user does not provide an input directory, ask or propose a context-derived candidate and wait for confirmation before scanning heavily.
- The playable output directory defaults to `E:\video_made` only when the user has not specified another output path.

## Scan Targets

Look for media files, folders, BDMV/ISO structures, remuxes, NFOs, subtitle packs, extras, director cuts, commentary tracks, Mandarin/Cantonese/original audio, and series episode naming. Group variants of the same work together before deciding.

## Notion State

Classify each candidate as:

- new work not in Notion
- existing work with sufficient specs
- existing work with meaningful spec gaps
- possible duplicate or ambiguous match
- series/season/episode workflow instead of movie workflow
- source-only/archive workflow instead of playable workflow

Supplemental specs can be as valuable as new works when existing specs are weak. Do not apply a blanket "new films first" rule.

## Hard Gates

- Chinese subtitles are a hard requirement for subtitle-dependent versions unless the user explicitly overrides.
- Subtitle evidence may come from internal subtitle tracks, sidecar subtitle files, or visually confirmed source hard subtitles. If a probe has no subtitle stream, inspect a real sample before declaring the source subtitle-free.
- Mandarin/Chinese-language works are not subtitle-dependent by default; prefer no added hard subtitles unless the source already has unavoidable hard subtitles.
- Dolby Vision Profile 5 is a normal-production blocker unless there is an explicit compatible color strategy; prefer a non-DV or HDR10-compatible source for full pipeline work.
- v1 does not automatically search subtitle websites. Record missing subtitles and move on.
- Skip sources with poor technical quality, serious color risk, unreliable subtitle timing, broken audio, or likely encode failure unless the user asks for an experiment.
- Do not encode just because a file is present.

## Priority Signals

Raise priority for:

- well-known, influential, or high-library-value films
- smooth encode path and reliable subtitles
- manageable file size and upload path
- children's films with Mandarin dubbing
- Hong Kong films with Cantonese plus Chinese subtitles
- director cuts, commentary tracks with Chinese assistance, or missing Mandarin/Cantonese specs
- existing works lacking a better 3-4GB-ish playable when the source quality supports it
- existing works that have only high-bitrate files but lack a compact 1.0-1.8GB-ish playable for easier streaming
- newly arrived input-directory entries detected by a queue watcher, after they pass the same subtitle, quality, Notion-state, and risk gates

## Deferred Decisions

When a candidate is uncertain but not blocking the batch, record the question and continue with deterministic items. Ask the user at the end of the batch with enough evidence: source, subtitles, audio, Notion state, expected output, and risk.

## Queue Monitoring

- A queue watcher should compare the current input directory scan against a saved state file and report new, removed, and materially changed top-level entries.
- New queue entries are candidates for analysis, not automatic encodes. Run the hard gates and priority signals before starting work.
- During long encodes or uploads, use waiting time for Notion metadata, manual-upload organization, and Media Assets dry-runs instead of idling.
