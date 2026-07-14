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
- Subtitle delivery: burn selected Chinese subtitles into the video for subtitle-dependent versions.
- Mandarin-language films: prefer no hard subtitles unless subtitles are already burned into the source and cannot be separated.
- Size target: keep Notion-bound playable MP4 files below the workflow cap of 5,000,000,000 bytes unless the user explicitly changes it. Official Notion wording may use 5 GiB, but this workflow keeps the lower decimal-byte cap as upload safety margin. For high-bitrate manual-upload candidates, usually aim for about 4.7-4.9GB, never a 6GB upload candidate.
- Dolby Vision/HDR sources require an explicit, validated color-management path before SDR delivery. Do not feed a 10-bit DV source directly into an SDR NVENC encode and infer that the result is correct from the output metadata.

## Flow

1. Probe source streams with `../../scripts/probe-media.mjs` or direct `ffprobe`.
2. Identify HDR/DV/color risk, subtitle tracks, audio tracks, duration, resolution, and frame rate.
3. For uncertain color/subtitle timing, make a short sample before full encode.
4. Treat dark/flat/green/magenta HDR-to-SDR samples as a blocker for final delivery until a validated tone-mapping or HDR-preserving path is chosen. Do not upload or create a playable Media Assets row for a visibly wrong-color encode.
5. Choose subtitle/audio variants using `../../references/encoding-rules.md`.
6. Before starting a long encode, prepare the Notion destination through `wwp-notion-publisher` when the result may be API-uploaded or manually uploaded. Record the movie spec page ID, or the series spec and episode page IDs, so finished files have a precise upload target.
7. Use `../../scripts/plan-stream-variants.mjs` when combining hard subtitles, soft subtitles, Mandarin/Cantonese/original/commentary audio, or director cuts.
8. Generate QC artifacts, including contact sheets when helpful.
9. Probe final files and preserve the JSON/manifest for Media Assets.
10. Verify the final byte size is below the Notion playable upload limit before calling it upload-ready.
11. Import the final QC manifest into the local ledger with `node tools/film-ledger.mjs import-production-manifest --production-manifest <manifest.json> --json`. A local encode is not removed from the workflow at this point: its ledger entry remains until the pre-created Notion structure, uploaded media block, and Media Assets row are all verified.

When starting `ffmpeg.exe` in the background from PowerShell, pass a single explicitly quoted command-line string to `Start-Process -ArgumentList`; do not pass an unquoted argument array. Probe the exact source path with a one-second direct `ffmpeg` read first when it contains spaces or punctuation such as `!`, then confirm the background log advances before treating the encode as started.

## Variant Rules

- Subtitle priority is Traditional Chinese-English bilingual, Simplified Chinese-English bilingual, Traditional Chinese, then Simplified Chinese.
- Hong Kong films prefer Cantonese plus Chinese subtitles first; Mandarin can be supplemental when available.
- Treat a source label such as `Chinese`, `zh`, or a filename marker as insufficient to identify Mandarin versus Cantonese. When a disc has multiple Chinese audio streams, preserve the stream IDs and verify the mapping by trusted source evidence or human listening before naming a result `国配`, `粤配`, or `台配`.
- If the user reports that a finished file sounds Cantonese, treat that report as the current audio evidence and route it to a `粤配` spec. Do not create or claim a `国配` spec until a Mandarin stream is separately verified; if it is not verified, leave the Mandarin variant for later rather than guessing.
- Commentary tracks are worth producing only when Chinese subtitles or Chinese assistance make them usable.
- Director cuts should be considered as separate valuable specs.
- Multiple subtitle variants are optional capacity work, not a hard requirement; report available subtitle tracks and produced variants.

## Completion Gate

Before handing off to Notion, report final path, exact byte size, whether it is below the Notion playable upload limit, target Notion page ID(s), ffprobe-derived metadata, selected subtitle/audio tracks, QC result, and any known limitations.
