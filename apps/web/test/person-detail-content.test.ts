import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(
  new URL("../src/cinema/components/PersonDetail.tsx", import.meta.url),
  "utf8"
);
const directorySource = readFileSync(
  new URL("../src/cinema/components/PeopleDirectory.tsx", import.meta.url),
  "utf8"
);

test("public person pages do not expose ambiguous internal completion labels", () => {
  assert.doesNotMatch(detailSource, /资料补充中|资料已核对/);
  assert.doesNotMatch(directorySource, /资料补充中|资料已核对/);
});

test("person detail presents the WWP collection count once in its section heading", () => {
  assert.doesNotMatch(detailSource, /作品履历/);
  assert.equal(detailSource.match(/>WWP 收录作品</g)?.length, 1);
  assert.match(detailSource, /aria-label="WWP 收录作品"/);
  assert.doesNotMatch(detailSource, /WWP 收录作品 \{person\.workCount\}/);
});

test("person detail is simplified-Chinese-only without biography language headings", () => {
  assert.doesNotMatch(detailSource, /中文小传|English biography|biography\.english|biography\.fallback/);
  assert.match(detailSource, /\{biography\.chinese\}/);
  assert.match(detailSource, /人物小传待核对后补充。/);
});

test("person detail renders only available structured facts and stable source links", () => {
  assert.match(detailSource, /const facts = \[/);
  assert.match(detailSource, /facts\.length > 0 \|\| externalLinks\.length > 0/);
  assert.match(detailSource, /label: "出生"/);
  assert.match(detailSource, /label: "出生地"/);
  assert.match(detailSource, /getPersonExternalLinks\(person\.externalIds\)/);
  assert.doesNotMatch(detailSource, /person\.names\.aliases\.map/);
});
