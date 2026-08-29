import fs from "node:fs";
import path from "node:path";

const MIB = 1024 * 1024;
const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_MATERIAL_DELTA_BYTES = 16 * MIB;
const MIN_PROJECTION_SECONDS = 600;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function nextMonthlyReset(now, dayOfMonth) {
  const day = Math.max(1, Math.min(28, Math.trunc(Number(dayOfMonth) || 1)));
  const reset = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0, 0);
  if (reset <= now) reset.setMonth(reset.getMonth() + 1);
  return reset;
}

export function analyzeTrafficSample({ baseline, current, uploadedBytes, totalUploadBytes, elapsedSeconds, now = new Date() }) {
  const limitBytes = finiteNumber(current.monthly_bw_limit_b);
  const usedBytes = finiteNumber(current.bw_counter_b);
  const baselineUsedBytes = finiteNumber(baseline?.bw_counter_b);
  const resetDay = finiteNumber(current.bw_reset_day_of_month);
  if (limitBytes == null || usedBytes == null || baselineUsedBytes == null || resetDay == null) {
    throw new Error("Traffic counter response is missing numeric limit, usage, or reset-day fields.");
  }

  const deltaBytes = Math.max(0, usedBytes - baselineUsedBytes);
  const remainingBytes = Math.max(0, limitBytes - usedBytes);
  const remainingRatio = limitBytes > 0 ? remainingBytes / limitBytes : 0;
  const uploadRatio = uploadedBytes > 0 ? deltaBytes / uploadedBytes : null;
  const estimatedMultiplier = deltaBytes > 0 && uploadedBytes > 0 ? uploadedBytes / deltaBytes : null;
  const materialGrowth = deltaBytes >= MIN_MATERIAL_DELTA_BYTES;
  const resemblesUpload = materialGrowth && uploadRatio >= 0.5 && uploadRatio <= 1.5;
  const resetAt = nextMonthlyReset(now, resetDay);
  const secondsUntilReset = Math.max(1, (resetAt.getTime() - now.getTime()) / 1000);
  const uploadRemainingBytes = Math.max(0, (totalUploadBytes ?? uploadedBytes) - uploadedBytes);
  const projectedAdditionalBytes = totalUploadBytes > 0 && uploadRatio != null
    ? uploadRemainingBytes * uploadRatio
    : elapsedSeconds >= MIN_PROJECTION_SECONDS && deltaBytes > 0
      ? deltaBytes / elapsedSeconds * secondsUntilReset
      : null;
  const projectedExhaustion = projectedAdditionalBytes != null && projectedAdditionalBytes > remainingBytes;
  const uploadBudgetRisk = resemblesUpload && projectedExhaustion;

  return {
    limitBytes,
    usedBytes,
    deltaBytes,
    remainingBytes,
    remainingRatio,
    resetDay,
    resetAt: resetAt.toISOString(),
    materialGrowth,
    resemblesUpload,
    uploadRatio,
    estimatedMultiplier,
    projectedAdditionalBytes,
    projectedExhaustion,
    uploadBudgetRisk,
    severity: projectedExhaustion || uploadBudgetRisk
      ? "budget_risk"
      : resemblesUpload
        ? "upload_correlated_growth"
        : materialGrowth
          ? "unattributed_growth"
          : remainingRatio <= 0.02
            ? "low_remaining"
            : "normal"
  };
}

function endpointDefinitions(envLookup) {
  return [
    { key: "VPN_TRAFFIC_CHECK_URL", label: envLookup("VPN_TRAFFIC_CHECK_LABEL") || "VPN 1 (LA/JMS)" },
    { key: "VPN_TRAFFIC_CHECK_URL_2", label: envLookup("VPN_TRAFFIC_CHECK_LABEL_2") || "VPN 2 (London temporary)" }
  ].map((entry) => ({ ...entry, url: envLookup(entry.key) || "" }))
    .filter((entry) => entry.url);
}

async function fetchCounter(endpoint, fetchImpl) {
  const response = await fetchImpl(endpoint.url, {
    redirect: "follow",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return {
    monthly_bw_limit_b: finiteNumber(payload.monthly_bw_limit_b),
    bw_counter_b: finiteNumber(payload.bw_counter_b),
    bw_reset_day_of_month: finiteNumber(payload.bw_reset_day_of_month)
  };
}

function formatGiB(bytes) {
  return `${(bytes / (1024 ** 3)).toFixed(bytes >= 100 * (1024 ** 3) ? 1 : 2)}GiB`;
}

export function createVpnTrafficMonitor({
  envLookup = (name) => process.env[name],
  fetchImpl = globalThis.fetch,
  reportPath = "",
  logger = console,
  now = () => new Date()
} = {}) {
  const endpoints = endpointDefinitions(envLookup);
  const requestedInterval = finiteNumber(envLookup("VPN_TRAFFIC_CHECK_INTERVAL_SECONDS"));
  const intervalSeconds = Math.max(30, requestedInterval ?? DEFAULT_INTERVAL_SECONDS);
  const expectedRoute = envLookup("NOTION_UPLOAD_EXPECTED_ROUTE") || "unknown";
  const state = {
    enabled: endpoints.length > 0,
    intervalSeconds,
    expectedRoute,
    startedAt: null,
    lastCheckedAt: null,
    uploadedBytes: 0,
    totalUploadBytes: 0,
    baselines: {},
    samples: []
  };

  function persist() {
    if (!reportPath) return;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async function sample(phase, force = false, context = {}) {
    if (!state.enabled) return null;
    const checkedAt = now();
    if (!force && state.lastCheckedAt
      && checkedAt.getTime() - Date.parse(state.lastCheckedAt) < intervalSeconds * 1000) return null;

    const elapsedSeconds = state.startedAt
      ? Math.max(0, (checkedAt.getTime() - Date.parse(state.startedAt)) / 1000)
      : 0;
    const results = [];
    for (const endpoint of endpoints) {
      try {
        const counter = await fetchCounter(endpoint, fetchImpl);
        if (!state.baselines[endpoint.key]) state.baselines[endpoint.key] = counter;
        const analysis = analyzeTrafficSample({
          baseline: state.baselines[endpoint.key],
          current: counter,
          uploadedBytes: state.uploadedBytes,
          totalUploadBytes: state.totalUploadBytes,
          elapsedSeconds,
          now: checkedAt
        });
        results.push({ key: endpoint.key, label: endpoint.label, counter, analysis });
      } catch (error) {
        results.push({ key: endpoint.key, label: endpoint.label, error: error?.message ?? String(error) });
      }
    }

    const record = {
      checkedAt: checkedAt.toISOString(),
      phase,
      uploadedBytes: state.uploadedBytes,
      totalUploadBytes: state.totalUploadBytes,
      context,
      endpoints: results
    };
    state.samples.push(record);
    state.lastCheckedAt = record.checkedAt;
    persist();

    const failed = results.filter((item) => item.error);
    if (failed.length) logger.warn(`vpn traffic check unavailable: ${failed.map((item) => `${item.label}: ${item.error}`).join("; ")}`);
    const risks = results.filter((item) => item.analysis?.severity === "budget_risk");
    const growth = results.filter((item) => ["upload_correlated_growth", "unattributed_growth"].includes(item.analysis?.severity));
    if (risks.length) {
      logger.warn(`vpn traffic budget warning: ${risks.map((item) => `${item.label} +${formatGiB(item.analysis.deltaBytes)}, ${formatGiB(item.analysis.remainingBytes)} remaining before day ${item.analysis.resetDay}`).join("; ")}`);
    } else if (growth.length) {
      const routeNote = expectedRoute === "jms-s801"
        ? "approved jms-s801 batch; compare accepted bytes with the final counter delta to estimate the effective multiplier"
        : expectedRoute === "direct"
          ? "advisory shared-account evidence; exact Clash DIRECT evidence remains authoritative"
          : "advisory shared-account evidence; verify the exact Clash route before attribution";
      logger.warn(`vpn traffic notice: ${growth.map((item) => `${item.label} +${formatGiB(item.analysis.deltaBytes)}`).join("; ")}; ${routeNote}.`);
    } else if (phase !== "baseline") {
      logger.log(`vpn traffic check: no material counter growth after ${formatGiB(state.uploadedBytes)} uploaded`);
    }
    return record;
  }

  return {
    state,
    async start({ totalUploadBytes = 0, ...context } = {}) {
      state.startedAt = now().toISOString();
      state.totalUploadBytes = totalUploadBytes;
      if (!state.enabled) return null;
      const result = await sample("baseline", true, context);
      const baselines = result?.endpoints.filter((item) => item.analysis) ?? [];
      if (baselines.length) logger.log(`vpn traffic baseline: ${baselines.map((item) => `${item.label} ${formatGiB(item.analysis.usedBytes)}/${formatGiB(item.analysis.limitBytes)}, reset day ${item.analysis.resetDay}`).join("; ")}`);
      return result;
    },
    async noteUploaded(bytes, context = {}) {
      state.uploadedBytes += Math.max(0, Number(bytes) || 0);
      return await sample("upload", false, context);
    },
    async finish(context = {}) {
      return await sample("complete", true, context);
    }
  };
}
