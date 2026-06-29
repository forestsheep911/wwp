import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type LocalCacheState,
  emptyCacheState
} from "@wwpdw/shared";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const dataDir = path.resolve(process.env.WWPDW_LOCAL_DATA_DIR ?? path.join(repoRoot, ".local-data"));
const statePath = path.join(dataDir, "cache-state.json");

export const getStatePath = () => statePath;

export async function readState(): Promise<LocalCacheState> {
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw) as LocalCacheState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return emptyCacheState();
    }
    throw error;
  }
}

export async function writeState(state: LocalCacheState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}
