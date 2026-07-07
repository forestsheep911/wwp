---
name: wwp-source-archive-operator
description: Use when WWP work involves source or original-disc archives, remux/BDMV/ISO packaging, 7z volumes, source-only Notion pages, manual source upload alignment, or explicit Notion API source upload.
---

# WWP Source Archive Operator

Source/original-disc work is optional and guarded. It is different from playable production.

## Default Position

- New film production does not automatically upload original discs or source archives.
- If the user manually uploaded source files, align manifests and Media Assets rather than uploading again.
- Source-only availability must not be presented as playable availability.

## Workflow

1. Classify the source: remux, BDMV, ISO, original disc dump, encoded source, archive volumes, subtitle pack, or extras.
2. Decide whether the user asked for source archive handling or whether playable production should continue without source upload.
3. For manual upload alignment, read Notion blocks, source manifests, and file sizes, then reconcile Media Assets/source memo.
4. For explicit API upload, prepare volume manifests and retry-safe upload state before applying.
5. Report availability as source-only, needs-processing, blocked, playable, or unknown based on actual state.

## Guardrails

- Large source uploads must not silently switch to a bandwidth-expensive or proxy-heavy path.
- Do not remove operational prefixes such as download-only labels merely because source files exist.
- Keep source/archive manifests under `.local-data/source-archives/` unless the user specifies another local state path.

## Reference

Read `../../references/source-archive-rules.md` and `../../references/script-map.md`.
