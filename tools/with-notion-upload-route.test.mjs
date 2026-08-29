import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, validateRunOptions } from "./with-notion-upload-route.mjs";

test("parses a recorded reason for a temporary s801 batch", () => {
  const options = parseArgs([
    "--route", "jms-s801",
    "--reason", "protect the normal allowance for an 80GB batch",
    "--apply",
    "--",
    "node", "upload.mjs"
  ]);
  assert.equal(options.route, "jms-s801");
  assert.equal(options.reason, "protect the normal allowance for an 80GB batch");
  assert.deepEqual(options.command, ["node", "upload.mjs"]);
  assert.doesNotThrow(() => validateRunOptions(options));
});

test("direct batches do not require a route reason", () => {
  const options = parseArgs(["--route", "direct", "--apply", "--", "node", "upload.mjs"]);
  assert.equal(options.reason, undefined);
  assert.doesNotThrow(() => validateRunOptions(options));
});

test("rejects an s801 batch without a concrete route reason", () => {
  const options = parseArgs(["--route", "jms-s801", "--apply", "--", "node", "upload.mjs"]);
  assert.throws(() => validateRunOptions(options), /--reason <text> is required/u);
});
