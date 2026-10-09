// One-time, explicit importer. Normal runtime never reads legacy .env files.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { parse } from "dotenv";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { azureJson } from "./lib/azure-cli.mjs";
import { cloudSettings, vaultContentType, isSensitiveName } from "./lib/cloud-config.mjs";

const machineNames = new Set([
  "WWPDW_MEDIA_ROOT", "WWPDW_LOCAL_DATA_DIR", "WWPDW_HOME_DATA_DIR", "WWPDW_WEB_DIST_DIR",
  "NOTION_PROXY_URL", "NOTION_API_RESOLVE_IP", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
  "AZURE_CONFIG_DIR", "WWPDW_HOME_PUBLIC_ORIGIN"
]);

export function migrationItems(source, machineLabel) {
  const items = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === "" || value === undefined) continue;
    const reference = key.endsWith("__KEY_VAULT");
    const name = reference ? key.slice(0, -11) : key;
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) throw new Error("Invalid configuration name");
    if (!reference && isSensitiveName(name)) throw new Error(`Refusing plaintext sensitive configuration: ${name}. Migrate it to Key Vault first.`);
    let storedValue = value;
    if (reference) {
      const match = value.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)$/u);
      if (!match) throw new Error(`Invalid Vault reference: ${name}`);
      storedValue = JSON.stringify({ uri: `https://${match[1]}.vault.azure.net/secrets/${match[2]}` });
    }
    items.push({ key: `${cloudSettings.prefix}${name}`, label: machineNames.has(name) ? machineLabel : cloudSettings.label, value: storedValue, content_type: reference ? vaultContentType : "text/plain", tags: { project: "wwp", source: "legacy-migration" } });
  }
  return items;
}

if (process.argv[1]?.endsWith("migrate-cloud-config.mjs")) {
  try {
    const source = parse(readFileSync(process.argv[2] || ".env"));
    const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const deployment = JSON.parse(execFileSync(shell, ["-NoProfile", "-File", fileURLToPath(new URL("./deployment-config-schema.ps1", import.meta.url))], { encoding: "utf8", windowsHide: true }));
    Object.assign(source, deployment);
    const machineLabel = `${cloudSettings.label}:machine:${hostname().toLowerCase()}`;
    const items = migrationItems(source, machineLabel);
    console.log(JSON.stringify({ items: items.length, shared: items.filter(i => i.label === cloudSettings.label).length, machine: items.filter(i => i.label === machineLabel).length, machineLabel, apply: process.argv.includes("--apply") }));
    if (process.argv.includes("--apply")) {
      const token = azureJson(["account", "get-access-token", "--resource", "https://azconfig.io"]).accessToken;
      // Serial writes/readback: approximately 2 requests per item; bounded below Free quota.
      let completed = 0;
      for (const item of items) {
        const url = `${cloudSettings.endpoint}/kv/${encodeURIComponent(item.key)}?label=${encodeURIComponent(item.label)}&api-version=1.0`;
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.microsoft.appconfig.kv+json", "If-None-Match": "*" };
        const existing = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
        if (existing.ok) {
          const saved = await existing.json();
          if (saved.value !== item.value || saved.content_type !== item.content_type) throw new Error(`Existing cloud configuration differs: ${item.key}; no overwrite performed.`);
          completed += 1;
          if (completed % 25 === 0) console.log(`Verified ${completed}/${items.length} settings`);
          continue;
        }
        if (existing.status !== 404) throw new Error(`Configuration lookup HTTP ${existing.status}; stopped without retry.`);
        const response = await fetch(url, { method: "PUT", headers, body: JSON.stringify(item), signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Configuration write HTTP ${response.status}; stopped; rerun to resume.`);
        const saved = await response.json();
        if (saved.value !== item.value || saved.content_type !== item.content_type) throw new Error(`Configuration readback mismatch: ${item.key}`);
        completed += 1;
        if (completed % 25 === 0) console.log(`Verified ${completed}/${items.length} settings`);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      console.log(`Stored/verified ${items.length} settings without overwriting different cloud values.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
