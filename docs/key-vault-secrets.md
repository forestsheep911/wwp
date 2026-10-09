# Project secrets

App Configuration stores ordinary configuration and native Key Vault references.
See [cloud configuration and handoff](cloud-configuration.md). No local `.env` is
required. `tools/lib/project-secrets.mjs` maps references internally to
`NAME__KEY_VAULT=vault-name/secret-name`, resolves them using the current Azure CLI
identity (`az login`), and puts secret values in the current process.
An environment value injected by the caller takes precedence. Retrieval failure
stops startup without logging secret values. The identity needs Key Vault Secrets
User access to the referenced secrets.

WWP uses its existing project vault `kv-wwcache-e9219db7`. General Shared Zone
credentials remain in `kv-boccaro-shared-e9219` and are handled by the global
Notion file-sharing transport. Local values that differ from deployed credentials
use `LOCAL-` secret names so migration does not overwrite production credentials.

API and worker containers receive secrets through managed-identity Key Vault
references in Container Apps; they do not require Azure CLI inside the image.
The deployment script binds OMDb through `OMDB_API_KEY=secretref:omdb-api-key`.

Current development bindings in project Vault:

| Environment name | Vault secret | Purpose |
|---|---|---|
| `NOTION_READ_ONLY_TOKEN` | `NOTION-READ-ONLY-TOKEN` | Read library metadata |
| `NOTION_TOKEN` | `NOTION-TOKEN` | Authorized metadata writes |
| `OMDB_API_KEY` | `OMDB-API-KEY` | OMDb enrichment |
| `BAILIAN_API_KEY` | `BAILIAN-API-KEY` | AI fallback |
| `WWPDW_ADMIN_KEY` | `WWPDW-ADMIN-KEY` | Administrator authentication |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | `ALIBABA-CLOUD-ACCESS-KEY-ID` | Alibaba signing/deployment |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | `ALIBABA-CLOUD-ACCESS-KEY-SECRET` | Alibaba signing/deployment |
| `VPN_TRAFFIC_CHECK_URL` | `VPN-TRAFFIC-CHECK-URL` | Route/traffic verification |
| `VPN_TRAFFIC_CHECK_URL_2` | `VPN-TRAFFIC-CHECK-URL-2` | Alternate traffic verification |

The Vault also contains `OPENAI-API-KEY` (optional deployed worker provider) and
`WWPDW-ACCESS-KEY` (legacy entry). Their presence does not make them mandatory
development bindings. A valid Douban Cookie is not part of this inventory.
Ordinary development requires only secrets used by the selected workflow; callers
using `projectEnv(name)` resolve only that value. Broad `config()` callers retain
the existing eager resolution behavior.

`tools/migrate-env-secrets.mjs` is a legacy one-time credential migration tool.
For environments already using Vault references, use `tools/migrate-cloud-config.mjs`
to import ordinary values/references into App Configuration. Never paste a credential
into the ordinary configuration store.

Restart long-running local processes after changing references. Existing processes
retain their original in-memory credentials until restarted.
