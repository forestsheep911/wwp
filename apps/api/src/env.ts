import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");

const candidatePaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(repoRoot, ".env"),
  path.join(process.cwd(), ".env")
].filter((value): value is string => Boolean(value));

for (const candidatePath of candidatePaths) {
  if (existsSync(candidatePath)) {
    // Process environment must win so deployment and isolated smoke tests can
    // safely override local developer defaults from .env.
    config({ path: candidatePath, override: false });
    break;
  }
}
