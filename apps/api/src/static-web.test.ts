import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStaticWebFile } from "./static-web.js";

test("static web resolver serves assets and React browser routes safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wwpdw-static-web-"));
  try {
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "index.html"), "<main>home</main>", "utf8");
    await writeFile(path.join(root, "assets", "index-abc.js"), "console.log('home')", "utf8");

    const index = await resolveStaticWebFile(root, "/");
    const route = await resolveStaticWebFile(root, "/library/recent");
    const asset = await resolveStaticWebFile(root, "/assets/index-abc.js");

    assert.equal(index?.absolutePath, path.join(root, "index.html"));
    assert.equal(route?.absolutePath, path.join(root, "index.html"));
    assert.equal(asset?.absolutePath, path.join(root, "assets", "index-abc.js"));
    assert.equal(index?.cacheControl, "no-cache");
    assert.equal(asset?.cacheControl, "public, max-age=31536000, immutable");
    assert.equal(asset?.contentType, "text/javascript; charset=utf-8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static web resolver rejects traversal and missing file-like paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wwpdw-static-web-"));
  try {
    await writeFile(path.join(root, "index.html"), "<main>home</main>", "utf8");
    assert.equal(await resolveStaticWebFile(root, "/../secret.txt"), undefined);
    assert.equal(await resolveStaticWebFile(root, "/%2e%2e/secret.txt"), undefined);
    assert.equal(await resolveStaticWebFile(root, "/.env"), undefined);
    assert.equal(await resolveStaticWebFile(root, "/assets/missing.js"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
