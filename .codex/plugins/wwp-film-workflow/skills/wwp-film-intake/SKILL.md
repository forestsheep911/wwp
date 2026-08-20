---
name: wwp-film-intake
description: Use when new movie or series source directories enter WWP, when a queue root is scanned, or when discovered resources still need identity, duplicate, Notion-state, and metadata-first routing before any encode decision.
---

# WWP Film Intake

This is the entry stage for every newly discovered resource. A source entering the input directory is a work item for analysis, not an automatic encode request.

When one discovered directory contains several independently catalogued seasons, parts, or series entries, split it into member sources before production. Bind each member to its verified Notion work page and keep the collection parent only as discovery lineage; do not attach all episodes to the first title/year found in the folder name.

## Responsibilities

1. Resolve the user-specified input root or an enabled ledger root. Historical paths are examples, never fixed defaults.
2. Run a bounded scan and import discoveries into the local SQLite ledger.
   The scan fingerprint must be independent from the human-facing sample count. A
   first-seen source always creates a pending intake task, and the fingerprint
   includes the newest file modification time so same-size replacements are not
   silently treated as unchanged.
   real file-count, byte-count, subtitle, or fixed-media-evidence change reopens
   the existing source's intake task even when that source is already bound to a
   work. This is how newly added episodes or replacement media inside an old
   directory re-enter the workflow without creating another source identity. A
   completed work does not permanently suppress that explicitly reopened source:
   it reappears as a production-selection candidate only while its intake task
   is pending. An unchanged scan must not reopen completed work or invite a
   duplicate encode.
3. For each new or changed source, identify the work using filename, folder, season/episode, original-language title, year, and known external IDs.
   If one directory is a collection, box set, multi-disc package, or contains multiple standalone film ISOs, split it into member sources before binding any work. Never bind a collection directory itself to one arbitrary film; each member keeps its own work identity, source evidence, and production decision. Duplicate 2D/3D or alternate-disc members may bind to the same work as separate sources.
   For series, verify the mapped integer span against the canonical external episode count before binding. When files exceed that count, treat the excess as an identity incident requiring a sequel/season/part/extras decision, not as additional episodes of the first matching work.
4. Before evaluating subtitles, quality, or bitrate expansion, verify that the source path contains a media payload: a playable video file, a playlist with referenced media, or a complete disc structure. A directory containing only sidecar subtitles, artwork, or release notes is not a source. Record `missing_media_payload` with any discovered subtitle clues and keep it out of production candidates until the media itself returns.
5. Search existing Notion coverage through multi-alias identity preflight before creating anything. Preserve possible duplicates for review instead of silently creating a second work page.
6. Create or repair a work-level metadata task even when playable production is unsuitable, missing subtitles, deferred, or blocked by color/quality risk.
7. Route the source to one of: metadata-only, production evaluation, source/archive handling, series handling, deferred user decision, or rejected with reason.

## Queue Contract

Use the local ledger, not a Notion watcher loop:

```powershell
node tools/film-ledger.mjs queue --stage intake --limit 3 --json
node tools/film-ledger.mjs queue --stage metadata --limit 3 --json
```

An `intake` task is complete only after the source is bound to a verified work identity and its metadata task is created. It is not complete merely because a folder was scanned.

## Gates

- Chinese subtitle evidence is required for subtitle-dependent playable variants, but never gates catalog metadata.
- A probe, extraction, or source-read timeout is an `unknown` evidence result, never evidence that an audio or subtitle stream is absent. Record the failed method and error in source evidence, then use one bounded retry, a different representative episode, or a later follow-up task before deciding that a subtitle-dependent variant is unavailable.
- A poor or risky source may be rejected for playback while its work page is still created or enriched.
- Metadata-first work and playable production are independent tracks. Do not wait for encoding before starting sourced metadata.
- Keep uncertain matching, duplicate risk, missing subtitle identity, and user-only decisions in a task reason; continue other deterministic tasks.
- A collection parent may be marked complete only after all recognizable members have been represented as child/member sources and each member has its own identity or an explicit deferred reason.
