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
.\infra\deploy-metadata-sync-job.ps1 -Mode full
.\infra\deploy-metadata-sync-job.ps1 -Mode incremental
.\infra\deploy-web-staticapp.ps1
```

Static administrator key bootstrap/rotation:

```powershell
# Reads WWPDW_ADMIN_KEY from .env or the current process environment.
.\infra\set-admin-key.ps1

# Or pass a value explicitly.
.\infra\set-admin-key.ps1 -AdminKey "replace-me"
```

The API uses `WWPDW_ADMIN_KEY` for the Admin tab. Regular family members use generated Cinema Passes.

Manual worker trigger:

```powershell
.\infra\start-worker-job.ps1
```

Initial movie metadata index fill:

```powershell
.\infra\start-metadata-sync-job.ps1 -Mode full
```

## Runtime Shape

The API Container App scales to zero and starts the worker Container Apps Job after it queues an Azure cache request.

The worker job runs `WORKER_MODE=oneshot`. It drains queued cache jobs, resolves media URLs, streams media into Blob Storage, and updates Table state.

The cleanup job runs `WORKER_MODE=cleanup` on a daily schedule. It deletes cache state/blobs after `CACHE_ASSET_TTL_DAYS`, and also deletes ready videos that have not been played for `CACHE_ASSET_IDLE_TTL_DAYS` days.

The API keeps a short in-memory cache for parsed Notion search results with `SEARCH_RESULT_CACHE_TTL_SECONDS` and `SEARCH_RESULT_CACHE_LIMIT`. Cache availability is still checked against Azure on every search response, so ready/playable status stays fresh.

Search also has a persistent movie metadata index in Azure Table Storage
(`AZURE_STORAGE_SEARCH_INDEX_TABLE`, default `movieindex`). The API searches
that table before going to Notion. When the table misses, the API falls back to
Notion and writes the result into the index. The metadata sync jobs keep the
table warm:

- `job-ww-meta-index-full`: manual slow full crawl. Use this first and after
  large Notion reorganizations. It deletes index rows not seen in the full run.
- `job-ww-meta-index-incremental`: scheduled crawl, default every six hours.
  It scans recent Notion rows by `last_edited_time`, with a small overlap
  window to avoid missing close updates.

The index stores metadata and source page ids. Cache requests still refresh the
selected Notion page before queueing work so temporary Notion file URLs are not
trusted beyond the search interaction.

Member Cinema Passes use a simple 🍀 balance to control cache and playback cost and do not expire by date. New cache jobs spend `MEMBER_CACHE_CREDIT_COST`; cache hits and already-running jobs are free. Playback spends `ceil(contentLength / MEMBER_PLAYBACK_CREDIT_BYTES)` and the same member can replay the same asset for `MEMBER_PLAYBACK_REPLAY_FREE_HOURS` without another playback charge. New passes start with `MEMBER_DEFAULT_CREDITS` unless the admin enters a different balance.

The Admin tab has a dedicated ready cached-video list, can retry failed cache jobs, and can delete failed/ready/stuck cache entries. Retry first refreshes the Notion media URL by the stored source page id when possible, then re-queues the same job. Deleting a ready entry removes the Blob plus the matching Table asset/job records.

The Static Web App is deployed from the local `apps/web/dist` build by the Azure Static Web Apps CLI.

See [`docs/HANDOFF.md`](../docs/HANDOFF.md) for resource names, log commands, secrets, and troubleshooting.
