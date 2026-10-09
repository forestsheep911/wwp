import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { azureJson } from "./azure-cli.mjs";

export const cloudSettings = JSON.parse(readFileSync(new URL("../../config/cloud.json", import.meta.url), "utf8"));
export const vaultContentType = "application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8";
export function isSensitiveName(name) {
  return name.startsWith("DEPLOY_")
    ? /(?:APIKEY|ACCESSKEYID|ACCESSKEYSECRET|ADMINKEY|PASSWORD|TOKEN|CONNECTIONSTRING|COOKIE)$/u.test(name)
    : /(?:TOKEN|API_KEY|ACCESS_KEY|ADMIN_KEY|PASSWORD|CONNECTION_STRING|COOKIE|CONTROLLER_SECRET|VPN_TRAFFIC_CHECK_URL)/u.test(name);
}
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
let loaded = false;

export function settingsFor(env = process.env) {
  const label = env.WWP_CONFIG_LABEL || cloudSettings.label;
  const machine = env.WWP_CONFIG_MACHINE_LABEL ?? `${label}:machine:${hostname().toLowerCase()}`;
  if (!/^[a-zA-Z0-9:._-]+$/u.test(label) || (machine && !/^[a-zA-Z0-9:._-]+$/u.test(machine))) throw new Error("Invalid configuration label");
  return { ...cloudSettings, label, machine, endpoint: env.WWP_CONFIG_ENDPOINT || cloudSettings.endpoint };
}

export function flattenSettings(items, settings) {
  const result = {};
  for (const label of [settings.label, settings.machine].filter(Boolean)) {
    for (const item of items.filter(item => item.label === label)) {
      if (!item.key.startsWith(settings.prefix)) continue;
      const name = item.key.slice(settings.prefix.length);
      if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) throw new Error("Invalid project configuration key");
      // An override replaces either a plain value OR a Vault reference.
      delete result[name];
      delete result[`${name}__KEY_VAULT`];
      if (item.contentType?.startsWith("application/vnd.microsoft.appconfig.keyvaultref+json")) {
        const uri = JSON.parse(item.value).uri;
        const match = typeof uri === "string" && uri.match(/^https:\/\/([a-zA-Z0-9-]+)\.vault\.azure\.net\/secrets\/([a-zA-Z0-9-]+)$/u);
        if (!match) throw new Error(`Invalid Key Vault reference for ${name}`);
        result[`${name}__KEY_VAULT`] = `${match[1]}/${match[2]}`;
      } else {
        if (item.value && isSensitiveName(name)) throw new Error(`Plaintext sensitive configuration rejected: ${name}; use a Key Vault reference.`);
        result[name] = String(item.value ?? "");
      }
    }
  }
  return result;
}

export function readCloudConfiguration({ refresh = false, env = process.env } = {}) {
  const settings = settingsFor(env);
  const cacheDir = path.join(repoRoot, ".local-data", "app-configuration");
  const cacheFile = path.join(cacheDir, createHash("sha256").update(JSON.stringify(settings)).digest("hex") + ".json");
  if (!refresh && existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (cache.fetchedAt <= Date.now() && Date.now() - cache.fetchedAt < settings.cacheSeconds * 1000) return flattenSettings(cache.items, settings);
    } catch { /* Corrupt cache is refetched. Expired cache is never used silently. */ }
  }
  const items = azureJson(["appconfig", "kv", "list", "--endpoint", settings.endpoint, "--auth-mode", "login", "--key", `${settings.prefix}*`, "--label", [settings.label, settings.machine].filter(Boolean).join(","), "--all"]);
  if (!Array.isArray(items) || !items.some(item => item.label === settings.label)) throw new Error(`No ${settings.prefix} configuration for label ${settings.label}`);
  const result = flattenSettings(items, settings);
  mkdirSync(cacheDir, { recursive: true });
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ fetchedAt: Date.now(), items }), { mode: 0o600 });
  renameSync(temporary, cacheFile);
  return result;
}

export function loadCloudConfiguration(options = {}) {
  if (loaded) return;
  const mode = process.env.WWP_CONFIG_MODE || (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "test" || process.env.CONTAINER_APP_NAME || process.env.CONTAINER_APP_JOB_NAME ? "injected" : "cloud");
  if (mode === "injected") return;
  if (mode !== "cloud") throw new Error("WWP_CONFIG_MODE must be cloud or injected");
  const values = readCloudConfiguration(options);
  for (const [name, value] of Object.entries(values)) if (process.env[name] === undefined) process.env[name] = value;
  loaded = true;
}
