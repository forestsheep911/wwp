import assert from "node:assert/strict";
import test from "node:test";

import { migrateAdultTheme } from "./notion-adult-theme-migration.js";

test("adult-theme migration removes the legacy label and keeps concrete reasons", () => {
  assert.deepEqual(migrateAdultTheme(
    ["暴力", "成人主题"],
    "影片含写实枪战和处决，涉及黑帮犯罪、道德抉择等复杂成人主题。"
  ), {
    tags: ["暴力", "犯罪"],
    reason: "影片含写实枪战和处决，涉及黑帮犯罪、道德抉择等议题，需要一定理解能力。"
  });
});

test("adult-theme migration adds bereavement only from explicit evidence", () => {
  assert.deepEqual(migrateAdultTheme(["成人主题"], "影片围绕丧亲后的家庭关系展开。"), {
    tags: ["死亡/丧亲"],
    reason: "影片围绕丧亲后的家庭关系展开。"
  });
  assert.deepEqual(migrateAdultTheme(["成人主题"], "影片探讨代际关系，需要人生阅历。"), {
    tags: [],
    reason: "影片探讨代际关系，需要人生阅历。"
  });
});
