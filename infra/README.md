# WW Player Cache Infrastructure

This folder contains the Azure provisioning script for the first cloud-only cache MVP.

The script creates the shared foundation in the target subscription, guarded by the subscription ID:

- Resource group: `rg-ww-player-cache-dev`
- Private Storage account for cached videos, queue, and table metadata
- Azure Container Registry Basic
- Log Analytics workspace
- Container Apps environment
- Key Vault with RBAC authorization
- User-assigned managed identity and least-privilege role assignments

Run from this repository root:

```powershell
.\infra\provision.ps1
```

Application deployment:

```powershell
.\infra\build-worker-image.ps1
.\infra\deploy-worker-job.ps1
.\infra\build-api-image.ps1
.\infra\deploy-api-containerapp.ps1
.\infra\deploy-web-staticapp.ps1
```

The API Container App scales to zero and starts the worker Container Apps Job after it queues an Azure cache request. The Static Web App is deployed from the local `apps/web/dist` build by the Azure Static Web Apps CLI.
