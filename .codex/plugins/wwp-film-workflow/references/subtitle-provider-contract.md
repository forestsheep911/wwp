# Subtitle Provider Contract

Subtitle providers are adapters around either a browser-resident Companion or a
documented API. Provider-specific code performs site actions and extracts
evidence; it never owns cross-provider ranking or the final production decision.

## Local Bridge

- Service: `wwp-subtitle-companion-bridge`
- Loopback range: `127.0.0.1:8818..8838`
- Runtime root: `<workspace>/.local-data/wwp-subtitle-bridge/`
- Task schema: `wwp-subtitle-search.v1`
- Discovery: `GET /health`, followed by authenticated task requests.
- Task endpoints: list, read, claim, candidate submission, and terminal/deferred
  result submission.

Task state starts as `ready`. A provider client claims it with provider ID,
client ID, and exact task hash. A claim is a short lease rather than ownership;
an abandoned lease expires back to `ready`. Candidate capture releases the claim
and moves the task to `candidates_ready`. `downloaded`, `selected`, and
`deferred` are terminal for automatic claims; `failed` and `deferred` may be
explicitly retried from the local CLI.

## Normalized Candidate

Provider adapters should emit available fields without inventing missing data:

```json
{
  "id": "subhd:58k0EQ",
  "provider": "subhd",
  "workTitle": "盗梦空间",
  "releaseTitle": "Inception.2010.1080p.BluRay",
  "detailUrl": "https://subhd.com/a/58k0EQ",
  "languageLabels": ["简体", "繁体"],
  "formatLabels": ["ASS", "SRT"],
  "badges": ["官方字幕"],
  "fileNames": [],
  "rawText": "provider-visible evidence"
}
```

The adapter may add uploader, rating, download count, upload time, FPS, runtime,
edition, season, episode, release group, comments, artifact URL, and provider
notice fields when they are actually visible. Preserve the raw detail URL and a
bounded evidence excerpt so local ranking remains auditable after selectors
change.

## Provider Isolation

- Keep selectors and site-specific routes inside the provider adapter.
- Do not put site DOM assumptions in the Bridge or candidate ranker.
- A provider failure returns structured evidence and does not block another
  enabled provider.
- Page changes must fail closed with zero candidates or an explicit error; do
  not reuse stale candidates under a different task hash.
- Login and access state remain in the real browser. The Bridge stores no site
  password, cookie, or bearer token.

## Initial SubHD Adapter

The v0.1 userscript supports current SubHD mirror hosts. It builds a normal
`/search/<query>` navigation and collects unique `/a/<id>` subtitle detail links
from a result page, or captures one open detail page. It deliberately stops
before automated artifact download. A later adapter revision may send a small
authorized subtitle artifact back to the Bridge, but must keep download notices,
verification, safe archive extraction, and provenance recording visible.

