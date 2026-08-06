---
name: wwp-film-candidate-selector
description: Use when analyzing a user-specified WWP video/source input directory and deciding which movie, series, version, source, language, or supplemental spec is worth producing or skipping.
---

# WWP Film Candidate Selector

Use this skill before opening heavy encodes or uploads. The goal is to choose defensible production targets, not to process every file in an input directory.

## Workflow

1. Read the user-provided input directory. If none is provided, ask or infer a candidate from the current task context and confirm it.
2. Scan with `../../scripts/scan-input-directory.mjs` for works, versions, discs, remuxes, ISOs/BDMV folders, extras, NFOs, subtitle packs, audio tracks, director cuts, commentary tracks, and series episodes.
3. Group variants of the same work together before scoring.
4. Check Notion state: new work, existing work with weak specs, existing work with sufficient specs, or ambiguous duplicate. Inspect the intended spec child page and its media blocks, not only the work-level properties. An exact or materially equivalent playable asset is a production blocker unless the proposed result adds a distinct cut, language, subtitle treatment, resolution, or useful size tier.
5. Apply hard gates and priority rules from `../../references/decision-rules.md`.
6. Classify each eligible movie as standard-value or high-value internally. For standard-value work, start with the compact playable and add a larger version only when it has clear future-master value. For high-value work, evaluate compact, balanced, and preservation-oriented versions independently; create only source-supported, non-duplicate variants. Spec titles contain only verifiable media facts. For series, set the per-episode size range from actual QC-passed outputs in decimal GB, never a pre-encode estimate.
7. For every movie that can enter playable production, record `compact_exists`, `compact_selected`, or `compact_deferred` with concrete evidence before selecting an encode. A compact version is not automatically required, but silently omitting the decision is not allowed.
8. Produce a ranked action list: metadata-only now, make playable now, defer for user decision, skip playable with reason, or route to series/source/archive workflow.

## Hard Gates

- Chinese subtitles are required for subtitle-dependent versions unless the user explicitly overrides. A verified Mandarin-dubbed (`国配`) version is Chinese-language playable and does not become subtitle-dependent merely because it lacks Chinese subtitles.
- Internal subtitle tracks, sidecar subtitles, and visually confirmed source hard subtitles are all valid subtitle evidence.
- Do not auto-search subtitle sites in v1; record this as a future extension when relevant.
- Skip sources with severe quality, color, subtitle, audio, or encode risk unless the user explicitly asks to experiment.
- Do not treat "already in the folder" as sufficient reason to encode.
- Do not encode an exact or materially equivalent spec that already has a playable video. A reusable target page is not evidence that it is empty.

## Priority Signals

- High reputation, high influence, or obvious library value.
- Smooth encode path, reliable subtitles, and low upload risk.
- Children's films with Mandarin dubbing or family-friendly value.
- Existing Notion works with valuable missing specs, such as Mandarin/Cantonese dub, director cut, commentary with Chinese assistance, or a better 3-4GB-ish playable.

## Chinese-Dub Selection

- Automatically select a verified Mandarin-dubbed playable when the work is a children's, animation, or family title, or when an existing library work has a valuable missing Mandarin/Cantonese spec. No user confirmation is required when normal source, QC, duplicate, storage, and upload gates pass.
- For an ordinary foreign-language film, or for a Hong Kong film after the preferred Cantonese-plus-Chinese-subtitle route is covered, report the verified Mandarin track and ask the user whether to make a `国配` spec. Continue deterministic non-Mandarin work while waiting.
- Before asking, show the planned bitrate tiers and resulting file count. If compact and higher-bitrate tiers are both planned, do not multiply both tiers by the Mandarin variant without explicit user approval.
- Treat this confirmation rule as a production-matrix gate, not as permission to guess the audio identity. `国配` still requires independently verified Mainland Mandarin evidence.
- After `国配` is verified and selected, allow it to proceed without Chinese subtitles. Record subtitles as an optional later enhancement, but do not defer, hide, or reject that Mandarin branch for missing Chinese subtitles alone. Keep the subtitle hard gate on any separate foreign-original-audio branch.

## Output

Return a short table or bullets with title, detected variants, Chinese subtitle/audio evidence, Notion status, recommended action, and any deferred questions. Continue with deterministic candidates before interrupting the batch for uncertain choices.

When a scanned work is worth cataloging but playable production is not suitable, recommend metadata-only page creation/backfill instead of treating the whole item as skipped.
