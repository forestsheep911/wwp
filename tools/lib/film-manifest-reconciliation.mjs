import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function manifestIdentity(manifest) {
  return JSON.stringify([
    manifest.workPageId ?? null,
    manifest.targetSpecPageId ?? null,
    manifest.episodePageId ?? null
  ]);
}

export function discoverRecentProductionManifests(directory, { limit = 5 } = {}) {
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /production.*\.json$/iu.test(entry.name))
    .map(entry => {
      const filePath = path.resolve(directory, entry.name);
      const stat = statSync(filePath);
      const manifest = JSON.parse(readFileSync(filePath, "utf8"));
      return { filePath, fileName: entry.name, modifiedAt: stat.mtimeMs, manifest };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const identity = manifestIdentity(candidate.manifest);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(candidate);
    if (unique.length >= Math.max(1, Math.trunc(Number(limit)) || 5)) break;
  }
  return unique;
}
