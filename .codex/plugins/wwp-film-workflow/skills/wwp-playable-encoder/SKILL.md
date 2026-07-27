---
name: wwp-playable-encoder
description: Use when planning or running WWP playable transcodes, ffprobe/QC checks, subtitle and audio variant choices, HEVC/MP4 output, hard-sub delivery, or stream reuse decisions.
---

# WWP Playable Encoder

Use this skill for playable outputs that people will watch directly. Source archive handling is separate.

## Defaults

- Output directory: user-specified path, otherwise `E:\video_made`.
- Container: MP4.
- Codec direction: HEVC preferred unless the user asks otherwise or compatibility requires another choice.
- HEVC/MP4 browser compatibility: explicitly mux the video track as `hvc1` (for ffmpeg, `-tag:v hvc1`). Do not ship an `hev1` sample entry as Android-browser compatible merely because the codec is HEVC and the MP4 is faststart.
- Subtitle delivery: burn selected Chinese subtitles into the video for subtitle-dependent versions; when the source already has a verified hard subtitle, use the no-subtitle-stream path and record that fact instead of attempting to overlay a nonexistent stream. PGS/bitmap subtitles use `--subtitle-stream`; ASS/SSA text subtitles must first be extracted to a subtitle file and use `--subtitle-file`, which routes through libass.
- Mandarin-language films: prefer no hard subtitles unless subtitles are already burned into the source and cannot be separated.
- Size target: keep Notion-bound playable MP4 files below the workflow cap of 5,000,000,000 bytes unless the user explicitly changes it. Official Notion wording may use 5 GiB, but this workflow keeps the lower decimal-byte cap as upload safety margin. For high-bitrate manual-upload candidates, usually aim for about 4.7-4.9GB, never a 6GB upload candidate.
- Before a full encode, check free space on the output volume for the work MKV, MP4 remux, and final file together. The standard encoder refuses a full run when the volume has less than roughly `2 * max-bytes + 512MiB`; choose another explicitly permitted output directory or wait for cleanup. Duration-limited smoke samples are exempt.
- Dolby Vision/HDR sources require an explicit, validated color-management path before SDR delivery. Do not feed a 10-bit DV source directly into an SDR NVENC encode and infer that the result is correct from the output metadata.

## Flow

1. Probe source streams with `../../scripts/probe-media.mjs` or direct `ffprobe`.
2. Identify HDR/DV/color risk, subtitle tracks, audio tracks, duration, resolution, and frame rate.
3. For uncertain color/subtitle timing, make a short sample before full encode. A language tag alone does not prove that a subtitle stream contains Chinese text.
4. Treat dark/flat/green/magenta HDR-to-SDR samples as a blocker for final delivery until a validated tone-mapping or HDR-preserving path is chosen. Do not upload or create a playable Media Assets row for a visibly wrong-color encode.
5. Choose subtitle/audio variants using `../../references/encoding-rules.md`.
6. Before starting a long encode, prepare the Notion destination through `wwp-notion-publisher` when the result may be API-uploaded or manually uploaded. Record the movie spec page ID, or the series spec and episode page IDs, so finished files have a precise upload target. Preparation must also prove that the intended destination is empty. If the exact movie spec already contains a video block, stop before encoding and evaluate the existing playable asset; do not treat reuse of that page as successful preparation for a new encode.
7. Use `../../scripts/plan-stream-variants.mjs` when combining hard subtitles, soft subtitles, Mandarin/Cantonese/original/commentary audio, or director cuts.
8. Use `../../scripts/transcode-hevc-mp4.mjs` for the standard PGS-to-HEVC/MP4 path, pass `--subtitle-stream none` for verified hard-sub sources, or pass `--subtitle-file <ass|ssa>` for extracted ASS/SSA text subtitles. Run it first with `--duration` for a bounded smoke sample and inspect a timestamp where dialogue is known to exist; a frame without visible subtitles is a failed smoke test even when ffmpeg exits successfully. The script encodes to MKV and remuxes to MP4 so a late MP4 mux failure cannot be mistaken for a complete output.
   Use `--scale 1920x1080` when the intended spec is 1080p and the source is 4K; keep the scale choice in the production manifest. Use `--video-bitrate <rate>` when the target spec is size-oriented, calculating the rate from duration, audio overhead, and the 5GB cap; use `--cq` for exploratory or compact outputs. For a confirmed HDR/Dolby Vision source, use the explicit `--tone-map-sdr` option only after a short sample proves BT.709 output and acceptable colors. Do not apply it to ordinary SDR sources.
9. Generate QC artifacts, including contact sheets when helpful.
10. Probe final files and preserve the JSON/manifest for Media Assets. For HEVC/MP4, require `codec_tag_string=hvc1`; an `hev1` result must be losslessly remuxed and re-probed before Android-browser delivery.
11. Verify the final byte size is below the Notion playable upload limit before calling it upload-ready.
12. Import the final QC manifest into the local ledger with `node tools/film-ledger.mjs import-production-manifest --production-manifest <manifest.json> --json`. A local encode is not removed from the workflow at this point: its ledger entry remains until the pre-created Notion structure, uploaded media block, and Media Assets row are all verified.

When starting `ffmpeg.exe` in the background from PowerShell, pass a single explicitly quoted command-line string to `Start-Process -ArgumentList`; do not pass an unquoted argument array. Probe the exact source path with a one-second direct `ffmpeg` read first when it contains spaces or punctuation such as `!`, then confirm the background log advances before treating the encode as started.

If a full encode burns PGS subtitles and the direct MP4 muxer returns FFmpeg's `AVERROR_PATCHWELCOME` / `Not yet implemented in FFmpeg, patches welcome` at the end of the stream, treat the result as incomplete rather than QC-passed. Preserve the log, discard the corrupt `.part` after diagnosis, rerun the video encode to a Matroska intermediate, then perform a separate stream-copy remux to MP4 with `-tag:v hvc1`. Probe the finalized MP4 and confirm duration, stream count, and byte size before handoff; do not use the corrupt `.part` as a recovery source.

## Variant Rules

- Subtitle priority is Traditional Chinese-English bilingual, Simplified Chinese-English bilingual, Traditional Chinese, then Simplified Chinese.
- Hong Kong films prefer Cantonese plus Chinese subtitles first; Mandarin can be supplemental when available.
- Treat a source label such as `Chinese`, `zh`, or a filename marker as insufficient to identify Mandarin versus Cantonese. When a disc has multiple Chinese audio streams, preserve the stream IDs and verify the mapping by trusted source evidence or human listening before naming a result `国配`, `粤配`, or `台配`.
- If the user reports that a finished file sounds Cantonese, treat that report as the current audio evidence and route it to a `粤配` spec. Do not create or claim a `国配` spec until a Mandarin stream is separately verified; if it is not verified, leave the Mandarin variant for later rather than guessing.
- Commentary tracks are worth producing only when Chinese subtitles or Chinese assistance make them usable.
- Director cuts should be considered as separate valuable specs.
- Multiple subtitle variants are optional capacity work, not a hard requirement; report available subtitle tracks and produced variants.

## Completion Gate

Before handing off to Notion, report final path, exact byte size, whether it is below the Notion playable upload limit, target Notion page ID(s), ffprobe-derived metadata (including the HEVC `codec_tag_string`), selected subtitle/audio tracks, QC result, and any known limitations.
