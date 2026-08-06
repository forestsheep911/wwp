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
- metadata-only cataloging candidate when playable production is blocked, deferred, or not worth doing now

Supplemental specs can be as valuable as new works when existing specs are weak. Do not apply a blanket "new films first" rule.

Work-level metadata is a separate high-priority track. If a scanned work is worth collecting, do not skip cataloging just because the current source lacks subtitles, has color risk, is too large, or has no immediate playable path.

## Hard Gates

- Chinese subtitles are a hard requirement only for subtitle-dependent versions unless the user explicitly overrides. A verified Mandarin-dubbed (`国配`) branch is Chinese-language playable and is not subtitle-dependent merely because the picture originated in another language.
- Subtitle evidence may come from internal subtitle tracks, sidecar subtitle files, or visually confirmed source hard subtitles. If a probe has no subtitle stream, inspect a real sample before declaring the source subtitle-free.
- An unlabelled bitmap/PGS subtitle stream is not Chinese-subtitle evidence by itself. Inspect that specific stream with a real timestamped sample; if the language still cannot be identified reliably, keep playable production deferred and continue the metadata-only track.
- Filename markers such as `chs`, `cht`, `zh`, or `Chinese` are only leads, never final hard-subtitle language evidence. Prefer a dialogue-frame inspection; when the user has actually played the file, that user observation overrides a contradictory filename marker and must be recorded in the selected spec label.
- Mandarin/Chinese-language works are not subtitle-dependent by default; prefer no added hard subtitles unless the source already has unavoidable hard subtitles.
- A verified `国配` source without Chinese subtitles may proceed through production, publication, and final completion. Record missing Chinese subtitles as a non-blocking future enhancement in the production manifest and the AI completion note; do not set `暂缓`, `Needs Review`, or `Hide from Website` for that reason alone. This exception applies only to the verified Mandarin branch; a separate foreign-original-audio branch still needs usable Chinese subtitles.
- Dolby Vision Profile 5 is a normal-production blocker unless there is an explicit compatible color strategy; prefer a non-DV or HDR10-compatible source for full pipeline work.
- When a worthwhile subtitle-dependent source has no verified Chinese subtitle, create or continue a bounded `wwp-subtitle-acquirer` task. Browser-backed providers require an explicit page refresh/capture in v0.1; record `waiting_user` or `deferred` rather than silently abandoning the source. Do not bypass login, CAPTCHA, copyright removal, download confirmation, or other access controls.
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

## Mandarin-Dub Decision

- Default to producing a verified Mandarin-dubbed spec for children's, animation, and family works when the normal source, QC, duplicate, capacity, and upload gates pass.
- Also default to producing it when an existing library work has a valuable missing Mandarin/Cantonese spec and the current source supplies verified audio evidence.
- For ordinary foreign-language films, ask the user: `现在有国配，要不要做？` before adding a Mandarin branch.
- For Hong Kong films, cover Cantonese plus Chinese subtitles first, then ask the same question before adding Mandarin as a supplemental branch.
- Include the planned bitrate tiers and total additional file count in the question. Compact plus higher-bitrate production multiplied by Mandarin requires explicit user approval; resource availability alone is not approval for this matrix expansion.
- Do not let the optional confirmation block metadata, original-audio, Cantonese, or other deterministic work.
- Once a `国配` branch is selected, missing Chinese subtitles do not reopen the production-matrix confirmation or create a subtitle-acquisition blocker. Subtitle acquisition may remain scheduled as optional later enrichment.

## Compact Coverage Decision

For every movie that passes the playable-production gates, make and record a compact-coverage decision before selecting any encode. This is a required decision record, not a requirement to make two versions of every movie.

Choose the production profile before deciding the matrix:

- **Standard-value work**: a compact, easy-streaming playable is the normal sufficient baseline. Add a higher-bitrate version only when the source, library gap, and available capacity make it useful as a future parent/master candidate.
- **High-value work**: evaluate a compact version, a balanced everyday version, and a higher-bitrate preservation-oriented version independently. Produce the useful subset supported by the source; do not manufacture tiers from a weak source or create materially duplicate files.

This profile is an internal production decision. Spec titles and website-facing labels use only verifiable media facts: language, subtitle treatment, codec, cut, resolution, and measured size. Add a series per-episode size range only after the selected outputs have passed QC, calculated in decimal GB from their actual file sizes.

- `compact_exists`: an exact existing playable compact version is verified. Record its spec/page or Media Assets evidence.
- `compact_selected`: the current bounded production includes a compact version. Record the intended compact spec and target size.
- `compact_deferred`: no compact version will be made in this batch. Record a concrete reason, such as source quality, a user-requested high-bitrate-only result, an occupied equivalent compact spec, or a later explicitly scheduled batch.

For a movie, `film-ledger select-variant` requires `--compact-decision` and `--compact-detail` to retain this decision with the selected variant. A movie may proceed with only one version only after this decision is recorded. Series remain episode-aware: assess compact coverage using actual per-episode sizes and existing specs, but do not force a duplicate season-wide delivery.

## Deferred Decisions

When a candidate is uncertain but not blocking the batch, record the question and continue with deterministic items. Ask the user at the end of the batch with enough evidence: source, subtitles, audio, Notion state, expected output, and risk.

## Queue Monitoring

- A queue watcher should compare the current input directory scan against a saved state file and report new, removed, and materially changed top-level entries.
- New queue entries are candidates for analysis, not automatic encodes. Run the hard gates and priority signals before starting work.
- During long encodes or uploads, use waiting time for Notion metadata, manual-upload organization, and Media Assets dry-runs instead of idling.
- Queue scans may create metadata-only work pages for valuable missing works even when no encode is started.
