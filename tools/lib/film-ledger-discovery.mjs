import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeLedgerPath } from "./film-ledger-repository.mjs";

function fingerprintMaterial(entry) {
  return {
    relativePath: entry.relativePath,
    fileCount: entry.fileCount,
    mediaCount: entry.mediaCount,
    subtitleCount: entry.subtitleCount,
    nfoCount: entry.nfoCount,
    totalBytes: entry.totalBytes,
    largestMedia: entry.largestMedia,
    flags: entry.flags
  };
}

export function fingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify(fingerprintMaterial(entry))).digest("hex");
}

function validatePayload(payload) {
  if (!payload || typeof payload.root !== "string" || payload.root.length === 0) throw new TypeError("scan root is required");
  if (!Array.isArray(payload.entries)) throw new TypeError("scan entries must be an array");
  for (const entry of payload.entries) {
    if (!entry || typeof entry.relativePath !== "string" || entry.relativePath.length === 0) {
      throw new TypeError("every scan entry requires relativePath");
    }
  }
}

export function importScan(repo, payload) {
  validatePayload(payload);
  const normalizedRoot = normalizeLedgerPath(payload.root);
  const root = repo.upsertInputRoot(normalizedRoot, { lastScanAt: payload.scannedAt ?? new Date().toISOString() });
  const existing = new Map(repo.listSourcesForRoot(root.id).map(source => [source.relative_path, source]));
  const seen = new Set();
  const summary = { inserted: 0, unchanged: 0, changed: 0, missing: 0 };

  for (const entry of payload.entries) {
    const fingerprint = fingerprintEntry(entry);
    const previous = existing.get(entry.relativePath);
    const state = !previous ? "inserted" : previous.fingerprint === fingerprint && previous.missing === 0 ? "unchanged" : "changed";
    summary[state] += 1;
    seen.add(entry.relativePath);
    const source = repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: entry.relativePath,
      absolutePath: /^[a-z]:[\\/]/i.test(normalizedRoot)
        ? normalizeLedgerPath(path.win32.resolve(normalizedRoot, entry.relativePath))
        : path.resolve(normalizedRoot, entry.relativePath),
      fingerprint,
      sourceKind: entry.flags?.looksSeries ? "series_folder" : "folder",
      subtitleEvidence: { count: entry.subtitleCount ?? 0, hints: entry.subtitleHints ?? [] },
      colorRisk: entry.flags?.looksDv ? "dolby_vision" : entry.flags?.looksHdr ? "hdr" : "unknown",
      missing: false,
      discoveredAt: payload.scannedAt
    });
    existing.set(entry.relativePath, source);
  }

  for (const source of existing.values()) {
    if (!seen.has(source.relative_path) && source.missing === 0) {
      repo.markSourceMissing(source.id, true);
      summary.missing += 1;
    }
  }
  return { root, summary };
}
