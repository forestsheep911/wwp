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

The worker Container Apps Job and Static Web App are intentionally left for the application phase, after the worker image and web app exist.
