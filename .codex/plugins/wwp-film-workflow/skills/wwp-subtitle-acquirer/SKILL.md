---
name: wwp-subtitle-acquirer
description: Use when a WWP movie or series source lacks verified Chinese subtitles and the workflow should search multiple subtitle providers, collect candidates through a local browser companion or API, compare release compatibility and quality, and hand an external subtitle to playable QC.
---

# WWP Subtitle Acquirer

Use this skill only after source probing and hard-subtitle inspection show that a
subtitle-dependent work has no usable Chinese subtitle. It extends playable
production; it does not weaken the Chinese-subtitle hard gate for a foreign-
original-audio branch. Do not route a verified Mandarin-dubbed (`国配`) branch
here merely because it lacks Chinese subtitles: that branch may complete now,
with subtitle acquisition retained only as optional later enrichment.

## Initial Route

1. Build one `wwp-subtitle-search.v1` request containing verified work identity,
   source filename, edition/release markers, duration, frame rate, season/episode
   identity, wanted languages, and enabled providers.
2. Create or reuse the content-addressed task with
   `../../scripts/subtitle_companion_bridge.py create-task`. The command starts
   or reuses the short-lived loopback Bridge by default.
3. For a browser-backed provider, ask the user to open the provider in the real
   signed-in browser, refresh the local Companion task list, search, and capture
   the current results/detail page. The Companion may collect evidence, but it
   must not bypass login, CAPTCHA, download confirmation, copyright removal, or
   another access-control decision.
4. Keep each provider adapter factual. It reports titles, release text,
   languages, formats, badges, author/rating evidence when visible, detail URL,
   raw evidence, and later artifact metadata. It does not choose the winner.
5. Compare all provider results locally using
   `../../references/subtitle-quality-rules.md`. Release compatibility is a hard
   gate; popularity or an `official` badge cannot rescue a mismatched edition.
6. After an authorized subtitle file is obtained, validate archive contents,
   text encoding, language, coverage, and timing. Generate real-dialogue samples
   at the beginning, middle, and end before handing the file to
   `wwp-playable-encoder --subtitle-file`.
7. Preserve provider, author/uploader, detail URL, original filename, SHA-256,
   claimed language/format, timing correction, comparison decision, and QC
   evidence in the production manifest and local ledger notes.
8. If no candidate passes identity, edition, timing, and usage gates, mark the
   production decision `deferred` with the searched providers and failure reason.
   Continue catalog metadata work independently.

## Browser Companion

Install the local userscript from:

```text
.codex/plugins/wwp-film-workflow/assets/userscript/wwp-subtitle-companion.user.js
```

The initial Companion supports SubHD as a provider adapter. It discovers only
`127.0.0.1:8818..8838`, verifies the Bridge identity, requires an explicit task
refresh and page-capture click, claims a task with a browser client ID, and sends
normalized candidates back to the workspace. It does not yet download subtitle
artifacts; downloading and artifact handoff remain a visible human step in v0.1.
After the Bridge starts, open the `installUrl` returned by `/health` in a browser
that has Tampermonkey and confirm the userscript installation there.

## Task Request Example

```json
{
  "work": {
    "title": "盗梦空间",
    "originalTitle": "Inception",
    "year": 2010,
    "imdbId": "tt1375666",
    "type": "movie"
  },
  "source": {
    "fileName": "Inception.2010.1080p.BluRay.REMUX.mkv",
    "durationSeconds": 8880.5,
    "fps": "23.976",
    "release": "BluRay REMUX"
  },
  "languages": ["zh-Hant", "zh-Hans"],
  "providers": ["subhd"]
}
```

Create the task:

```powershell
python .codex/plugins/wwp-film-workflow/scripts/subtitle_companion_bridge.py create-task `
  --workspace . `
  --request .local-data/subtitle-search-request.json
```

List current tasks:

```powershell
python .codex/plugins/wwp-film-workflow/scripts/subtitle_companion_bridge.py list --workspace .
```

## Safety Boundary

- The workspace is authoritative for task state, provider comparison, and the
  selected artifact. Browser DOM is evidence, not the ledger.
- The userscript runs inside an already opened provider page and never stores
  site passwords in the plugin or Bridge.
- Use explicit user action for login, CAPTCHA, access notices, and the first
  artifact-download implementation.
- Do not automatically publish or re-upload a subtitle. Respect provider and
  subtitle-specific usage/copyright notices.
- A downloaded file is untrusted input. Extract only subtitle/text files into a
  bounded staging directory; reject executables, links, path traversal, and
  unexpected archive members.

## References

- Provider adapter and Bridge contract: `../../references/subtitle-provider-contract.md`
- Candidate quality and synchronization rules: `../../references/subtitle-quality-rules.md`
- End-to-end subtitle acquisition flow: `../../references/subtitle-workflow.md`
- Existing playable subtitle rules: `../../references/encoding-rules.md`
