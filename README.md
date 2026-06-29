# WWPDW

This repository keeps the skill direction and the web cache direction separate.

Current web-cache MVP shape:

- `apps/web`: thin React/Vite interface
- `apps/api`: local Node API with mock cache endpoints
- `apps/worker`: local queue worker simulator
- `packages/shared`: shared types and mock search data
- `infra`: Azure resource provisioning scripts

Architecture diagram: `docs/ww-cache-cloud-architecture.png`

Local development:

```powershell
npm install
npm run dev:api
npm run dev:worker
npm run dev:web
```

The thin version uses `.local-data/` for local state. It does not connect to Notion or Azure Storage yet.
The default local access key is `family`; set `VITE_ACCESS_CODE` before starting the web app to change it.
This access gate is a local placeholder, not the production security boundary.
Set `VITE_API_BASE_URL` when building the web app against a remote API; leave it empty for local `/api`.

The worker has a resolver boundary already:

- Direct mock media URLs resolve through the rule resolver and continue to cache.
- Intermediate preview URLs return `needs_browser` and fail clearly until a browser resolver is added.

Cache backend:

- Default: `CACHE_BACKEND=local`, backed by `.local-data/cache-state.json`.
- Azure: set `CACHE_BACKEND=azure` and the `AZURE_STORAGE_*` values from `.env.example`.
- For local Azure auth without a connection string, run with `AZURE_CONFIG_DIR=C:\Users\bxu\.azure2` so Azure SDK credentials can reuse the `az2` login profile.

The Azure backend uses Storage Queue for cache signals, Table Storage for cache/job state, private Blob Storage for cached payloads, and short-lived SAS URLs for playback.

Notion access:

- Use `NOTION_READ_ONLY_TOKEN` only.
- The Notion integration should be read-only and scoped only to the source pages/databases needed for playback.
- Do not use a write-capable Notion token in this project, especially before adding browser or AI-assisted resolvers.
- For Azure deployment, store the value in Key Vault and inject it into the API/worker environment under the same name.
- `WWPDW_SEARCH_SOURCE=auto` uses Notion search when `NOTION_READ_ONLY_TOKEN` exists; otherwise it keeps using the mock catalog.
- The first parser is rule-based: it checks page properties, video/file/embed/bookmark blocks, rich-text links, and shallow child blocks. Direct file URLs can enter the cache path; page/player URLs are marked for a future browser or AI resolver.

Cloud worker:

- Build and push the worker image: `.\infra\build-worker-image.ps1`
- Create or update the Container Apps Job: `.\infra\deploy-worker-job.ps1`
- Manually trigger one execution: `.\infra\start-worker-job.ps1`
- The job is manual trigger, runs `WORKER_MODE=oneshot`, uses the user-assigned managed identity, and reads/writes Azure Storage without a connection string.

Cloud web experiment:

```powershell
.\infra\build-api-image.ps1
.\infra\deploy-api-containerapp.ps1
.\infra\deploy-web-staticapp.ps1
```

The API runs as a scale-to-zero Container App. When `CACHE_BACKEND=azure`, `/api/cache` writes the queue/table state and starts the cache worker job through Azure Resource Manager using managed identity. The Static Web App is built with `VITE_API_BASE_URL` pointing at the API Container App.
