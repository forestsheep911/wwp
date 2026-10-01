import fs from "node:fs";
import { AzureCliCredential } from "@azure/identity";
import { parse } from "dotenv";

const file = ".env";
const original = fs.readFileSync(file, "utf8");
const env = parse(original);
if (fs.existsSync(".douban.cookie")) env.DOUBAN_COOKIE = fs.readFileSync(".douban.cookie", "utf8").trim();
const credential = new AzureCliCredential();
const token = await credential.getToken("https://vault.azure.net/.default");
const vault = "kv-wwcache-e9219db7";
async function request(name, method = "GET", value) {
  const response = await fetch(`https://${vault}.vault.azure.net/secrets/${name}?api-version=7.4`, {
    method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify({ value }) } : {})
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Vault request failed for ${name}: HTTP ${response.status}`);
  return response.json();
}
const names = Object.keys(env).filter(name => !name.endsWith("__KEY_VAULT") && /(?:API_KEY|ACCESS_KEY_ID|ACCESS_KEY_SECRET|SECURITY_TOKEN|ADMIN_KEY|NOTION_(?:TOKEN|API_KEY|READ_ONLY_TOKEN|WRITE_TOKEN)|CONNECTION_STRING|PASSWORD|CONTROLLER_SECRET|VPN_TRAFFIC_CHECK_URL|DOUBAN_COOKIE)/u.test(name) && env[name]);
const references = new Map();
for (const name of names) {
  let secretName = name.replaceAll("_", "-");
  let existing = await request(secretName);
  // Preserve cloud credentials if a local development credential differs.
  if (existing && existing.value !== env[name]) {
    secretName = `LOCAL-${secretName}`;
    existing = await request(secretName);
    if (existing && existing.value !== env[name]) throw new Error(`Conflicting local Vault secret: ${secretName}`);
  }
  if (!existing) await request(secretName, "PUT", env[name]);
  const verified = await request(secretName);
  if (verified?.value !== env[name]) throw new Error(`Readback mismatch: ${name}`);
  references.set(name, `${vault}/${secretName}`);
  console.log(`${name}: stored and verified`);
}
let updated = original.split(/\r?\n/u).filter(line => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
  return !match || !references.has(match[1]);
}).join("\n");
updated += "\n# Values are retrieved from Azure Key Vault into process memory.\n";
for (const [name, reference] of references) updated += `${name}__KEY_VAULT=${reference}\n`;
// Apply the local secret removal without printing either file or a plaintext backup.
fs.mkdirSync(".local-data", { recursive: true });
fs.writeFileSync(".local-data/env-vault-remove.patch", "*** Begin Patch\n*** Delete File: .env\n*** End Patch\n");
fs.writeFileSync(".local-data/env-vault-migration.patch", `*** Begin Patch\n*** Add File: .env\n${updated.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
console.log(`Verified ${references.size} secrets; apply env-vault-remove.patch, then env-vault-migration.patch from .local-data.`);
