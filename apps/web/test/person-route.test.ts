import assert from "node:assert/strict";
import test from "node:test";

import { groupPersonWorksByWork, personDepartmentLabel } from "../src/cinema/person-route.js";

test("shows one work once while retaining all of the person's roles", () => {
  const works = groupPersonWorksByWork([
    { workId: "a", title: "A", department: "directing", job: "Director" },
    { workId: "a", title: "A", department: "writing", job: "Writer" },
    { workId: "b", title: "B", department: "acting", character: "母亲" }
  ]);
  assert.equal(works.length, 2);
  assert.deepEqual(works[0], {
    workId: "a",
    title: "A",
    credits: [
      { workId: "a", title: "A", department: "directing", job: "Director" },
      { workId: "a", title: "A", department: "writing", job: "Writer" }
    ],
    roleLabels: ["导演", "编剧"]
  });
  assert.deepEqual(works[1].roleLabels, ["演员 · 母亲"]);
  assert.equal(personDepartmentLabel("acting"), "演员");
});
