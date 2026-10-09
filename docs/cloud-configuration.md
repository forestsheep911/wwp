# Cloud configuration and development-machine handoff

WWP no longer automatically reads `.env`. The authoritative configuration values
live in Azure App Configuration; secrets stay in Key Vault. `config/cloud.json`
contains only the public bootstrap endpoint, project prefix, base label and cache
lifetime. These identifiers must be discoverable before loading cloud values.

## Shared store and naming

- Store: `appcs-boccaro-dev-e9219`, Free, East Asia, `rg-shared-services`.
- WWP keys: `wwp:VARIABLE_NAME`. Other projects use their own prefix, such as `wwv:`.
- Shared development label: `dev`. Future environments use `test` / `prod`.
  A label is never implicitly inherited from another environment.
- Machine overrides: `dev:machine:<lowercase-hostname>`, selected automatically.
  Media paths, proxy addresses, DNS overrides and public home origins belong here.
- Set `WWP_CONFIG_MACHINE_LABEL=dev:fores` to select an agreed personal profile;
  an empty string disables the override. No profile is selected by username alone.
- Deployment parameter keys: `wwp:DEPLOY_<SCRIPT_BASENAME>_<PARAMETERNAME>`, with
  uppercase names and hyphens in the script basename replaced by underscores.
  For example `wwp:DEPLOY_DEPLOY_API_CONTAINERAPP_RESOURCEGROUP`.
- Key Vault references use the native content type
  `application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8` and a
  versionless secret URI. Never store a token or password as a plain value.

Priority: explicit process environment / deployment arguments, then selected
machine profile, then base label, then program defaults. Restart a process after
changing configuration. Shared labels must not contain machine-specific drive paths.
Do not reuse one machine's profile on a different OS without adjusting its paths.

All users of this shared store can read all its namespaces; key prefixes and labels
are organization, not authorization. Only projects with the same access boundary
should share this store. Free quota is shared across projects: 1,000 requests/day,
10 MB regular storage, no SLA. It is a development configuration service, not a
high-frequency runtime lookup service.

## New Windows or macOS machine

Install Git, Node.js 24, Azure CLI, and PowerShell 7 (`pwsh`) for infrastructure
scripts. Clone the repository, then run these same commands on either OS:

```text
az login
az account set --subscription e9219db7-f600-43c5-8d42-9c63aae09138
npm ci
npm run config:check
npm run config:secrets
npm run dev:api
```

No `.env` needs to be copied or created. `config:check` reports counts and public
selectors, never values. `config:secrets` verifies secret access in memory without
calling Notion or changing cloud configuration. For `dev:web`, the Vite `/api`
proxy targets the local API on port 8787; browser configuration accepts only
explicit `VITE_` environment variables and does not load dotenv files.

A resource administrator grants the developer **App Configuration Data Reader**
on this store and **Key Vault Secrets User** on the WWP Vault (prefer secret-level
scope when fewer secrets suffice). Editing configuration requires **App Configuration
Data Owner**, which is not needed for ordinary development. Azure resource deployment
and storage operations also require the existing resource-specific permissions in
`HANDOFF.md` / `HOME-SITE-RUNBOOK.md`. Login is per machine; credentials are never
copied between machines. The home service must run under the account that logged in.

## Loading, caching and failures

Local API, worker, home launcher and Node tools use `tools/lib/project-secrets.mjs`.
It loads the selected labels once per process, maps native Vault references, and
resolves secrets in process memory. `projectEnv(name)` resolves only the requested
secret. Existing explicitly injected values win, including an empty string.

Ordinary configuration and reference metadata are cached for 15 minutes in ignored
`.local-data/app-configuration/`, shared across short-lived tools in this checkout.
No resolved secret is cached. Expired or corrupt cache requires a fresh Azure read;
authentication, missing-label and quota failures stop startup. There is no hidden
fallback to the old `.env`. To apply cloud changes immediately:

```text
npm run config:refresh
```

Stop owned foreground processes with Ctrl+C; configuration loading starts no daemon
and changes no global shell environment. Existing running processes keep their
in-memory configuration until explicitly restarted.

`WWP_CONFIG_ENDPOINT`, `WWP_CONFIG_LABEL`, and `WWP_CONFIG_MACHINE_LABEL` override
the bootstrap selectors. `WWP_CONFIG_MODE=injected` uses only caller-provided
environment values; use it for isolated tests and cloud containers. Node's test
runner also selects injected mode automatically. An explicit `DOTENV_CONFIG_PATH`
remains supported solely for legacy test fixtures/import compatibility; normal
development and deployment do not use it.

## Deploying

The infrastructure PowerShell scripts load cloud deployment defaults through
`infra/cloud-config.ps1`; explicit arguments win. Scripts that consume Notion IDs
or other ordinary values load them from App Configuration. API, worker and job
scripts retain managed-identity Key Vault references in the deployed resources.
Container images explicitly use `WWP_CONFIG_MODE=injected`: they consume their
deployment environment without Azure CLI or access to the shared development store.
This keeps development configuration separate from deployed runtime settings.

```text
pwsh -NoProfile -File infra/build-api-image.ps1 -ImageTag <release-tag>
pwsh -NoProfile -File infra/deploy-api-containerapp.ps1 -ImageTag <release-tag>
pwsh -NoProfile -File tools/deploy-aliyun-oss-prepare.ps1
```

The Alibaba deployment resolves just its required credentials from Key Vault.
Serverless Devs' temporary credential alias is removed in `finally`; after a hard
process kill, remove the owned `wwpdw-fc-deploy` alias before retrying.
`set-admin-key.ps1` reads its Vault reference unless an explicit rotation value is
provided. Provisioning/rotation scripts still perform cloud writes when invoked;
configuration checks do not deploy or rotate anything.

For other commands that need an inherited cloud environment:

```text
npm run config:run -- node --import tsx <script>
```

## Maintaining values and migration

Use Azure Portal > App Configuration > Configuration explorer to edit ordinary
values or create Key Vault references. Preserve the prefix and exact label. Changing
a credential means updating Key Vault; do not paste it into the configuration editor.
See `key-vault-secrets.md` for the secret inventory.

`node tools/migrate-cloud-config.mjs <legacy-file>` previews a one-time import.
Add `--apply` to write and verify. It rejects plaintext credentials, extracts literal
deployment defaults without executing scripts, writes serially, checks existing
values before writing, and stops on conflicts/429/errors. Rerun the same import to
resume. It never overwrites a different cloud value. Keep the source until the cloud
configuration and a no-dotenv startup have been verified, then archive it locally.
`.env.example` is retired; the reference catalogue lives in `configuration-reference.md`.

## Verification record

Windows: live App Configuration/Vault readback and no-dotenv entrypoint checks are
verified on 2026-10-09: 232 settings (223 ordinary values and 9 Vault references),
all 96 populated legacy values/references matched, all 9 secrets resolved in memory,
PowerShell cloud parameter loading/explicit overrides passed, and an isolated API
started with no `.env` and returned `/health` HTTP 200. The owned smoke process was
stopped and temporary data removed. Typecheck, build, 167 ledger tests, 16 focused
configuration/deployment tests and 6 home tests passed. The old reference-only file
is recoverable at `.local-data/config-migration/2026-10-09-env.references.txt`.
macOS: platform-aware Node `az` invocation and PowerShell
7 entrypoints are implemented; live macOS verification is pending availability of a Mac.
