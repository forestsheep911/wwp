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
.\infra\deploy-people-sync-job.ps1
.\infra\deploy-web-staticapp.ps1
```

Production web routing follows these rules:

- Production web requests use the Static Web Apps `/api/*` BFF; do not set `VITE_API_BASE_URL` during production builds.
- `WWPDW_ORIGIN_API_BASE_URL` is the fixed Container Apps upstream.
- `WWPDW_PUBLIC_WEB_ORIGIN` is the Static Web Apps `https://<defaultHostname>` origin forwarded for API CSRF/origin checks.
- The BFF holds no session state and no passcode or admin key. OAuth and MFA remain future authentication extensions.

Static administrator key bootstrap/rotation:

```powershell
# Reads WWPDW_ADMIN_KEY from .env or the current process environment.
.\infra\set-admin-key.ps1

# Or pass a value explicitly.
.\infra\set-admin-key.ps1 -AdminKey "replace-me"
```

The API uses `WWPDW_ADMIN_KEY` for the Admin tab. Regular family members use generated member passes.

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
If `BAILIAN_API_KEY`, `DASHSCOPE_API_KEY`, or `OPENAI_API_KEY` is configured, the worker can use the AI resolver as a fallback after rule-based URL resolution decides a source needs browser inspection. The default preset is `WWPDW_AI_RESOLVER_MODEL_PRESET=compass` (balanced A). Other presets are `spark` (fast A), `summit` (smart A), `harbor` (balanced B), and `glint` (fast B). The aliases `balanced`, `fast`, `smart`, `balanced-b`, and `fast-b` are also accepted. Override with `WWPDW_AI_RESOLVER_MODEL`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, or the generic `WWPDW_AI_RESOLVER_*` variables when needed.
The API also uses the same AI key for on-demand movie summaries, defaulting to `WWPDW_AI_SUMMARY_MODEL_PRESET=spark` so spoiler-free and spoiler summaries stay on the fast lane.

The cleanup job runs `WORKER_MODE=cleanup` on a daily schedule. It deletes ready cache state/blobs that have not been played for `CACHE_ASSET_IDLE_TTL_DAYS` days. Never-played videos use their initial cached time as the idle reference. The same job also cleans prepared OSS objects when `ALIYUN_OSS_CLEANUP_ENABLED=true`: the API refreshes the OSS preparation row's `lastPlayedAt` before issuing a signed URL, and cleanup claims the row with an Azure Table ETag before deleting the restricted `ALIYUN_OSS_OBJECT_PREFIX`. Legacy OSS rows without an expiry receive a fresh idle window on the first active run. `deploy-cleanup-job.ps1` defaults OSS cleanup to dry-run; inspect one execution before redeploying it with `-AliyunOssCleanupDryRun false`.

The API keeps a short in-memory cache for parsed Notion search results with `SEARCH_RESULT_CACHE_TTL_SECONDS` and `SEARCH_RESULT_CACHE_LIMIT`. Cache availability is still checked against Azure on every search response, so ready/playable status stays fresh.

Search also has a persistent movie metadata index in Azure Table Storage
(`AZURE_STORAGE_SEARCH_INDEX_TABLE`, default `movieindex`). The API searches
that table before going to Notion. When the table misses, the API falls back to
Notion and writes the result into the index. The metadata sync jobs keep the
table warm:

- `job-ww-meta-index-full`: manual slow full crawl. Use this first and after
  large Notion reorganizations. It deletes index rows not seen in the full run.
- `job-ww-meta-index-incremental`: scheduled crawl, default every 30 minutes.
  It scans recent Notion rows by `last_edited_time`, with a small overlap
  window to avoid missing close updates.

People profile edits have a separate scheduled job, `job-ww-people-index`.
It runs every two hours by default at minute 10, reads only the `People / 创作人`
data source, and publishes safe edits for existing immutable `personId` values
to the Azure `peoplecatalog` table. Its incremental checkpoint and latest
secret-safe report use a separate `peopleNotionSync` partition in the same
table, so progress survives ephemeral job containers. Unknown identities,
duplicate Person IDs, changed external IDs, and malformed rows are quarantined;
the scheduled job never creates a new identity or invents work credits.
When an existing person's reviewed display name changes, the same execution
updates only that person's already-linked movie credits; it never performs a
full-catalog name rewrite.

Deploy or update it with `deploy-people-sync-job.ps1`. Trigger one execution
without waiting for the next schedule with:

```powershell
.\infra\start-people-sync-job.ps1
```

The index stores metadata and source page ids. Cache requests still refresh the
selected Notion page before queueing work so temporary Notion file URLs are not
trusted beyond the search interaction.

Member passes use a simple 🍀 balance to control cache and playback cost and do not expire by date. New cache jobs spend the greater of `MEMBER_CACHE_CREDIT_COST` and `ceil(contentLength / MEMBER_CACHE_CREDIT_BYTES)`; cache hits and already-running jobs are free. Domestic playback spends 1🍀 per started `MEMBER_DOMESTIC_PLAYBACK_CREDIT_BYTES`, while international playback uses `MEMBER_PLAYBACK_CREDIT_BYTES`. The same member can replay the same asset on the same line for `MEMBER_PLAYBACK_REPLAY_FREE_HOURS` without another playback charge. New passes start with `MEMBER_DEFAULT_CREDITS` unless the admin enters a different balance.

The Admin tab has a dedicated ready cached-video list, can retry failed cache jobs, and can delete failed/ready/stuck cache entries. Retry first refreshes the Notion media URL by the stored source page id when possible, then re-queues the same job. Deleting a ready entry removes the Blob plus the matching Table asset/job records.

The Static Web App is deployed from the local `apps/web/dist` build by the Azure Static Web Apps CLI.

See [`docs/HANDOFF.md`](../docs/HANDOFF.md) for resource names, log commands, secrets, and troubleshooting.
