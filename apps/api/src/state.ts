import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CacheJob,
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

export async function updateState<T>(mutator: (state: LocalCacheState) => T): Promise<T> {
  const state = await readState();
  const result = mutator(state);
  await writeState(state);
  return result;
}

export function createJob(input: {
  assetKey: string;
  title: string;
  source: string;
}): CacheJob {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 8);

  return {
    id: `job_${Date.now()}_${suffix}`,
    assetKey: input.assetKey,
    title: input.title,
    source: input.source,
    status: "queued",
    progress: 0,
    message: "Waiting for a cache worker.",
    createdAt: now,
    updatedAt: now
  };
}
