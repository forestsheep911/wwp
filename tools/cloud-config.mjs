import { spawnSync } from "node:child_process";
import { readCloudConfiguration, settingsFor } from "./lib/cloud-config.mjs";
import { resolveSecretReferences } from "./lib/project-secrets.mjs";

try {
  const [command = "check", ...args] = process.argv.slice(2);
  const values = readCloudConfiguration({ refresh: command === "refresh" });
  if (command === "check" || command === "refresh") {
    const settings = settingsFor();
    console.log(JSON.stringify({ endpoint: settings.endpoint, prefix: settings.prefix, label: settings.label, machineLabel: settings.machine, plainSettings: Object.keys(values).filter(n => !n.endsWith("__KEY_VAULT")).length, vaultReferences: Object.keys(values).filter(n => n.endsWith("__KEY_VAULT")).length }, null, 2));
  } else if (command === "export") {
    // Internal pipe for PowerShell. No resolved secret values are exported.
    process.stdout.write(JSON.stringify(values));
  } else if (command === "run") {
    const env = { ...values, ...process.env, WWP_CONFIG_MODE: "injected" };
    if (!args.length) throw new Error("Usage: node tools/cloud-config.mjs run <executable> [args...]");
    const result = spawnSync(args[0], args.slice(1), { env, stdio: "inherit", windowsHide: true });
    if (result.error) throw new Error("Unable to start executable; use pwsh on Windows/macOS for deployment scripts");
    process.exitCode = result.status ?? 1;
  } else if (command === "secret-check") {
    const env = { ...values, ...process.env };
    resolveSecretReferences(env);
    console.log(`Verified ${Object.keys(values).filter(n => n.endsWith("__KEY_VAULT")).length} Vault references in memory; no values persisted.`);
  } else {
    throw new Error("Commands: check, refresh, secret-check, run, export (internal)");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
