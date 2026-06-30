# WWPDW

This repository keeps two directions separate:

- the original skill direction
- the private web cache/player direction in this workspace

Current web-cache MVP:

- `apps/web`: thin React/Vite interface
- `apps/api`: Node HTTP API for search, cache requests, status, and playback SAS URLs
- `apps/worker`: Container Apps Job worker for resolving and caching media
- `packages/cache-store`: local and Azure cache backends
- `packages/shared`: shared types, mock catalog, and structured logging helpers
- `infra`: Azure provisioning and deployment scripts

Architecture diagram: `docs/ww-cache-cloud-architecture.png`

For handoff, operations, data flow, and troubleshooting, start with:

- `docs/HANDOFF.md`
- `infra/README.md`

## Local Development

```powershell
npm install
npm run dev:api
npm run dev:worker
npm run dev:web
```

The local default cache backend is `CACHE_BACKEND=local`, backed by `.local-data/cache-state.json`.

The frontend does not contain a built-in access code. Users enter an access key in the UI, the web app stores it in `sessionStorage`, and every API request sends it through `x-wwpdw-access-key`. The API checks it against the server-side `WWPDW_ACCESS_KEY`.

Set `VITE_API_BASE_URL` when building the web app against a remote API. Leave it empty for local `/api`.

## Search Source

`WWPDW_SEARCH_SOURCE=auto` uses Notion when `NOTION_READ_ONLY_TOKEN` exists; otherwise it uses the mock catalog.

Preferred Notion scope:

- `NOTION_LIBRARY_ROOT_PAGE_ID`: root page shared with the read-only integration
- one direct child database under that root page
- direct database entries are film entries
- direct child pages under each film entry are media variants/specs

Use `NOTION_READ_ONLY_TOKEN` only. Do not use a write-capable Notion token in this project.

## Cache Backend

- Local: `CACHE_BACKEND=local`
- Azure: `CACHE_BACKEND=azure` plus the `AZURE_STORAGE_*` values from `.env.example`

For local Azure auth without a connection string, run with `AZURE_CONFIG_DIR=C:\Users\bxu\.azure2` so Azure SDK credentials can reuse the `az2` login profile.

The Azure backend uses:

- Storage Queue for cache signals
- Table Storage for cache/job state
- private Blob Storage for cached video payloads
- short-lived SAS URLs for playback
- media diagnostics for ready assets, including content type, size, range probe, and MP4 `moov`/`mdat` position

## Cloud Deployment

Provision once:

```powershell
.\infra\provision.ps1
```

Deploy/update:

```powershell
.\infra\build-worker-image.ps1
.\infra\deploy-worker-job.ps1
.\infra\deploy-cleanup-job.ps1
.\infra\build-api-image.ps1
.\infra\deploy-api-containerapp.ps1
.\infra\deploy-web-staticapp.ps1
```

The API runs as a scale-to-zero Container App. When `CACHE_BACKEND=azure`, `/api/cache` writes queue/table state and starts the cache worker Container Apps Job through Azure Resource Manager using managed identity.

The cleanup job removes expired cache assets on a daily schedule. Member Cinema Passes do not expire by date; admins revoke or delete them when needed.

## Verification

```powershell
npm run typecheck
npm run build
```
