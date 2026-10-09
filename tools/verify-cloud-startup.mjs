// Live no-dotenv smoke: isolated local backend, no business API calls or writes.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(path.join(root, ".env"))) throw new Error("Archive the verified legacy .env before this no-dotenv smoke check.");
const dir = mkdtempSync(path.join(tmpdir(), "wwp-cloud-startup-"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const env = { ...process.env, WWP_CONFIG_MODE: "cloud", API_PORT: String(port), CACHE_BACKEND: "local", WWPDW_AUTH_BACKEND: "local", WWPDW_SESSION_BACKEND: "local", WWPDW_SEARCH_SOURCE: "mock", SEARCH_INDEX_BACKEND: "local", PERSON_CATALOG_BACKEND: "local", TSPDT_BROWSE_BACKEND: "local", WWPDW_LOCAL_DATA_DIR: dir };
delete env.DOTENV_CONFIG_PATH;
delete env.NODE_TEST_CONTEXT;
const child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
// Drain logs without printing configuration or secrets.
child.stdout.resume(); child.stderr.resume();
let failed = false;
let interrupted = false;
child.on("error", () => { failed = true; });
const cancel = () => { interrupted = true; child.kill(); };
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const deadline = Date.now() + 120000;
  let success = false;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && !failed && !interrupted) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { success = true; break; }
    } catch { /* Wait for configuration/Vault loading and server startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!success) throw new Error("No-dotenv API startup failed; inspect configuration permissions and entrypoint manually.");
  console.log("No-dotenv cloud-configured API startup: /health HTTP 200 (isolated local data).");
} finally {
  if (child.exitCode === null && child.signalCode === null && !failed) {
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
  rmSync(dir, { recursive: true, force: true });
}
