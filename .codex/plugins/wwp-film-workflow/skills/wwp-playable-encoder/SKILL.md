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
- Size target: keep Notion-bound playable MP4 files below 5,000,000,000 bytes unless the user verifies a newer Notion limit. For high-bitrate manual-upload candidates, usually aim for about 4.7-4.9GB.

## Flow

1. Probe source streams with `../../scripts/probe-media.mjs` or direct `ffprobe`.
2. Identify HDR/DV/color risk, subtitle tracks, audio tracks, duration, resolution, and frame rate.
3. For uncertain color/subtitle timing, make a short sample before full encode.
4. Treat dark/flat HDR-to-SDR samples as a blocker for final delivery until tone mapping or HDR-preserving output is chosen.
5. Choose subtitle/audio variants using `../../references/encoding-rules.md`.
6. Use `../../scripts/plan-stream-variants.mjs` when combining hard subtitles, soft subtitles, Mandarin/Cantonese/original/commentary audio, or director cuts.
7. Generate QC artifacts, including contact sheets when helpful.
8. Probe final files and preserve the JSON/manifest for Media Assets.
9. Verify the final byte size is below the Notion playable upload limit before calling it upload-ready.

## Variant Rules

- Subtitle priority is Traditional Chinese-English bilingual, Simplified Chinese-English bilingual, Traditional Chinese, then Simplified Chinese.
- Hong Kong films prefer Cantonese plus Chinese subtitles first; Mandarin can be supplemental when available.
- Commentary tracks are worth producing only when Chinese subtitles or Chinese assistance make them usable.
- Director cuts should be considered as separate valuable specs.
- Multiple subtitle variants are optional capacity work, not a hard requirement; report available subtitle tracks and produced variants.

## Completion Gate

Before handing off to Notion, report final path, exact byte size, whether it is below the Notion playable upload limit, ffprobe-derived metadata, selected subtitle/audio tracks, QC result, and any known limitations.
