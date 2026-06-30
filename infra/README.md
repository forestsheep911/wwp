# WW Player Cache Infrastructure

This folder contains Azure provisioning and deployment scripts for the cloud cache/player MVP.

## Foundation

Run from the repository root:

```powershell
.\infra\provision.ps1
```

The provisioning script creates:

- resource group `rg-ww-player-cache-dev`
- private Storage account for Blob, Queue, and Table state
- Azure Container Registry Basic
- Log Analytics workspace
- Container Apps environment
- Key Vault with RBAC authorization
- user-assigned managed identity
- least-privilege role assignments for storage, ACR pull, Key Vault secret read, and job start

## Deployment

Worker image/job:

```powershell
.\infra\build-worker-image.ps1
.\infra\deploy-worker-job.ps1
.\infra\deploy-cleanup-job.ps1
```

API image/app and Static Web App:

```powershell
.\infra\build-api-image.ps1
.\infra\deploy-api-containerapp.ps1
.\infra\deploy-web-staticapp.ps1
```

Manual worker trigger:

```powershell
.\infra\start-worker-job.ps1
```

## Runtime Shape

The API Container App scales to zero and starts the worker Container Apps Job after it queues an Azure cache request.

The worker job runs `WORKER_MODE=oneshot`. It drains queued cache jobs, resolves media URLs, streams media into Blob Storage, and updates Table state.

The cleanup job runs `WORKER_MODE=cleanup` on a daily schedule. It deletes cache state/blobs after `CACHE_ASSET_TTL_DAYS`, and also deletes ready videos that have not been played for `CACHE_ASSET_IDLE_TTL_DAYS` days.

The API keeps a short in-memory cache for parsed Notion search results with `SEARCH_RESULT_CACHE_TTL_SECONDS` and `SEARCH_RESULT_CACHE_LIMIT`. Cache availability is still checked against Azure on every search response, so ready/playable status stays fresh.

Member Cinema Passes use 🍀 allowances to control cache cost. New cache jobs spend `MEMBER_CACHE_CREDIT_COST`; cache hits and already-running jobs are free. Defaults are configured with `MEMBER_DEFAULT_CREDITS`, `MEMBER_DEFAULT_FIVE_HOUR_LIMIT`, and `MEMBER_DEFAULT_WEEK_LIMIT`.

The Static Web App is deployed from the local `apps/web/dist` build by the Azure Static Web Apps CLI.

See [`docs/HANDOFF.md`](../docs/HANDOFF.md) for resource names, log commands, secrets, and troubleshooting.
