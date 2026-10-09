import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCloudConfiguration } from "../tools/lib/cloud-config.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const legacySettings = [
  "WWPDW_ADMIN_KEY", "AZURE_STORAGE_MEMBER_TABLE", "WWPDW_HOME_BROWSE_FRESH_SECONDS",
  "WWPDW_HOME_BROWSE_ORIGIN_TIMEOUT_MS", "WWPDW_HOME_BROWSE_STALE_REFRESH_TIMEOUT_MS",
  "WWPDW_HOME_BROWSE_STALE_SECONDS", "WWPDW_HOME_CACHE_CONTAINER",
  "WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING"
];
const parameters = {
  "resource-group": ["RESOURCEGROUP", "rg-ww-player-cache-dev"],
  "static-app-name": ["STATICAPPNAME", "stapp-ww-player-dev"],
  location: ["LOCATION", "eastasia"],
  "api-app-name": ["APIAPPNAME", "ca-ww-player-api"],
  "api-base-url": ["APIBASEURL", ""],
  "az-cli": ["AZCLI", "az"]
};
export function deploymentOptions(argv, cloud = {}, env = process.env) {
  const options = Object.fromEntries(Object.entries(parameters).map(([name, [key, fallback]]) => {
    const configKey = `DEPLOY_DEPLOY_WEB_STATICAPP_${key}`;
    return [name, env[configKey] ?? cloud[configKey] ?? (name === "az-cli" ? env.WWPDW_AZ_CLI : undefined) ?? fallback];
  }));
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/u, "");
    if (!argv[i].startsWith("--") || !parameters[name] || argv[i + 1] == null || argv[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete deployment option: ${argv[i]}`);
    options[name] = argv[++i];
  }
  return options;
}
export function validateAssets(directory, apiBaseUrl) {
  let foundLogin = false;
  let scripts = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) {
        scripts++;
        const content = fs.readFileSync(file, "utf8");
        if (apiBaseUrl && content.includes(apiBaseUrl)) throw new Error("Built web asset still contains cross-site API base URL.");
        foundLogin ||= content.includes("/api/auth/login");
      }
    }
  }
  walk(directory);
  if (!scripts || !foundLogin) throw new Error("Built web assets do not contain the same-origin login route.");
}

export async function deployWeb(options, io) {
  const resourceGroup = options["resource-group"];
  const name = options["static-app-name"];
  const common = ["--name", name, "--resource-group", resourceGroup];
  let apiBaseUrl = options["api-base-url"];
  if (!apiBaseUrl) {
    const fqdn = io.az(["containerapp", "show", "--name", options["api-app-name"], "--resource-group", resourceGroup, "--query", "properties.configuration.ingress.fqdn"]);
    if (!fqdn) throw new Error("Could not find API Container App FQDN.");
    apiBaseUrl = `https://${fqdn}`;
  }
  const apps = io.az(["staticwebapp", "list", "--resource-group", resourceGroup]);
  if (!apps.some(app => app.name === name)) {
    io.az(["staticwebapp", "create", ...common, "--location", options.location, "--sku", "Free", "--tags", "project=ww-player-cache", "env=dev", "managedBy=infra-script", "component=web"]);
  }
  const host = io.az(["staticwebapp", "show", ...common, "--query", "defaultHostname"]);
  if (!host) throw new Error("Could not find Static Web App hostname.");
  const origin = `https://${host}`;
  io.build();
  io.validate(apiBaseUrl);
  io.az(["staticwebapp", "appsettings", "set", ...common, "--setting-names", `WWPDW_ORIGIN_API_BASE_URL=${apiBaseUrl}`, `WWPDW_PUBLIC_WEB_ORIGIN=${origin}`, "WWPDW_BFF_TIMEOUT_MS=90000"]);
  const token = io.az(["staticwebapp", "secrets", "list", ...common, "--query", "properties.apiKey"]);
  if (!token) throw new Error("Could not read Static Web App deployment token.");
  io.upload(token);
  // A CLI zero exit can precede a failed/incomplete client download.
  await io.verify(origin);
  const existing = io.az(["staticwebapp", "appsettings", "list", ...common]);
  const remove = legacySettings.filter(key => Object.hasOwn(existing.properties ?? {}, key));
  if (remove.length) io.az(["staticwebapp", "appsettings", "delete", ...common, "--setting-names", ...remove]);
  return { name, url: origin, apiBaseUrl, apiLocation: path.join(repoRoot, "api") };
}

export async function verifyDeployment(origin, directory) {
  const response = await fetch(origin, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Deployed homepage returned HTTP ${response.status}.`);
  const html = await response.text();
  const localHtml = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  const assetPaths = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/gu)].map(match => match[1]);
  if (!assetPaths.length || assetPaths.some(asset => !html.includes(asset))) throw new Error("Deployed homepage does not reference this build's assets.");
  for (const asset of assetPaths) {
    const res = await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Deployed asset returned HTTP ${res.status}.`);
    const remote = Buffer.from(await res.arrayBuffer());
    const local = fs.readFileSync(path.join(directory, asset.slice(1)));
    if (!remote.equals(local)) throw new Error("Deployed asset differs from the local production build.");
  }
  console.log("Verified deployed homepage and production JS/CSS bytes.");
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(`Usage: zsh infra/deploy-web-staticapp.zsh ${Object.keys(parameters).map(k => `[--${k} <value>]`).join(" ")}`);
    return;
  }
  const options = deploymentOptions(process.argv.slice(2), readCloudConfiguration());
  const directory = path.join(repoRoot, "apps/web/dist");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = await deployWeb(options, {
    az(args) {
      try {
        const output = execFileSync(options["az-cli"], [...args, "--only-show-errors", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
        return output.trim() ? JSON.parse(output) : null;
      } catch { throw new Error(`Azure ${args.slice(0, 3).join(" ")} failed; check subscription, login and RBAC.`); }
    },
    build() { execFileSync(npm, ["run", "build", "--workspace", "@wwpdw/web"], { cwd: repoRoot, env: { ...process.env, VITE_API_BASE_URL: "" }, stdio: "inherit" }); },
    validate(apiBaseUrl) { validateAssets(directory, apiBaseUrl); },
    upload(token) {
      // Keep the token out of process arguments and persistent files.
      execFileSync(npx, ["-y", "@azure/static-web-apps-cli", "deploy", directory, "--api-location", path.join(repoRoot, "api"), "--api-language", "node", "--api-version", "20", "--env", "production"], { cwd: repoRoot, env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token, SWA_CLI_DEBUG: "" }, stdio: "inherit" });
    },
    verify(origin) { return verifyDeployment(origin, directory); }
  });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
