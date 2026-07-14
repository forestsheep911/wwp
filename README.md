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
- `docs/ARCHITECTURE_CHECK.md`
- `infra/README.md`

## Local Development

```powershell
npm install
npm run dev:api
npm run dev:worker
npm run dev:web
```

The local default cache backend is `CACHE_BACKEND=local`, backed by `.local-data/cache-state.json`.

The frontend does not contain a built-in administrator key. The deployed API reads one static admin key from `WWPDW_ADMIN_KEY`, and the Admin tab sends the user-entered key through `x-wwpdw-access-key`. Regular family members use generated member passes stored in the member-code table.

For explicit local direct-API development, set `VITE_API_BASE_URL` to the remote API origin. Leave it empty to use `/api`, including every production build.

## Search Source

`WWPDW_SEARCH_SOURCE=auto` uses Notion when `NOTION_READ_ONLY_TOKEN` exists; otherwise it uses the mock catalog.

Preferred Notion scope:

- `NOTION_LIBRARY_ROOT_PAGE_ID`: root page shared with the read-only integration
- one direct child database under that root page
- direct database entries are film entries
- direct child pages under each film entry are media variants/specs

Use `NOTION_READ_ONLY_TOKEN` only. Do not use a write-capable Notion token in this project.

## Movie Metadata Index

Search can use a persistent movie metadata index before falling back to Notion.
This is enabled with `SEARCH_INDEX_ENABLED=true`.

- Local development stores the index at `.local-data/search-index.json`.
- Azure stores the index in the `AZURE_STORAGE_SEARCH_INDEX_TABLE` Table Storage table.
- API search reads the index first and writes Notion fallback results back into the index.
- Cache requests refresh the selected Notion source page before queueing, so cached metadata does not rely on expired Notion file URLs.

Run a small local sync:

```powershell
node --import tsx apps/api/src/meta-sync.ts --mode=incremental --limit=10 --delay-ms=500
```

Cloud metadata sync jobs:

```powershell
.\infra\deploy-metadata-sync-job.ps1 -Mode full
.\infra\deploy-metadata-sync-job.ps1 -Mode incremental
.\infra\start-metadata-sync-job.ps1 -Mode full
```

## Cache Backend

- Local: `CACHE_BACKEND=local`
- Azure: `CACHE_BACKEND=azure` plus the `AZURE_STORAGE_*` values from `.env.example`

For local Azure auth without a connection string, sign in with Azure CLI (`az login`) and make sure the active account can access the configured storage resources. If you use a non-default Azure CLI profile directory on your machine, set `AZURE_CONFIG_DIR` in your local shell or `.env` only; do not commit machine-specific profile paths or command aliases.

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
.\infra\deploy-metadata-sync-job.ps1 -Mode full
.\infra\deploy-metadata-sync-job.ps1 -Mode incremental
.\infra\deploy-web-staticapp.ps1
```

Production web routing follows these rules:

- Production web requests use the Static Web Apps `/api/*` BFF; do not set `VITE_API_BASE_URL` during production builds.
- `WWPDW_ORIGIN_API_BASE_URL` is the fixed Container Apps upstream.
- `WWPDW_PUBLIC_WEB_ORIGIN` is the Static Web Apps `https://<defaultHostname>` origin forwarded for API CSRF/origin checks.
- The BFF holds no session state and no passcode or admin key. OAuth and MFA remain future authentication extensions.

The API runs as a scale-to-zero Container App. When `CACHE_BACKEND=azure`, `/api/cache` writes queue/table state and starts the cache worker Container Apps Job through Azure Resource Manager using managed identity.

The cleanup job removes idle-expired cache assets on a daily schedule. Member passes do not expire by date; admins revoke or delete them when needed.

## Verification

```powershell
npm run typecheck
npm run build
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
