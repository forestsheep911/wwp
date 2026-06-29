# WWPDW

This repository keeps the skill direction and the web cache direction separate.

Current web-cache MVP shape:

- `apps/web`: thin React/Vite interface
- `apps/api`: local Node API with mock cache endpoints
- `apps/worker`: local queue worker simulator
- `packages/shared`: shared types and mock search data
- `infra`: Azure resource provisioning scripts

Local development:

```powershell
npm install
npm run dev:api
npm run dev:worker
npm run dev:web
```

The thin version uses `.local-data/` for local state. It does not connect to Notion or Azure Storage yet.
The default local access key is `family`; set `VITE_ACCESS_CODE` before starting the web app to change it.
This access gate is a local placeholder, not the production security boundary.
