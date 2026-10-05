import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectNotionRouteTopology, resolveControllerConnection, resolveControllerPipe, withTemporaryNotionRoute } from "./clash-notion-route.mjs";

test("discovers the unique production core when generated sidecar pipe is stale", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clash-controller-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "clash-verge.yaml");
  fs.writeFileSync(configPath, "external-controller-pipe: \\\\.\\pipe\\verge-mihomo-sidecar-release-test\nsecret: test-runtime-secret\n");
  const env = { CLASH_CONTROLLER_CONFIG: configPath };
  const connection = resolveControllerConnection({ pipeNames: ["clash-verge-service", "verge-mihomo-production-test"] }, env);
  assert.equal(connection.socketPath, "\\\\.\\pipe\\verge-mihomo-production-test");
  assert.equal(connection.secret, "test-runtime-secret");
  assert.throws(() => resolveControllerConnection({ pipeNames: ["verge-mihomo-one", "verge-mihomo-two"] }, env), /discovered 2/u);
  assert.throws(() => resolveControllerConnection({ pipeNames: [] }, env), /discovered 0/u);
  const configured = resolveControllerConnection({ pipeNames: ["verge-mihomo-sidecar-release-test", "verge-mihomo-production-test"] }, env);
  assert.equal(configured.socketPath, "\\\\.\\pipe\\verge-mihomo-sidecar-release-test");
  fs.writeFileSync(configPath, "secret: [test-runtime-secret\n");
  assert.throws(() => resolveControllerConnection({}, env), (error) => {
    assert.match(error.message, /configuration contents are withheld/u);
    assert.doesNotMatch(error.message, /test-runtime-secret/u);
    return true;
  });
});

test("an explicit pipe is honored without falling through to another running core", () => {
  const connection = resolveControllerConnection({ socketPath: "explicit-pipe", pipeNames: ["verge-mihomo-other"] }, {
    CLASH_CONTROLLER_URL: "http://127.0.0.1:9097", CLASH_CONTROLLER_SECRET: "runtime-only"
  });
  assert.equal(connection.socketPath, "explicit-pipe");
  assert.equal(connection.controllerUrl, undefined);
  assert.equal(connection.secret, "runtime-only");
});

function fakeController({ s801 = ["JMS London s801 - Reality"], omitJms = false } = {}) {
  const state = { Notion: "国内直连", "JMS London 节点": "JMS London s1 - SS" };
  const calls = [];
  return {
    state,
    calls,
    async proxies() {
      return {
        Notion: { type: "Selector", now: state.Notion, all: ["国内直连", "JMS London 节点"] },
        ...(!omitJms ? {
          "JMS London 节点": { type: "Selector", now: state["JMS London 节点"], all: ["JMS London s1 - SS", ...s801] }
        } : {})
      };
    },
    async select(group, member) { calls.push([group, member]); state[group] = member; }
  };
}

test("discovers one configured s801 member without a dedicated route group", async () => {
  const topology = inspectNotionRouteTopology(await fakeController().proxies());
  assert.equal(topology.s801Member, "JMS London s801 - Reality");
  assert.equal(topology.selectors.Notion, "国内直连");
});

test("uses an injected active controller pipe before the stale default", () => {
  assert.equal(resolveControllerPipe({}, { CLASH_CONTROLLER_PIPE: "\\\\.\\pipe\\verge-mihomo-production-test" }), "\\\\.\\pipe\\verge-mihomo-production-test");
  assert.equal(resolveControllerPipe({ socketPath: "explicit-pipe" }, { CLASH_CONTROLLER_PIPE: "environment-pipe" }), "explicit-pipe");
});

test("selects the nested s801 chain and restores both selectors", async () => {
  const controller = fakeController();
  await withTemporaryNotionRoute(controller, "jms-s801", async () => {
    assert.equal(controller.state.Notion, "JMS London 节点");
    assert.equal(controller.state["JMS London 节点"], "JMS London s801 - Reality");
  });
  assert.deepEqual(controller.state, { Notion: "国内直连", "JMS London 节点": "JMS London s1 - SS" });
  assert.deepEqual(controller.calls, [
    ["JMS London 节点", "JMS London s801 - Reality"],
    ["Notion", "JMS London 节点"],
    ["Notion", "国内直连"],
    ["JMS London 节点", "JMS London s1 - SS"]
  ]);
});

test("restores selectors after the wrapped upload command fails", async () => {
  const controller = fakeController();
  await assert.rejects(withTemporaryNotionRoute(controller, "jms-s801", async () => {
    throw new Error("upload failed");
  }), /upload failed/u);
  assert.equal(controller.state.Notion, "国内直连");
  assert.equal(controller.state["JMS London 节点"], "JMS London s1 - SS");
});

test("a direct wrapper does not rewrite the unrelated JMS selector", async () => {
  const controller = fakeController();
  await withTemporaryNotionRoute(controller, "direct", async () => {});
  assert.deepEqual(controller.calls, []);
});

test("fails before mutation when s801 is missing or ambiguous", async () => {
  for (const members of [[], ["s801 a", "s801 b"]]) {
    const controller = fakeController({ s801: members });
    await assert.rejects(withTemporaryNotionRoute(controller, "jms-s801", async () => {}), /exactly one s801 member/u);
    assert.equal(controller.calls.length, 0);
  }
});

test("direct routing remains available when s801 is absent", async () => {
  const controller = fakeController({ s801: [] });
  const topology = inspectNotionRouteTopology(await controller.proxies());
  assert.equal(topology.s801Member, null);
  assert.equal(topology.s801CandidateCount, 0);
  await withTemporaryNotionRoute(controller, "direct", async () => {});
  assert.equal(controller.state.Notion, "国内直连");
});

test("direct routing remains available when the optional JMS selector is absent", async () => {
  const controller = fakeController({ omitJms: true });
  const topology = inspectNotionRouteTopology(await controller.proxies());
  assert.equal(topology.s801Member, null);
  assert.deepEqual(topology.selectors, { Notion: "国内直连" });
  await withTemporaryNotionRoute(controller, "direct", async () => {});
  assert.equal(controller.state.Notion, "国内直连");
});
