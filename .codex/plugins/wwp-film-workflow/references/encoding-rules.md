# WWP Encoding Rules

## Defaults

- Container: MP4.
- When writing to a temporary path that does not end in `.mp4`, pass `-f mp4` explicitly or use a temp name that preserves the `.mp4` extension.
- Codec direction: HEVC first unless the user or compatibility requirement says otherwise.
- Playable output directory: user-specified, otherwise `E:\video_made`.
- Subtitle-dependent versions: burn the selected Chinese subtitle into the video by default.
- Mandarin-language films: prefer no hard subtitles unless the source already has unavoidable hard subtitles.
- Notion playable uploads must stay below the workflow cap of 5,000,000,000 bytes unless the user explicitly changes it. Official Notion wording may use 5 GiB, but keep the lower decimal-byte cap as upload safety margin. Target about 4.7-4.9GB when making a high-bitrate version; do not plan 6GB as a Notion upload candidate.
- If an encode is trending over the limit, stop early and recalculate the bitrate instead of finishing an unusable upload candidate.

## Subtitle Priority

Choose in this order when tracks are real and usable:

1. Traditional Chinese-English bilingual
2. Simplified Chinese-English bilingual
3. Traditional Chinese
4. Simplified Chinese

Report the full available subtitle set and the subset produced. More subtitle variants are optional capacity work, not required completion.

## Audio and Version Rules

- Hong Kong films: Cantonese plus Chinese subtitles first; Mandarin can be supplemental when available.
- Mandarin-language films: no hard subtitles first unless the source forces them.
- Director cuts: consider as separate valuable specs.
- Commentary tracks: produce only when Chinese subtitles or Chinese assistance make the commentary usable.
- Original audio plus Chinese subtitles remains the standard route for foreign-language films.

## Stream Reuse

- Different hard-subtitle variants usually cannot reuse the same encoded video stream because the pixels differ.
- Same picture and same hard subtitles with different audio can reuse video stream via remux/stream-copy or audio-only encode.
- Soft subtitle delivery can reuse the same video stream with different subtitle tracks, but this is not the default WWP playable delivery.
- Commentary, Mandarin, Cantonese, and original-audio combinations should reuse a QC-passed video stream when the visual stream is identical.
- When creating multiple audio variants from the same visual stream, budget the shared video stream so each final MP4 remains below the Notion playable upload limit after audio and MP4 mux overhead are added.
- Plan the video/audio/subtitle matrix before encoding many variants. Use `scripts/plan-stream-variants.mjs` for a dry-run explanation.

## QC

- Probe source and final files with `ffprobe`.
- Dolby Vision Profile 5 sources are not final-safe by default. Treat Profile 5 as blocked for normal playable production unless the user explicitly chooses a compatible tone-mapping/HDR strategy or a different source is unavailable and accepted.
- For HDR/DV/color uncertainty, subtitle timing uncertainty, or PGS subtitles, create a short sample and visually inspect real subtitle timestamps.
- HDR/DV sources that are encoded to SDR-looking `yuv420p` without explicit tone mapping must be treated as color-risk samples. If the sample looks dark, flat, clipped, or washed out, do not use the same command for final delivery; decide between tone mapping, HDR-preserving output, or skipping.
- When a probe shows no subtitle stream but the source may contain hard subtitles, confirm with contact sheets or playback before applying the Chinese-subtitle hard gate.
- Contact sheets are useful for color, framing, burn-in, and gross artifact checks, but do not replace sample playback.
- Preserve probe JSON and production decisions for Media Assets.

## Observed Failure Patterns

- BDMV plus PGS hard-sub encodes can finish all frames and still fail at final MP4 mux with errors like `pts/dts pair unsupported` or `Error submitting a packet to the muxer`.
- If a direct MP4 encode fails at the tail, do not delete the `.part` file automatically. Probe it first; when `ffprobe` reads a complete video/audio stream, a copy-remux with `-c copy -movflags +faststart` may recover the final MP4.
- A safer production pattern for BDMV/PGS sources is to encode to an MKV work file first, then remux to MP4. Treat the final MP4 probe as authoritative because the intermediate MKV can show bogus duration when source timestamps are discontinuous.
- For HDR/PQ WEB-DL series sources, use explicit tone mapping before burning subtitles into SDR MP4. On Windows, the ffmpeg `subtitles=` filter is less fragile when local `.srt` paths use forward slashes.
