import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const DEFAULT_PRODUCTION_LOCK_PATH = ".local-data/wwp-production-network.lock";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return { owner: "unknown", pid: null, mode: "unknown" };
  }
}

export function acquireProductionLock({
  lockPath = process.env.WWP_PRODUCTION_LOCK_PATH || DEFAULT_PRODUCTION_LOCK_PATH,
  owner,
  mode
} = {}) {
  const resolved = path.resolve(lockPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const token = randomUUID();
  const record = { schemaVersion: 1, token, owner: owner || "unknown", mode: mode || "unknown", pid: process.pid, acquiredAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(resolved, "wx");
      writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      closeSync(descriptor);
      let released = false;
      return {
        path: resolved,
        record,
        release() {
          if (released) return;
          released = true;
          if (!existsSync(resolved)) return;
          const current = readOwner(resolved);
          if (current.token === token) unlinkSync(resolved);
        }
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== "EEXIST") throw error;
      const current = readOwner(resolved);
      if (!processIsAlive(Number(current.pid)) && attempt === 0) {
        unlinkSync(resolved);
        continue;
      }
      throw new Error(`WWP production network lane is busy: owner=${current.owner ?? "unknown"}, mode=${current.mode ?? "unknown"}, pid=${current.pid ?? "unknown"}, acquiredAt=${current.acquiredAt ?? "unknown"}`);
    }
  }
  throw new Error("Unable to acquire WWP production network lane.");
}
