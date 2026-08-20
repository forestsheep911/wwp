# WWP Encoding Rules

## Defaults

- Container: MP4.
- When writing to a temporary path that does not end in `.mp4`, pass `-f mp4` explicitly or use a temp name that preserves the `.mp4` extension.
- Codec direction: HEVC first unless the user or compatibility requirement says otherwise.
- For HEVC in MP4, write the video sample entry as `hvc1`, not `hev1`. In ffmpeg commands, set `-tag:v hvc1` explicitly; do not assume the encoder or muxer default is Android-browser compatible.
- Playable output directory: user-specified, otherwise `E:\video_made`.
- Subtitle-dependent versions: burn the selected Chinese subtitle into the video by default.
- Mandarin-language films and verified Mandarin-dubbed (`国配`) variants: prefer no hard subtitles unless the source already has unavoidable hard subtitles. Missing Chinese subtitles are a non-blocking enhancement for a verified `国配` output, not an encode or completion failure.
- Notion playable uploads must stay below the workflow cap of 5,000,000,000 bytes unless the user explicitly changes it. Official Notion wording may use 5 GiB, but keep the lower decimal-byte cap as upload safety margin. Target about 4.7-4.9GB when making a high-bitrate version; do not plan 6GB as a Notion upload candidate.
- For TV series, keep one playable MP4 per episode by default and upload episodes automatically. Do not concatenate episodes merely to reduce upload count. Multi-episode collections require an explicit user instruction; every episode or approved collection must remain below 5,000,000,000 bytes.
- Compact playable versions are also valuable when a work lacks a smaller easy-streaming spec. A practical compact target is roughly 1.0-1.8GB for a feature film; exact size is less important than watchable quality, correct subtitles/audio, and a clean final probe.
- For a newly arrived batch, first-release coverage outranks supplemental depth. Give each eligible work one verified releaseable playable before spending the same constrained encoder on second or third variants for an already covered work.
- Compact is the default first release. When high and compact tiers are both definitely selected, high-first is allowed only if it does not materially delay site availability and its QC-passed visual stream is a useful parent for deriving compact. Upload high while compact is derived; otherwise make compact directly first.
- Do not let high-bitrate production crowd out compact backfill forever. When the queue is quiet, uploads are slow, or a source already has a verified high-bitrate spec, consider producing a compact version for useful works that lack one.
- Preserve already-produced compact or lower-bitrate specifications. If measured output bytes show that an existing ledger title or target size was inaccurate, correct that existing variant to the real measured size while retaining its output, Notion page, and Media Assets history. A later high-bitrate encode is additive: create a new unique ledger variant, new Notion spec child page, output filename, upload, and Media Assets row. Never overwrite the old variant to turn it into the high tier.
- If an encode is trending over the limit, stop early and recalculate the bitrate instead of finishing an unusable upload candidate.
- For Dolby Vision or other HDR sources, a direct 10-bit-to-SDR encode is not acceptable. Require a DV/HDR-aware conversion and a visual sample check. Any green/magenta cast or visibly wrong color is a hard failure: skip the playable variant rather than publishing a bad resource.

## Subtitle Priority

Choose in this order when tracks are real and usable:

1. Traditional Chinese-English bilingual
2. Simplified Chinese-English bilingual
3. Traditional Chinese
4. Simplified Chinese

Report the full available subtitle set and the subset produced. More subtitle variants are optional capacity work, not required completion.

For an original-English-audio branch, an existing Chinese-English subtitle track may be used for the bilingual specification. If a separate Chinese-only specification is requested, extract or filter the verified Chinese dialogue lines into a UTF-8 subtitle file and burn that file; do not label an English-only subtitle output as `简` or `简英`. Confirm the result at a dialogue timestamp before batching the season.

When the source provides both verified Chinese and English subtitle lines, produce or retain the bilingual-subtitle specification even if a Chinese-only English-audio specification already exists. The Chinese-only branch is an additional accessibility variant, not a substitute for the bilingual branch.

`国英双语` is an audio label, not a subtitle label: use it only when the final file contains both verified Mainland Mandarin audio and the original English audio. A file with English audio plus Chinese-English burned subtitles must be titled `英语 简英` (or `英语 繁英`), even when the source also contains a Mandarin track that was not selected. Never infer dual-audio from the source track inventory alone.

Subtitle gating is evidence-based: a filename such as `Chs&Eng`, Chinese episode titles, or the presence of a Chinese audio track does not prove that Chinese subtitles exist. Before selecting a subtitle-dependent English-audio variant, verify a Chinese subtitle stream or a matching local subtitle file and record the exact evidence. If neither exists, keep the variant deferred; do not silently publish an English-audio/no-subtitle file.

## Audio and Version Rules

- Hong Kong films: Cantonese plus Chinese subtitles first; Mandarin can be supplemental when available.
- Verified Mandarin is a default production branch for children's, animation, and family works, and for valuable missing Mandarin/Cantonese coverage on an existing library work, subject to the normal gates.
- For ordinary foreign-language films and supplemental Mandarin versions of Hong Kong films, get explicit user approval before producing `国配`. Report the number of extra outputs first; if both compact and higher-bitrate tiers are planned, do not double the tier matrix merely because compute and storage are available.
- Use `国配` only for Mainland Mandarin dubbing. Taiwan Mandarin is `台配`; Hong Kong Cantonese is `粤配`. These labels are separate spec dimensions and must remain visible in spec titles.
- The size suffix in a spec title must come from the final file's measured decimal byte count, not the source filename or an old placeholder. Render movie sizes to two decimal places, including a trailing zero: 1,394,073,253 bytes is `1.39GB`, while 1,600,000,000 bytes is `1.60GB`. Keep the explicit subtitle treatment such as `简体烧录` when Chinese subtitles are burned in.
- Treat measured ledger bytes as production truth. A planned `4GB+` or `4.7GB` label is only a target until filesystem and `ffprobe` evidence is recorded. If the finished file is materially smaller than the intended tier, correct the existing record to its actual size and decide separately whether to create the high-bitrate supplemental variant. Do not relabel a compact file upward to satisfy the plan.
- When a filename includes a size label, derive it from the completed file's measured decimal byte count before upload. A provisional target label is not final metadata; rename the local output before upload when practical. If an already-uploaded filename cannot be renamed through the API, keep `Original File Name` literal, record the measured size in Media Assets, and correct the enclosing spec range before release.
- For a TV-series spec, calculate the title size from the actual selected episode-file bytes; never use the whole-season aggregate or a nominal filename size. Render a range only when the measured minimum and maximum differ after the displayed precision, for example `0.13-0.14GB/集`; otherwise render one value such as `0.13GB/集`. Correct an existing title when measured bytes contradict it.
- Filename subtitle markers are not authoritative for burned-in subtitles. Verify with a real dialogue frame where feasible, and treat a user playback confirmation as stronger evidence than the marker when they conflict.
- A `Chinese`/`zho` stream label, a regional disc folder name, or an unverified filename is not enough to choose among `国配`/`台配`/`粤配`. Require trusted stream mapping or user listening evidence before naming the spec.
- Mandarin-language films: no hard subtitles first unless the source forces them.
- Director cuts: consider as separate valuable specs.
- Commentary tracks: when a verified commentary track exists and Chinese subtitles or Chinese assistance make it usable, produce a commentary spec whenever the source, duration alignment, and upload capacity pass the normal gates. Select it before optional duplicate language or bitrate variants. One suitable commentary spec is sufficient unless the user asks for more; do not multiply every bitrate tier just because the commentary exists.
- Original audio plus Chinese subtitles remains the standard route for foreign-language films.
- A verified `国配` output may be produced and completed without Chinese subtitles. Preserve `subtitle treatment: none` as a positive technical fact, and record that a subtitled Mandarin variant may be added later; do not mislabel the no-subtitle output as `简` or `繁`. This does not waive the subtitle requirement for a separate foreign-original-audio output.

## Stream Reuse

- Different hard-subtitle variants usually cannot reuse the same encoded video stream because the pixels differ.
- Same picture and same hard subtitles with different audio can reuse video stream via remux/stream-copy or audio-only encode.
- Prefer that reuse whenever an exact QC-passed visual parent exists, including recovery from a slow TrueHD decode path. Exact means the same cut, complete duration, framing, resolution, color/tone-map result, and burned-subtitle pixels. Verify the copied video stream after mux and never use `-shortest`; any visual or subtitle difference requires a new video encode.
- A compact tier may be derived from a QC-passed higher-bitrate output when picture, cut, audio branch, and burned subtitles are identical. Before deriving it, sample real dialogue frames from the parent and identify the visible Chinese script; filename, spec title, ledger labels, and source-track names are not authoritative. If the sampled script conflicts with existing labels, correct the parent spec, parent Media Asset, ledger variant, and the planned compact variant before upload so the derivative does not propagate the old error.
- Use `scripts/remux-audio-variant.mjs` after the first video variant passes QC when a second specification changes only the audio track. Probe both final MP4 files and confirm matching video codec, dimensions, duration, and packet-level stream-copy evidence before publication.
- Preserve the complete copied video stream in every audio variant. Do not use `-shortest`: a slightly shorter alternate audio track can truncate tail video packets and make the supposedly shared video stream differ. Require matching demuxed video SHA-256 hashes before publication.
- Soft subtitle delivery can reuse the same video stream with different subtitle tracks, but this is not the default WWP playable delivery.
- Commentary, Mandarin, Cantonese, and original-audio combinations should reuse a QC-passed video stream when the visual stream is identical.
- For a commentary branch, keep the selected commentary track explicit in the manifest and final probe. Prefer the director/filmmaker commentary when several tracks are available; otherwise choose the most useful editorial or historian commentary and report the choice. Burn the same verified Chinese subtitle into the reused video stream, then remux the commentary audio without re-encoding the video.
- When creating multiple audio variants from the same visual stream, budget the shared video stream so each final MP4 remains below the Notion playable upload limit after audio and MP4 mux overhead are added.
- For a near-5GB parent, project the replacement audio bytes from duration and target bitrate before mux. A higher-bitrate multichannel audio branch can push an otherwise valid copied video over 5,000,000,000 bytes.
- Plan the video/audio/subtitle matrix before encoding many variants. Use `scripts/plan-stream-variants.mjs` for a dry-run explanation.
- Reuse does not justify an unlimited matrix. Prefer one output per materially distinct viewing value, and omit redundant medium tiers or language/subtitle combinations that do not change the experience enough to justify production and maintenance cost.

## QC

- Probe source and final files with `ffprobe`.
- For every HEVC/MP4 final, inspect the video stream's `codec_tag_string`. Treat `hvc1` as the WWP browser-playback default. Treat `hev1` as a compatibility failure for Android-browser delivery even when the file is faststart, Range requests work, traffic is flowing, and desktop software can decode the first frame.
- For multichannel AAC delivery, preserve an explicit `channel_layout` (for example `5.1`) in the final probe; channel count alone is not a browser-audio compatibility guarantee. The corrected Sheep Detectives sample (`hvc1` HEVC MP4 plus AAC 5.1 with explicit layout) was manually verified to play audible audio through ALook's system decoder.
- The observed Android failure signature for an `hev1` MP4 is a normally rendered player with controls and a play button, sustained network traffic, but no decoded picture. A known-good `hvc1` HEVC file playing on the same device is strong evidence that the problem is the MP4 sample-entry tag rather than Artplayer, bandwidth, Blob Range support, or HEVC support in general.
- Existing `hev1` MP4 files normally do not need a full video re-encode. Make a lossless remux with `-map 0 -c copy -tag:v hvc1 -movflags +faststart`, then probe the result and verify Android-browser playback. This still rewrites the MP4 file, so preserve the source until the remux passes QC.
- Legacy HEVC MP4 files without a retained final `ffprobe` record are **not** playback-verified merely because a Notion media block and Media Assets row exist. Require `hvc1`, a browser/iOS-decodable pixel format, and AAC audio with an explicit layout before releasing or retaining them as a finished spec. When a user reports iOS/system-decoder failure, mark the entire matching legacy encode family as replacement-pending, hide it from the website by default, and recover the original/local source or download one exact file for a remux test. Re-enable only after the repaired asset, Media Assets row, website index, and targeted readback all agree.
- Dolby Vision Profile 5 sources are not final-safe by default. Treat Profile 5 as blocked for normal playable production unless the user explicitly chooses a compatible tone-mapping/HDR strategy or a different source is unavailable and accepted.
- For HDR/DV/color uncertainty, subtitle timing uncertainty, or PGS subtitles, create a short sample and visually inspect real subtitle timestamps. When a PGS stream is unlabelled or CLPI language metadata is absent/conflicting, run `render-pgs-samples.mjs` for each candidate subtitle ordinal and inspect the rendered evidence images. Do not infer Chinese from stream order, a generic `zho` audio tag, filename hints, or the mere presence of PGS; record the rendered-track result in source evidence.
- For HDR/DV delivery with a requested scale, the encoder may use CUDA pre-scaling before CPU tone mapping to avoid processing the full 4K frame. This is a performance optimization only; it does not replace the color sample gate. If PGS burn-in is incompatible with the available GPU overlay path, keep the production deferred rather than silently dropping subtitles.
- When testing an external subtitle burn with `subtitles=...`, do not prove sync using input-side `-ss` before `-i` unless the subtitle file is trimmed by the same offset. Input-side seeking can make a 00:00 subtitle appear over a later video segment and create a false-positive smoke test. Prefer full-file timestamp checks or output-side seeking after `-i`, then capture frames at known subtitle event times from the extracted subtitle file.
- HDR/DV sources that are encoded to SDR-looking `yuv420p` without explicit tone mapping must be treated as color-risk samples. If the sample looks dark, flat, clipped, or washed out, do not use the same command for final delivery; decide between tone mapping, HDR-preserving output, or skipping.
- When a probe shows no subtitle stream but the source may contain hard subtitles, confirm with contact sheets or playback before applying the Chinese-subtitle hard gate.
- Contact sheets are useful for color, framing, burn-in, and gross artifact checks, but do not replace sample playback.
- Preserve probe JSON and production decisions for Media Assets.

## Observed Failure Patterns

- BDMV plus PGS hard-sub encodes can finish all frames and still fail at final MP4 mux with errors like `pts/dts pair unsupported` or `Error submitting a packet to the muxer`.
- If a direct MP4 encode fails at the tail, do not delete the `.part` file automatically. Probe it first; when `ffprobe` reads a complete video/audio stream, a copy-remux with `-c copy -movflags +faststart` may recover the final MP4.
- A safer production pattern for BDMV/PGS sources is to encode to an MKV work file first, then remux to MP4. Treat the final MP4 probe as authoritative because the intermediate MKV can show bogus duration when source timestamps are discontinuous.
- For HDR/PQ WEB-DL series sources, use explicit tone mapping before burning subtitles into SDR MP4. On Windows, the ffmpeg `subtitles=` filter is less fragile when local `.srt` paths use forward slashes.
