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
    archiveCount: entry.archiveCount,
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
    archiveCount: entry.archiveCount,
    totalBytes: entry.totalBytes,
    largestMedia: entry.fingerprintMedia ?? entry.largestMedia,
    flags: entry.flags
  };
  return createHash("sha256").update(JSON.stringify(legacyMaterial)).digest("hex");
}

export function fingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify(fingerprintMaterial(entry))).digest("hex");
}

// Older scans did not persist imageCount. Accept the short-lived expanded
// fingerprint written by 0.1.99 without reopening every historical source.
function expandedEvidenceFingerprintEntry(entry) {
  return createHash("sha256").update(JSON.stringify({ ...fingerprintMaterial(entry), imageCount: entry.imageCount })).digest("hex");
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
  // Subtitle- and artwork-only directories are reusable companion evidence,
  // never independent encode inputs.
  if ((entry.mediaCount ?? 0) === 0 && (entry.subtitleCount ?? 0) > 0) return "subtitle_bundle";
  if ((entry.mediaCount ?? 0) === 0 && ((entry.imageCount ?? 0) > 0 || (entry.nfoCount ?? 0) > 0)) return "companion_evidence";
  // Archives without a recognized media file are not safe production inputs:
  // they may be manga, documents, subtitles, or a container that still needs
  // extraction. Keep them visible without creating a phantom intake task.
  if ((entry.mediaCount ?? 0) === 0 && (entry.archiveCount ?? 0) > 0) return "archive_bundle";
  return entry.flags?.looksSeries ? "series_folder" : "folder";
}

function isQuarantineRoot(rootPath) {
  const normalized = normalizeLedgerPath(rootPath).replace(/[\\/]+$/u, "");
  return path.win32.basename(normalized).toLowerCase() === "待人工删除";
}

function isResolvedCollectionShrink(repo, inputRootId, parentSource) {
  const relativePrefix = `${parentSource.relative_path}\\`.toLowerCase();
  const parentAbsolute = normalizeLedgerPath(parentSource.absolute_path).replace(/[\\/]+$/u, "").toLowerCase();
  const absolutePrefix = `${parentAbsolute}\\`;
  const isDescendant = (source) => {
    const relative = source.relative_path.toLowerCase();
    const absolute = normalizeLedgerPath(source.absolute_path).toLowerCase();
    return relative.startsWith(relativePrefix) || absolute.startsWith(absolutePrefix);
  };
  const descendants = repo.listSourcesForRoot(inputRootId)
    .filter((source) => source.id !== parentSource.id
      && isDescendant(source));
  const leaves = descendants.filter((source) => !descendants.some((other) => other.id !== source.id
    && (other.relative_path.toLowerCase().startsWith(`${source.relative_path}\\`.toLowerCase())
      || normalizeLedgerPath(other.absolute_path).toLowerCase().startsWith(`${normalizeLedgerPath(source.absolute_path).replace(/[\\/]+$/u, "").toLowerCase()}\\`))));

  return leaves.length > 0
    && leaves.every((source) => source.work_id != null)
    && leaves.some((source) => !existsSync(source.absolute_path));
}

export function importScan(repo, payload) {
  validatePayload(payload);
  const normalizedRoot = normalizeLedgerPath(payload.root);
  const quarantineRoot = isQuarantineRoot(normalizedRoot);
  const root = repo.upsertInputRoot(normalizedRoot, { lastScanAt: payload.scannedAt ?? new Date().toISOString() });
  const existing = new Map(repo.listSourcesForRoot(root.id).map(source => [source.relative_path, source]));
  const seen = new Set();
  const summary = { inserted: 0, unchanged: 0, changed: 0, missing: 0 };

  for (const entry of payload.entries) {
    const fingerprint = fingerprintEntry(entry);
    const previous = existing.get(entry.relativePath);
    const resolvedAbsolutePath = resolvedEntryPath(normalizedRoot, entry.relativePath, entry.absolutePath);
    // Quarantine is an audit location, not an intake source. Cleanup already
    // records moved source paths in the ledger, so an unknown child here must
    // never re-enter discovery as a new film.
    if (quarantineRoot && !previous) {
      summary.skippedQuarantine = (summary.skippedQuarantine ?? 0) + 1;
      continue;
    }
    const fingerprintMatches = previous && (previous.fingerprint === fingerprint
      || previous.fingerprint === expandedEvidenceFingerprintEntry(entry)
      || previous.fingerprint === migrationFingerprintEntry(entry)
      || previous.fingerprint === legacyFingerprintEntry(entry));
    const flatPathRepair = Boolean(previous
      && previous.missing === 1
      && previous.relative_path.toLowerCase().startsWith("@flat/")
      && fingerprintMatches
      && existsSync(resolvedAbsolutePath));
    const state = !previous
      ? "inserted"
      : fingerprintMatches && (previous.missing === 0 || flatPathRepair)
        ? "unchanged"
        : "changed";
    summary[state] += 1;
    seen.add(entry.relativePath);
    const source = repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: entry.relativePath,
      absolutePath: resolvedAbsolutePath,
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
    if (!quarantineRoot && !syntheticMissing && flatPathRepair && previous?.work_id == null) {
      repo.requeueIntakeTask(source.id, {
        reason: "Flat source path repaired; inspect the newly reachable media identity and Notion state"
      });
    } else if (!quarantineRoot && !syntheticMissing && state === "inserted"
      && !["companion_evidence", "subtitle_bundle", "archive_bundle"].includes(source.source_kind)) {
      repo.requeueIntakeTask(source.id, {
        reason: "New source discovered; inspect identity, duplicates, Notion state, and routing"
      });
    } else if (!quarantineRoot && !syntheticMissing && state === "changed"
      && !["companion_evidence", "subtitle_bundle", "archive_bundle"].includes(source.source_kind)
      && !isResolvedCollectionShrink(repo, root.id, source)) {
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
  // A prior split or manual member binding can leave the parent task pending
  // even though every leaf is already identified. Reconcile this on every
  // bounded scan so stale parent tasks cannot keep intake falsely actionable.
  repo.reconcileCollectionIntake(root.id);
  return { root, summary };
}
