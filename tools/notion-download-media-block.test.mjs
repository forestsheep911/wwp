import test from "node:test";
import assert from "node:assert/strict";
import { assertBlockFilename, parseArgs } from "./notion-download-media-block.mjs";

test("parses a bounded download request without enabling transfer by default", () => {
  const args = parseArgs(["--block-id", "28ca3c43-45ff-4f12-9bf2-ecdf742cb70b", "--name", "Saw.2004.720p.h265.chs.cq21.mp4", "--output", ".local-data/saw.mp4", "--workers", "4"]);
  assert.equal(args.apply, undefined);
  assert.equal(args.workers, 4);
});

test("uses the exact hosted URL basename when the Notion block has no name", () => {
  const source = { blockId: "block", name: "", url: "https://files.example/Saw.2004.720p.h265.chs.cq21.mp4?sig=secret" };
  assert.equal(assertBlockFilename(source, "Saw.2004.720p.h265.chs.cq21.mp4").name, "Saw.2004.720p.h265.chs.cq21.mp4");
});

test("rejects filename aliases not proven by the block name or URL", () => {
  assert.throws(() => assertBlockFilename({ name: "other.mp4", url: "https://files.example/other.mp4" }, "Saw.mp4"), /does not match/);
  assert.throws(() => assertBlockFilename({ name: "", url: "https://files.example/random-id" }, "Saw.mp4"), /does not identify/);
});
