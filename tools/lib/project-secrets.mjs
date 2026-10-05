import { execFileSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";

// References contain only vault/name metadata. Values live in process memory.
export function resolveSecretReferences(env = process.env, readSecret = readAzureSecret, onlyNames = null) {
  for (const [name, reference] of Object.entries(env)) {
    if (!name.endsWith("__KEY_VAULT") || !reference) continue;
    const destination = name.slice(0, -11);
    if (onlyNames && !onlyNames.has(destination)) continue;
    if (env[destination]) continue;
    const match = reference.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)$/u);
    if (!match) throw new Error(`Invalid Key Vault reference for ${destination}`);
    env[destination] = readSecret(match[1], match[2]);
  }
  return env;
}

function readAzureSecret(vault, name) {
  // Only validated public identifiers enter this command. Never put values in argv.
  const args = ["keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value", "-o", "json", "--only-show-errors"];
  try {
    const output = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `az ${args.join(" ")}`], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 })
      : execFileSync("az", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    const value = JSON.parse(output);
    if (typeof value !== "string" || !value) throw new Error("empty secret");
    return value;
  } catch {
    throw new Error(`Unable to read Key Vault secret ${vault}/${name}; check az login and secret-read permission.`);
  }
}

export function config(options = {}) {
  const { resolveSecrets = true, ...dotenvOptions } = options;
  const result = loadDotenv({ quiet: true, ...(process.env.DOTENV_CONFIG_PATH ? { path: process.env.DOTENV_CONFIG_PATH } : {}), ...dotenvOptions });
  if (resolveSecrets === true) resolveSecretReferences();
  else if (Array.isArray(resolveSecrets)) resolveSecretReferences(process.env, readAzureSecret, new Set(resolveSecrets));
  return result;
}

export function projectEnv(name) {
  config({ resolveSecrets: [] });
  if (!process.env[name]) {
    resolveSecretReferences(process.env, readAzureSecret, new Set([name]));
  }
  return process.env[name];
}
