# Native zsh infrastructure commands

On macOS use the `.zsh` entrypoints in `infra/`. They require zsh, Node.js 24,
Azure CLI, the existing Azure login/RBAC, and npm/npx. They do **not** require
PowerShell, Docker Desktop, or a copied `.env`. Windows keeps the existing
PowerShell entrypoints.

All 13 operational PowerShell scripts have corresponding zsh commands:

| Operation | zsh command |
| --- | --- |
| Provision resources and RBAC | `zsh infra/provision.zsh` |
| Build API image in ACR | `zsh infra/build-api-image.zsh --ImageTag <release>` |
| Build worker image in ACR | `zsh infra/build-worker-image.zsh --ImageTag <release>` |
| Deploy API | `zsh infra/deploy-api-containerapp.zsh --ImageTag <release>` |
| Deploy worker job | `zsh infra/deploy-worker-job.zsh --ImageTag <release>` |
| Deploy cleanup job | `zsh infra/deploy-cleanup-job.zsh --ImageTag <release>` |
| Deploy full metadata job | `zsh infra/deploy-metadata-sync-job.zsh --Mode full --ImageTag <release>` |
| Deploy incremental metadata job | `zsh infra/deploy-metadata-sync-job.zsh --Mode incremental --ImageTag <release>` |
| Deploy People job | `zsh infra/deploy-people-sync-job.zsh --ImageTag <release>` |
| Deploy frontend and BFF | `zsh infra/deploy-web-staticapp.zsh` |
| Bind/rotate administrator key | `zsh infra/set-admin-key.zsh` |
| Start worker and wait | `zsh infra/start-worker-job.zsh` |
| Start metadata job | `zsh infra/start-metadata-sync-job.zsh --Mode incremental` |
| Start People job | `zsh infra/start-people-sync-job.zsh` |

The table contains both full and incremental modes of one metadata entrypoint.
`cloud-config.zsh` is the corresponding configuration helper:

```zsh
zsh infra/cloud-config.zsh check
zsh infra/cloud-config.zsh secret-check
zsh infra/cloud-config.zsh refresh
```

Use `--help` on any operational entrypoint to see its supported options without
logging in or contacting Azure. Native operations accept both `--ResourceGroup`
and `--resource-group`; PowerShell-style `-ResourceGroup` also works. Switches
such as `--ImageOnly` and `--NoRestart` do not take values. Frontend options use
`--resource-group`, `--static-app-name`, `--api-app-name`, `--api-base-url`,
`--location`, and `--az-cli`.

Configuration follows [cloud configuration](cloud-configuration.md): explicit
arguments, process environment overrides, selected machine profile, shared
`dev` label, then defaults. `AZURE_CONFIG_DIR` is inherited. On the current Mac,
use `AZURE_CONFIG_DIR="$HOME/.azure-boccaro"` with these commands. Select the
subscription documented in the cloud configuration guide before deployment.
Native commands load cloud configuration once per process and use the same
cache and Key Vault reference resolver as the other project tools.

The small zsh launchers call the shared Node implementation. It reads only
parameter literals, environment templates, and configuration-name lists from
the matching `.ps1` contract; it never evaluates or executes PowerShell code.
Azure control flow lives in `infra/lib/native-operations.mjs`. When changing an
operation, update both implementations and their tests. Unsupported parameter
expressions stop instead of being evaluated or guessed.

The frontend builds with an empty `VITE_API_BASE_URL`, rejects cross-origin
API URLs in every JS chunk, deploys frontend and BFF together, and removes legacy
Function settings only after a successful deploy. It then compares the public
homepage's asset names and downloaded JS/CSS bytes to the local build. A CLI
success exit alone is not deployment confirmation. The deployment token is
passed through the child environment, never a command argument or a saved file.

API revisions preserve existing secret environment bindings while replacing
ordinary environment values. Job schedules, resource limits, command arguments,
managed identities, and Vault references follow the matching PowerShell workflow.
Metadata `--ImageOnly --ImageTag <release>` updates only an existing job image.
Worker execution failures and timeouts exit nonzero. Azure errors stop each
operation; only explicit not-found results enter create/bootstrap branches.

`provision` grants infrastructure RBAC; API deployment reconciles its existing
worker-job Contributor grant. Only `set-admin-key` deliberately rotates the
administrator secret. Invoking those commands performs the corresponding cloud
writes. Testing the command suite does not authorize or run them. Secret
bootstrap writes use an owned temporary directory (0700), a value file (0600),
and cleanup on completion, failure, or handled interruption. Azure command
errors omit arguments and captured output so credentials are not logged.
After an uncatchable process kill, any owned `wwp-vault-*` directory in the OS
temporary directory needs explicit inspection/cleanup before reusing the host.

Validation on 2026-10-09: native option/help and mocked Azure command tests ran on
macOS; Windows and live provisioning/API/job changes have not been exercised by
this change. The frontend and BFF were deployed through the zsh entrypoint to
`https://gentle-rock-049daed00.7.azurestaticapps.net`; public JS/CSS bytes matched
the local build (`index-DjFw13ep.js`, `index-BMYYvxNV.css`). The first deployment
client download was incomplete; it was resumed and verified against the official
release SHA-256 before the successful retry.

```zsh
node --test infra/native-cli.test.mjs infra/deploy-web-staticapp-native.test.mjs
```
