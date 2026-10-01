import assert from "node:assert/strict";
import test from "node:test";
import { childEnvironment, parseArgs, validateRunOptions } from "./with-notion-upload-route.mjs";

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

test("passes the live controller pipe to the wrapped upload process", () => {
  const options = parseArgs([
    "--controller-pipe", "\\\\.\\pipe\\verge-mihomo-production-test",
    "--route", "direct", "--apply", "--", "node", "upload.mjs"
  ]);
  const env = childEnvironment(options, { EXISTING: "preserved" });
  assert.equal(env.CLASH_CONTROLLER_PIPE, "\\\\.\\pipe\\verge-mihomo-production-test");
  assert.equal(env.NOTION_UPLOAD_EXPECTED_ROUTE, "direct");
  assert.equal(env.EXISTING, "preserved");
});

test("rejects an s801 batch without a concrete route reason", () => {
  const options = parseArgs(["--route", "jms-s801", "--apply", "--", "node", "upload.mjs"]);
  assert.throws(() => validateRunOptions(options), /--reason <text> is required/u);
});
