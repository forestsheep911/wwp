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

The cleanup job runs `WORKER_MODE=cleanup` on a daily schedule and deletes expired cache state/blobs according to `CACHE_ASSET_TTL_DAYS`.

The Static Web App is deployed from the local `apps/web/dist` build by the Azure Static Web Apps CLI.

See [`docs/HANDOFF.md`](../docs/HANDOFF.md) for resource names, log commands, secrets, and troubleshooting.
