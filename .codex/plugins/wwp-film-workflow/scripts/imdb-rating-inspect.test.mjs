import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { parseImdbPageRating, parseRatingsLine } from "./imdb-rating-inspect.mjs";

const execFileAsync = promisify(execFile);

test("parses an IMDb ratings dataset row", () => {
  assert.deepEqual(parseRatingsLine("tt43592244\t9.1\t84"), {
    tconst: "tt43592244",
    averageRating: 9.1,
    numVotes: 84
  });
});

test("parses aggregateRating from IMDb page JSON-LD", () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@type":"TVSeries","aggregateRating":{"ratingValue":9.1,"ratingCount":95}}
      </script>
    </head></html>`;

  assert.deepEqual(parseImdbPageRating(html), {
    averageRating: 9.1,
    numVotes: 95
  });
});

test("CLI reads a local ratings TSV before any network fallback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-imdb-rating-"));
  try {
    const fixture = path.join(dir, "title.ratings.tsv");
    await writeFile(fixture, "tconst\taverageRating\tnumVotes\n" +
      "tt0000001\t5.7\t2128\n" +
      "tt43592244\t9.1\t84\n", "utf8");

    const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/imdb-rating-inspect.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "tt43592244",
      "--ratings-tsv",
      fixture,
      "--no-page"
    ]);

    assert.deepEqual(JSON.parse(stdout), {
      id: "tt43592244",
      averageRating: 9.1,
      numVotes: 84,
      source: "imdb-datasets"
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
