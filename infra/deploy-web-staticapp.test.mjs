import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-web-staticapp.ps1", import.meta.url), "utf8");

test("web deployment configures the BFF and removes the access-key Function settings", () => {
  assert.match(script, /WWPDW_PUBLIC_WEB_ORIGIN=\$publicWebOrigin/);
  assert.match(script, /WWPDW_BFF_TIMEOUT_MS=90000/);
  assert.match(script, /staticwebapp appsettings delete/);
  assert.match(script, /WWPDW_ADMIN_KEY/);
  assert.doesNotMatch(script, /storage container create/);
  assert.doesNotMatch(script, /WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING=\$storageConnectionString/);
});

test("production assets are built without the cross-site API origin", () => {
  assert.match(script, /\$env:VITE_API_BASE_URL = ""/);
  assert.match(script, /\$builtScript\.Contains\(\$ApiBaseUrl\)/);
  assert.match(script, /Built web asset still contains cross-site API base URL/);
});

test("deployment fails closed when native settings or build commands fail", () => {
  assert.match(script, /Could not configure Static Web App BFF settings/);
  assert.match(script, /Could not read Static Web App settings/);
  assert.match(script, /Could not delete legacy Static Web App settings/);
  assert.match(
    script,
    /npm run build --workspace @wwpdw\/web\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/,
  );
});
