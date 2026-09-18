---
name: wwp-subtitle-acquirer
description: Use when a WWP movie or series source lacks verified Chinese subtitles and the workflow should search multiple subtitle providers, collect candidates through a local browser companion or API, compare release compatibility and quality, and hand an external subtitle to playable QC.
---

# WWP Subtitle Acquirer

Do not create or reopen a subtitle-acquisition task when the associated work
has an explicit closed expansion scope (`scope_state=closed` or a verified
`[规格扩展:CLOSED]` decision). A closed decision is stronger than missing
subtitle evidence: retain the source for possible future user-directed work,
but remove it from the actionable acquisition queue until the user reopens the
expansion.

Use this skill only after source probing and hard-subtitle inspection show that a
subtitle-dependent work has no usable Chinese subtitle. It extends playable
production; it does not weaken the Chinese-subtitle hard gate for a foreign-
original-audio branch. Do not route a verified Mandarin-dubbed (`国配`) branch
here merely because it lacks Chinese subtitles: that branch may complete now,
with subtitle acquisition retained only as optional later enrichment.

After inspecting rendered PGS samples, persist the decision before creating or
resuming provider work:

```powershell
node tools/film-ledger.mjs review-subtitles --source-id <id> --subtitle-state confirmed_missing `
  --subtitle-method "PGS multi-point visual review" `
  --subtitle-samples '["<sample-early>","<sample-middle>","<sample-late>"]'
```

Use `verified` when usable Chinese subtitles are confirmed, or `unknown` when
the samples are inconclusive. Do not represent a completed visual review only
as legacy `verifiedChinese:false`; that value intentionally remains unknown and
will not create the durable acquisition task.

The film ledger is the integration boundary. A normal film cycle creates or
reuses one durable `subtitle_acquisition` workflow task only for an explicit
`confirmed_missing` state. The current v0.1 Companion can collect provider
candidates, but the automatic task-to-Bridge request, artifact download,
ranking, and task completion path remain future work; until then, keep the
ledger task pending/deferred/waiting_user instead of treating it as completed.

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
   After creating the Companion task, record the ledger handoff with
   `node tools/film-ledger.mjs wait-task --task <id> --failure-detail <exact action>`
   so the source is classified as waiting for a named human action instead of
   remaining a generic AI-pending item.
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
