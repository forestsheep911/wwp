import test from "node:test";
import assert from "node:assert/strict";
import { createNotionUploadSelectorGuard } from "./notion-upload-selector-guard.mjs";

function controller(state = { Notion: "国内直连", "JMS London 节点": "JMS London s1 - SS" }) {
  return {
    state,
    async proxies() {
      return {
        Notion: { type: "Selector", now: state.Notion, all: ["国内直连", "JMS London 节点"] },
        "JMS London 节点": {
          type: "Selector",
          now: state["JMS London 节点"],
          all: ["JMS London s1 - SS", "JMS London s801 - Reality"]
        }
      };
    }
  };
}

test("is inert unless the guarded wrapper declares an expected route", async () => {
  const guard = createNotionUploadSelectorGuard({ envLookup: () => "", controller: controller() });
  assert.deepEqual(await guard.assert("part 1"), { enabled: false, label: "part 1" });
});

test("accepts direct only while the Notion selector remains direct", async () => {
  const fake = controller();
  const guard = createNotionUploadSelectorGuard({ envLookup: () => "direct", controller: fake });
  assert.deepEqual((await guard.assert()).chain, ["Notion", "国内直连"]);
  fake.state.Notion = "JMS London 节点";
  await assert.rejects(guard.assert("part 2"), /route selector changed/u);
});

test("accepts only the uniquely selected nested s801 route", async () => {
  const fake = controller({ Notion: "JMS London 节点", "JMS London 节点": "JMS London s801 - Reality" });
  const guard = createNotionUploadSelectorGuard({ envLookup: () => "jms-s801", controller: fake });
  assert.deepEqual((await guard.assert()).chain, ["Notion", "JMS London 节点", "JMS London s801 - Reality"]);
  fake.state["JMS London 节点"] = "JMS London s1 - SS";
  await assert.rejects(guard.assert("part 3"), /route selector changed/u);
});

test("rejects unknown wrapper route declarations", () => {
  assert.throws(
    () => createNotionUploadSelectorGuard({ envLookup: () => "automatic", controller: controller() }),
    /Unsupported NOTION_UPLOAD_EXPECTED_ROUTE/u
  );
});
