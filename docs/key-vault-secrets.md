# Project secrets

Local `.env` stores ordinary configuration and `NAME__KEY_VAULT=vault-name/secret-name`
references only. `tools/lib/project-secrets.mjs` resolves references using the
current Azure CLI identity (`az login`) and puts values in the current process.
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

To migrate an existing local environment, run `node tools/migrate-env-secrets.mjs`.
It stores and verifies each populated credential, then prepares two patches
under `.local-data`: `env-vault-remove.patch` removes the old file and
`env-vault-migration.patch` creates the sanitized replacement. After readback
verification succeeds, apply them in that order as separate operations.
No plaintext backup is created.

Restart long-running local processes after changing references. Existing processes
retain their original in-memory credentials until restarted.
