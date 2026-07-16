import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CinemaApp shows an authentication restore quiz before the login form", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dialogSource = readFileSync(new URL("../src/cinema/components/ServiceWakeDialog.tsx", import.meta.url), "utf8");
  const renderStart = appSource.indexOf("const serviceWakeDialog = (");
  const restoringGate = appSource.indexOf("if (authRestoring)", renderStart);
  const loginGate = appSource.indexOf("if (!unlocked)", renderStart);

  assert.notEqual(renderStart, -1);
  assert.notEqual(restoringGate, -1);
  assert.notEqual(loginGate, -1);
  assert.ok(restoringGate < loginGate);
  assert.match(appSource, /<ServiceWakeDialog\s+open\s+title=\{copy\.access\.restoringSession\}/);
  assert.match(dialogSource, /title\?: string/);
  assert.match(dialogSource, /\{title \?\? copy\.access\.wake\.title\}/);
});
