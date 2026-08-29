import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrafficSample, createVpnTrafficMonitor, nextMonthlyReset } from "./vpn-traffic-monitor.mjs";

test("monthly reset advances to the next configured reset day", () => {
  assert.equal(nextMonthlyReset(new Date(2026, 7, 27, 12), 2).getMonth(), 8);
  assert.equal(nextMonthlyReset(new Date(2026, 7, 1, 12), 2).getMonth(), 7);
});

test("traffic growth matching uploaded bytes is advisory upload-correlated evidence", () => {
  const analysis = analyzeTrafficSample({
    baseline: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 100_000_000, bw_reset_day_of_month: 27 },
    current: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 620_000_000, bw_reset_day_of_month: 27 },
    uploadedBytes: 500_000_000,
    totalUploadBytes: 4_000_000_000,
    elapsedSeconds: 300,
    now: new Date(2026, 7, 27, 12)
  });
  assert.equal(analysis.resemblesUpload, true);
  assert.equal(analysis.severity, "upload_correlated_growth");
});

test("sustained traffic growth that projects past the reset budget is a budget risk", () => {
  const analysis = analyzeTrafficSample({
    baseline: { monthly_bw_limit_b: 1_000_000_000, bw_counter_b: 800_000_000, bw_reset_day_of_month: 2 },
    current: { monthly_bw_limit_b: 1_000_000_000, bw_counter_b: 950_000_000, bw_reset_day_of_month: 2 },
    uploadedBytes: 150_000_000,
    totalUploadBytes: 500_000_000,
    elapsedSeconds: 900,
    now: new Date(2026, 7, 27, 12)
  });
  assert.equal(analysis.projectedExhaustion, true);
  assert.equal(analysis.severity, "budget_risk");
});

test("a finite upload projects only the remaining batch instead of growth through reset day", () => {
  const analysis = analyzeTrafficSample({
    baseline: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 10_000_000_000, bw_reset_day_of_month: 27 },
    current: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 10_360_000_000, bw_reset_day_of_month: 27 },
    uploadedBytes: 4_000_000_000,
    totalUploadBytes: 4_000_000_000,
    elapsedSeconds: 900,
    now: new Date(2026, 7, 27, 12)
  });
  assert.equal(analysis.projectedAdditionalBytes, 0);
  assert.equal(analysis.projectedExhaustion, false);
  assert.notEqual(analysis.severity, "budget_risk");
});

test("counter delta records an observed effective multiplier without assuming the provider value", () => {
  const analysis = analyzeTrafficSample({
    baseline: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 100_000_000, bw_reset_day_of_month: 2 },
    current: { monthly_bw_limit_b: 1_000_000_000_000, bw_counter_b: 200_000_000, bw_reset_day_of_month: 2 },
    uploadedBytes: 1_000_000_000,
    totalUploadBytes: 1_000_000_000,
    elapsedSeconds: 300,
    now: new Date(2026, 7, 27, 12)
  });
  assert.equal(analysis.estimatedMultiplier, 10);
  assert.equal(analysis.uploadRatio, 0.1);
});

test("monitor never stores secret traffic-check URLs in its report state", async () => {
  const monitor = createVpnTrafficMonitor({
    envLookup: (name) => name === "VPN_TRAFFIC_CHECK_URL" ? "https://secret.invalid/counter?id=private" : "",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ monthly_bw_limit_b: 1000, bw_counter_b: 10, bw_reset_day_of_month: 2 })
    }),
    logger: { log() {}, warn() {} }
  });
  await monitor.start({ totalUploadBytes: 500 });
  assert.doesNotMatch(JSON.stringify(monitor.state), /secret\.invalid|private/u);
});

test("monitor records the declared route without exposing traffic counter URLs", async () => {
  const monitor = createVpnTrafficMonitor({
    envLookup: (name) => ({
      VPN_TRAFFIC_CHECK_URL: "https://secret.invalid/counter?id=private",
      NOTION_UPLOAD_EXPECTED_ROUTE: "jms-s801"
    })[name] ?? "",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ monthly_bw_limit_b: 1000, bw_counter_b: 10, bw_reset_day_of_month: 2 })
    }),
    logger: { log() {}, warn() {} }
  });
  await monitor.start({ totalUploadBytes: 500 });
  assert.equal(monitor.state.expectedRoute, "jms-s801");
  assert.doesNotMatch(JSON.stringify(monitor.state), /secret\.invalid|private/u);
});
