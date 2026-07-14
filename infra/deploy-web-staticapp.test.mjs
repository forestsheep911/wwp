import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-web-staticapp.ps1", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNativeCommandChecked(commandStart, failureMessage) {
  assert.match(
    script,
    new RegExp(
      `${escapeRegex(commandStart)} \\x60\\r?\\n` +
        `(?:[ \\t]+(?:--|\\()[^\\r\\n]+\\r?\\n)+` +
        `(?:[ \\t]*\\r?\\n)?[ \\t]*if \\(\\$LASTEXITCODE -ne 0\\) \\{\\r?\\n` +
        `[ \\t]+throw "${escapeRegex(failureMessage)}"`,
    ),
  );
}

test("web deployment configures the BFF and removes the access-key Function settings", () => {
  const appSettingsBlock = script.match(/\$appSettings = @\(([\s\S]*?)\r?\n\)/)?.[1];
  const settingNames = [...appSettingsBlock.matchAll(/"([A-Z0-9_]+)=/g)].map((match) => match[1]);
  assert.deepEqual(settingNames, [
    "WWPDW_ORIGIN_API_BASE_URL",
    "WWPDW_PUBLIC_WEB_ORIGIN",
    "WWPDW_BFF_TIMEOUT_MS",
  ]);
  assert.match(script, /WWPDW_PUBLIC_WEB_ORIGIN=\$publicWebOrigin/);
  assert.match(script, /WWPDW_BFF_TIMEOUT_MS=90000/);
  assert.match(script, /staticwebapp appsettings delete/);
  assert.match(script, /WWPDW_ADMIN_KEY/);
  assert.doesNotMatch(script, /storage container create/);
  assert.doesNotMatch(script, /WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING=\$storageConnectionString/);
});

test("production assets are built without the cross-site API origin", () => {
  assert.match(script, /\$env:VITE_API_BASE_URL = ""/);
  assert.match(
    script,
    /\$builtScriptFiles = @\(Get-ChildItem -LiteralPath \$builtDistPath -Filter "\*\.js" -File -Recurse\)/,
  );
  assert.match(script, /foreach \(\$builtScriptFile in \$builtScriptFiles\)/);
  assert.match(script, /\$builtScript\.Contains\(\$ApiBaseUrl\)/);
  assert.match(script, /Built web asset still contains cross-site API base URL/);
  assert.match(script, /if \(-not \$foundSameOriginLoginRoute\)/);
  assert.doesNotMatch(script, /\[regex\]::Match\(\$builtIndex/);
});

test("deployment fails closed when native settings or build commands fail", () => {
  assertNativeCommandChecked(
    "$existingAppName = & $AzCli staticwebapp list",
    "Could not list Static Web Apps.",
  );
  assertNativeCommandChecked(
    "& $AzCli staticwebapp create",
    "Could not create Static Web App.",
  );
  assertNativeCommandChecked(
    "& $AzCli staticwebapp appsettings set",
    "Could not configure Static Web App BFF settings.",
  );
  assertNativeCommandChecked(
    "$existingSettingsJson = & $AzCli staticwebapp appsettings list",
    "Could not read Static Web App settings.",
  );
  assertNativeCommandChecked(
    "& $AzCli staticwebapp appsettings delete",
    "Could not delete legacy Static Web App settings.",
  );
  assertNativeCommandChecked(
    "$deploymentToken = & $AzCli staticwebapp secrets list",
    "Could not read Static Web App deployment token.",
  );
  assertNativeCommandChecked(
    "npx -y @azure/static-web-apps-cli deploy",
    "Static Web App deployment failed.",
  );
  assert.match(
    script,
    /npm run build --workspace @wwpdw\/web\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/,
  );
});

test("legacy settings are removed only after a successful web and BFF deployment", () => {
  const buildIndex = script.indexOf("npm run build --workspace @wwpdw/web");
  const tokenIndex = script.indexOf("staticwebapp secrets list");
  const deployIndex = script.indexOf("@azure/static-web-apps-cli deploy");
  const deploySuccessBoundaryIndex = script.indexOf("if ($LASTEXITCODE -ne 0)", deployIndex);
  const cleanupListIndex = script.indexOf("staticwebapp appsettings list", deploySuccessBoundaryIndex);
  const cleanupDeleteIndex = script.indexOf("staticwebapp appsettings delete", cleanupListIndex);

  assert.notEqual(buildIndex, -1, "expected a production build");
  assert.notEqual(tokenIndex, -1, "expected deployment token lookup");
  assert.notEqual(deployIndex, -1, "expected web and BFF deployment");
  assert.notEqual(deploySuccessBoundaryIndex, -1, "expected deployment failure check");
  assert.notEqual(cleanupListIndex, -1, "expected post-deployment legacy settings lookup");
  assert.notEqual(cleanupDeleteIndex, -1, "expected post-deployment legacy settings cleanup");
  assert.ok(buildIndex < cleanupListIndex, "a build failure must occur before cleanup is reachable");
  assert.ok(tokenIndex < cleanupListIndex, "a token lookup failure must occur before cleanup is reachable");
  assert.ok(deployIndex < cleanupListIndex, "a deployment failure must occur before cleanup is reachable");
  assert.ok(
    deploySuccessBoundaryIndex < cleanupListIndex,
    "cleanup must start after the successful deployment boundary",
  );
});

test("browser authentication documentation describes the session and CSRF boundary", () => {
  assert.match(readme, /HttpOnly session cookie/);
  assert.match(readme, /CSRF token only in memory/);
  assert.doesNotMatch(readme, /Admin tab sends[^.]+x-wwpdw-access-key/);
});
