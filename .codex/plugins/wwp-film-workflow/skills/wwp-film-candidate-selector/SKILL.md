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
4. Check Notion state: new work, existing work with weak specs, existing work with sufficient specs, or ambiguous duplicate.
5. Apply hard gates and priority rules from `../../references/decision-rules.md`.
6. Produce a ranked action list: metadata-only now, make playable now, defer for user decision, skip playable with reason, or route to series/source/archive workflow.

## Hard Gates

- Chinese subtitles are required for subtitle-dependent versions unless the user explicitly overrides.
- Internal subtitle tracks, sidecar subtitles, and visually confirmed source hard subtitles are all valid subtitle evidence.
- Do not auto-search subtitle sites in v1; record this as a future extension when relevant.
- Skip sources with severe quality, color, subtitle, audio, or encode risk unless the user explicitly asks to experiment.
- Do not treat "already in the folder" as sufficient reason to encode.

## Priority Signals

- High reputation, high influence, or obvious library value.
- Smooth encode path, reliable subtitles, and low upload risk.
- Children's films with Mandarin dubbing or family-friendly value.
- Existing Notion works with valuable missing specs, such as Mandarin/Cantonese dub, director cut, commentary with Chinese assistance, or a better 3-4GB-ish playable.

## Output

Return a short table or bullets with title, detected variants, Chinese subtitle/audio evidence, Notion status, recommended action, and any deferred questions. Continue with deterministic candidates before interrupting the batch for uncertain choices.

When a scanned work is worth cataloging but playable production is not suitable, recommend metadata-only page creation/backfill instead of treating the whole item as skipped.
