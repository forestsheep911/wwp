import assert from "node:assert/strict";
import test from "node:test";

import { releaseFailedBrowseRoute, scheduleBrowseRoute } from "../src/cinema/browse-route-scheduler";

test("admission marks a blank library route only after its start callback accepts", () => {
  const route = {
    tab: "library" as const,
    channel: "recommended" as const,
    view: "newGood" as const,
    query: ""
  };

  assert.deepEqual(scheduleBrowseRoute("", route, () => false), {
    scheduled: false,
    routeKey: ""
  });
  assert.deepEqual(scheduleBrowseRoute("", route, () => true), {
    scheduled: true,
    routeKey: "recommended:newGood"
  });
});

test("a failed initial request releases its admitted route for an automatic retry", () => {
  assert.equal(releaseFailedBrowseRoute("recommended:newGood", "recommended:newGood", false), "");
  assert.equal(releaseFailedBrowseRoute("movie:recent", "recommended:newGood", false), "movie:recent");
  assert.equal(releaseFailedBrowseRoute("recommended:newGood", "recommended:newGood", true), "recommended:newGood");
});
