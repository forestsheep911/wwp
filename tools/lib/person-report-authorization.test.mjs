import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuthorizedPersonPreflight,
  classifyPersonReportAuthorization
} from "./person-report-authorization.mjs";

test("clean person reports can proceed under an explicit people objective", () => {
  const result = classifyPersonReportAuthorization();
  assert.equal(result.status, "ready_for_authorized_apply");
  assert.equal(result.explicitTaskAuthorizationRequired, true);
  assert.equal(result.humanReviewRequired, false);
});

test("unmaterialized legacy credits remain visible without blocking reviewed profiles", () => {
  const unresolved = [{ reason: "credit_identity_not_materialized", creditName: "Example" }];
  const result = classifyPersonReportAuthorization({ unresolved });
  assert.equal(result.status, "ready_for_authorized_apply");
  assert.deepEqual(result.deferredUnresolved, unresolved);
});

test("identity ambiguity still requires a human decision", () => {
  const identityIssues = [{ reason: "external_id_conflict", creditName: "Alex Lee" }];
  const result = classifyPersonReportAuthorization({ identityIssues });
  assert.equal(result.status, "waiting_user");
  assert.equal(result.humanReviewRequired, true);
});

test("report integrity defects remain hard blockers", () => {
  const result = classifyPersonReportAuthorization({
    danglingPersonIds: [{ personId: "person_missing" }]
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.hardBlockerCount, 1);
});

test("authorized apply requires a matching ready preflight artifact", () => {
  assert.equal(assertAuthorizedPersonPreflight({
    status: "ready_for_authorized_apply",
    reportPath: "C:\\batch\\report.json"
  }, "C:\\batch\\report.json"), true);
  assert.throws(() => assertAuthorizedPersonPreflight({
    status: "waiting_user",
    reportPath: "C:\\batch\\report.json"
  }, "C:\\batch\\report.json"), /not ready/);
  assert.throws(() => assertAuthorizedPersonPreflight({
    status: "ready_for_authorized_apply",
    reportPath: "C:\\batch\\other.json"
  }, "C:\\batch\\report.json"), /does not match/);
});
