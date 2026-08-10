import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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
    latestFileMtime: entry.latestFileMtime ?? null,
    contentFingerprint: entry.contentFingerprint ?? null,
    // Keep discovery identity independent from the human-facing sample count.
    largestMedia: entry.fingerprintMedia ?? entry.largestMedia,
    flags: entry.flags
  };
}

function preContentFingerprintMaterial(entry) {
  const material = fingerprintMaterial(entry);
  delete material.contentFingerprint;
  return material;
}

function legacyFingerprintEntry(entry) {
  const legacyMaterial = {
    relativePath: entry.relativePath,
    fileCount: entry.fileCount,
    mediaCount: entry.mediaCount,
    subtitleCount: entry.subtitleCount,
    nfoCount: entry.nfoCount,
    totalBytes: entry.totalBytes,
    largestMedia: entry.fingerprintMedia ?? entry.largestMedia,
    flags: entry.flags
  };
  return createHash("sha256").update(JSON.stringify(legacyMaterial)).digest("hex");
}

export function fingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify(fingerprintMaterial(entry))).digest("hex");
}

function migrationFingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify(preContentFingerprintMaterial(entry))).digest("hex");
}

function resolvedEntryPath(rootPath, relativePath, absolutePath) {
  const normalizedRoot = normalizeLedgerPath(rootPath);
  const normalizedAbsolute = absolutePath
    ? normalizeLedgerPath(absolutePath)
    : null;
  // The scanner uses the input root as a placeholder for synthetic @flat
  // groups. Resolve the relative path instead of treating the existing root
  // directory as proof that the synthetic source still exists.
  if (normalizedAbsolute && normalizedAbsolute.toLowerCase() !== normalizedRoot.toLowerCase()) {
    return normalizedAbsolute;
  }
  return /^[a-z]:[\\/]/i.test(normalizedRoot)
    ? normalizeLedgerPath(path.win32.resolve(normalizedRoot, relativePath))
    : path.resolve(normalizedRoot, relativePath);
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

function sourceKindFor(entry) {
  // Subtitle-only directories are reusable companion evidence, never encode inputs.
  if ((entry.mediaCount ?? 0) === 0 && (entry.subtitleCount ?? 0) > 0) return "subtitle_bundle";
  return entry.flags?.looksSeries ? "series_folder" : "folder";
}

function isResolvedCollectionShrink(repo, inputRootId, parentSource) {
  const prefix = `${parentSource.relative_path}\\`.toLowerCase();
  const descendants = repo.listSourcesForRoot(inputRootId)
    .filter((source) => source.id !== parentSource.id
      && source.relative_path.toLowerCase().startsWith(prefix));
  const leaves = descendants.filter((source) => !descendants.some((other) => other.id !== source.id
    && other.relative_path.toLowerCase().startsWith(`${source.relative_path}\\`.toLowerCase())));

  return leaves.length > 0
    && leaves.every((source) => source.work_id != null)
    && leaves.some((source) => !existsSync(source.absolute_path));
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
    const state = !previous
      ? "inserted"
      : (previous.fingerprint === fingerprint
        || previous.fingerprint === migrationFingerprintEntry(entry)
        || previous.fingerprint === legacyFingerprintEntry(entry)) && previous.missing === 0
        ? "unchanged"
        : "changed";
    summary[state] += 1;
    seen.add(entry.relativePath);
    const source = repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: entry.relativePath,
      absolutePath: resolvedEntryPath(normalizedRoot, entry.relativePath, entry.absolutePath),
      fingerprint,
      sourceKind: sourceKindFor(entry),
      subtitleEvidence: {
        externalCount: entry.subtitleCount ?? 0,
        externalHints: entry.subtitleHints ?? [],
        internalProbeState: entry.internalSubtitleProbe ?? "not_run"
      },
      colorRisk: entry.flags?.looksDv ? "dolby_vision" : entry.flags?.looksHdr ? "hdr" : "unknown",
      missing: false,
      discoveredAt: payload.scannedAt
    });
    const syntheticMissing = source.relative_path.toLowerCase().startsWith("@flat/")
      && !existsSync(source.absolute_path)
      && source.missing === 0;
    if (syntheticMissing) {
      repo.markSourceMissing(source.id, true);
      summary.missing += 1;
    }
    if (!syntheticMissing && state === "inserted") {
      repo.requeueIntakeTask(source.id, {
        reason: "New source discovered; inspect identity, duplicates, Notion state, and routing"
      });
    } else if (!syntheticMissing && state === "changed" && !isResolvedCollectionShrink(repo, root.id, source)) {
      repo.requeueIntakeTask(source.id, {
        reason: "Source contents changed; inspect added, replaced, or removed media before continuing"
      });
    }
    existing.set(entry.relativePath, source);
  }

  for (const source of existing.values()) {
    // Collection members are indexed below a scanned parent entry, so they do
    // not appear in the top-level scan payload. Only mark a source missing when
    // it is absent from both the scan and the filesystem.
    if (!seen.has(source.relative_path)) {
      const filesystemPath = source.relative_path.toLowerCase().startsWith("@flat/")
        ? resolvedEntryPath(root.path, source.relative_path, source.absolute_path)
        : source.absolute_path;
      if (existsSync(filesystemPath)) {
        if (source.missing === 1) repo.markSourceMissing(source.id, false);
      } else if (source.missing === 0) {
        repo.markSourceMissing(source.id, true);
        summary.missing += 1;
      }
    }
  }
  return { root, summary };
}
