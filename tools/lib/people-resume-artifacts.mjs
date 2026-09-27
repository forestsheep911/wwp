import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function filesUnder(root, output = []) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(fullPath, output);
    else if (/\.json$/iu.test(entry.name)) output.push(fullPath);
  }
  return output;
}

function readJson(filePath) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { return null; }
}

function reportIdentity(report) {
  const credit = report?.proposedCredits?.[0] ?? {};
  return {
    workId: credit.workId ?? report?.workId ?? null,
    pageId: credit.sourcePageId ?? credit.pageId ?? credit.metadataOnlyWork?.sourcePageId
      ?? report?.metadataOnlyWork?.sourcePageId ?? report?.sourcePageId ?? null,
    title: credit.title ?? report?.title ?? null
  };
}

function hasCompletionEvidence(preflightPath, workId, artifactFiles = null) {
  const files = artifactFiles ?? filesUnder(path.dirname(preflightPath));
  for (const filePath of files) {
    const base = path.basename(filePath).toLowerCase();
    if (!/(coverage|catalog-apply-run)/u.test(base)) continue;
    const artifact = readJson(filePath);
    if (!artifact) continue;
    if (base.includes("coverage")) {
      const target = (artifact.targets ?? []).find((entry) => entry.workId === workId);
      if (target && Number(target.creditCount) > 0 && Number(target.linkedCreditCount) === Number(target.creditCount)
        && (target.unlinkedCredits?.length ?? 0) === 0) return true;
    }
    if (base.includes("catalog-apply-run")
      && artifact.status === "completed"
      && artifact.phase === "readback_verified") return true;
  }
  return false;
}

export function discoverPeopleResumeArtifacts(rootDir, { campaign = null } = {}) {
  const root = path.resolve(rootDir);
  const allFiles = filesUnder(root);
  const filesByDirectory = new Map();
  for (const filePath of allFiles) {
    let directory = path.dirname(filePath);
    while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
      const bucket = filesByDirectory.get(directory) ?? [];
      bucket.push(filePath);
      filesByDirectory.set(directory, bucket);
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const campaignByWorkId = new Map((campaign?.works ?? [])
    .filter((work) => work.externalWorkId)
    .map((work) => [work.externalWorkId, work]));
  const campaignByPageId = new Map((campaign?.works ?? [])
    .filter((work) => work.pageId)
    .map((work) => [work.pageId.toLowerCase(), work]));
  const completedWorkIds = new Set((campaign?.works ?? [])
    .filter((work) => ["completed", "skipped"].includes(work.stages?.people?.status))
    .flatMap((work) => [work.externalWorkId, work.ledgerWorkId == null ? null : String(work.ledgerWorkId)])
    .filter(Boolean));
  const completedPageIds = new Set((campaign?.works ?? [])
    .filter((work) => ["completed", "skipped"].includes(work.stages?.people?.status) && work.pageId)
    .map((work) => work.pageId.toLowerCase()));
  const entries = [];
  for (const preflightPath of allFiles.filter((file) => /preflight.*\.json$/iu.test(path.basename(file)))) {
    const preflight = readJson(preflightPath);
    if (!preflight) {
      entries.push({ kind: "artifact_repair", preflightPath, reason: "invalid_preflight" });
      continue;
    }
    const reportPath = preflight.reportPath ? path.resolve(preflight.reportPath) : null;
    const report = reportPath && existsSync(reportPath) ? readJson(reportPath) : null;
    const identity = reportIdentity(report);
    const clean = Boolean(identity.workId) && preflight.status === "ready_for_authorized_apply" && reportPath && report
      && (report.identityIssues?.length ?? 0) === 0 && (report.unresolved?.length ?? 0) === 0;
    const artifactFiles = filesByDirectory.get(path.dirname(preflightPath)) ?? [];
    const alreadyCompleted = (identity.workId && (completedWorkIds.has(String(identity.workId))
      || hasCompletionEvidence(preflightPath, identity.workId, artifactFiles)))
      || (identity.pageId && completedPageIds.has(identity.pageId.toLowerCase()));
    const campaignWork = (identity.workId ? campaignByWorkId.get(identity.workId) : null)
      ?? (identity.pageId ? campaignByPageId.get(identity.pageId.toLowerCase()) : null);
    const notionCheckpointExists = artifactFiles
      .some((filePath) => /notion-upsert-checkpoint\.json$/iu.test(filePath));
    const catalogReplay = !alreadyCompleted && notionCheckpointExists
      && campaignWork?.stages?.people?.status === "deferred"
      && /(catalog|index)/iu.test(campaignWork.stages.people.reason ?? "");
    entries.push({
      preflightPath,
      reportPath,
      status: preflight.status ?? "unknown",
      workId: identity.workId,
      title: identity.title,
      resumable: Boolean(clean && !alreadyCompleted && !catalogReplay),
      catalogReplay,
      kind: !reportPath || !report
        ? "artifact_repair"
        : alreadyCompleted
          ? "already_completed"
          : catalogReplay
            ? "resumable_catalog_replay"
          : clean
            ? "resumable_apply"
            : "needs_human_or_identity_review"
    });
  }
  const latestByWork = new Map();
  const withoutWork = [];
  for (const entry of entries) {
    if (!entry.workId) {
      withoutWork.push(entry);
      continue;
    }
    const previous = latestByWork.get(entry.workId);
    const entryTime = statSafe(entry.preflightPath);
    const previousTime = previous ? statSafe(previous.preflightPath) : -1;
    if (!previous || entryTime > previousTime) latestByWork.set(entry.workId, entry);
  }
  return [...latestByWork.values(), ...withoutWork]
    .sort((left, right) => String(left.preflightPath).localeCompare(String(right.preflightPath)));
}

function statSafe(filePath) {
  try { return statSync(filePath).mtimeMs; } catch { return 0; }
}

export function summarizePeopleResumeArtifacts(entries) {
  return entries.reduce((summary, entry) => {
    summary.total += 1;
    summary[entry.kind] = (summary[entry.kind] ?? 0) + 1;
    return summary;
  }, { total: 0, resumable_apply: 0, resumable_catalog_replay: 0, artifact_repair: 0, needs_human_or_identity_review: 0, already_completed: 0 });
}
