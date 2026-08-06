import assert from "node:assert/strict";
import test from "node:test";

import {
  libraryScrollRouteKey,
  libraryScrollTarget
} from "../src/cinema/library-scroll";

test("libraryScrollRouteKey isolates browse presets and search results", () => {
  assert.notEqual(
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "newGood", query: "" }),
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "popular", query: "" })
  );
  assert.notEqual(
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "newGood", query: "" }),
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "newGood", query: "教父" })
  );
  assert.equal(
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "newGood", query: "  教父  " }),
    libraryScrollRouteKey({ browseChannel: "movie", browseView: "newGood", query: "教父" })
  );
});

test("libraryScrollTarget restores the saved position without exceeding the page", () => {
  assert.equal(libraryScrollTarget(2400, 5000, 1000), 2400);
  assert.equal(libraryScrollTarget(4800, 5000, 1000), 4000);
  assert.equal(libraryScrollTarget(-20, 5000, 1000), 0);
});
