import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNotionUploadRoute, requireNotionUploadRoute } from "./notion-upload-route-policy.mjs";
import { mergeConnectionSnapshots } from "../notion-upload-route-probe.mjs";

test("merges in-flight Clash samples and keeps the latest byte count", () => {
  const merged = mergeConnectionSnapshots(
    [{ id: "direct-1", chains: ["DIRECT", "国内直连", "Notion"], uploadedBytes: 1024 }],
    [{ id: "direct-1", chains: ["DIRECT", "国内直连", "Notion"], uploadedBytes: 4096 }],
    [{ id: "other", chains: ["DIRECT", "国内直连", "Notion"], uploadedBytes: 2048 }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((entry) => entry.id === "direct-1").uploadedBytes, 4096);
});

test("accepts the exact Notion direct chain", () => {
  const result = evaluateNotionUploadRoute([
    { chains: ["DIRECT", "国内直连", "Notion"] }
  ], "direct");
  assert.equal(result.accepted, true);
});

test("accepts the exact nested JMS Freedom s801 chain", () => {
  const result = evaluateNotionUploadRoute([
    { chains: ["JMS London s801 - Reality", "JMS London 节点", "Notion"] }
  ], "jms-s801");
  assert.equal(result.accepted, true);
});

test("rejects an ordinary paid proxy when s801 was requested", () => {
  assert.throws(() => requireNotionUploadRoute([
    { chains: ["JMS London s1 - SS", "JMS London 节点", "Notion"] }
  ], "jms-s801"), /expected_chain_not_observed/u);
});

test("rejects generic automatic and fallback proxy chains for direct uploads", () => {
  assert.throws(() => requireNotionUploadRoute([
    { chains: ["JMS s4 - Osaka Reality", "JMS 自动", "规则代理", "兜底代理"] }
  ], "direct"), /expected_chain_not_observed/u);
});

test("fails closed when Clash supplies no route evidence", () => {
  assert.throws(() => requireNotionUploadRoute([], "direct"), /no_clash_route_evidence/u);
});

test("rejects mixed chains even when one connection is correct", () => {
  const result = evaluateNotionUploadRoute([
    { chains: ["DIRECT", "国内直连", "Notion"] },
    { chains: ["JMS London s1 - SS", "JMS London 节点", "Notion"] }
  ], "direct");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "mixed_or_unexpected_chain");
});
