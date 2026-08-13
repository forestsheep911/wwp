import assert from "node:assert/strict";
import test from "node:test";

import { findImdbNames, imdbNameEvidence, parseImdbNameBasicsRow } from "./imdb.js";

test("parses IMDb name.basics rows without treating missing values as data", () => {
  assert.deepEqual(
    parseImdbNameBasicsRow("nm0000093\tBrad Pitt\t1963\t\\N\tactor,producer\ttt0137523,tt0114746"),
    {
      imdbId: "nm0000093",
      primaryName: "Brad Pitt",
      birthYear: "1963",
      deathYear: undefined,
      primaryProfessions: ["actor", "producer"],
      knownForTitleIds: ["tt0137523", "tt0114746"]
    }
  );
  assert.equal(parseImdbNameBasicsRow("nconst\tBad\t\\N\t\\N\t\\N\t\\N"), undefined);
});

test("streams only requested IMDb people and reports missing ids", async () => {
  async function* lines() {
    yield "nconst\tprimaryName\tbirthYear\tdeathYear\tprimaryProfession\tknownForTitles";
    yield "nm0000001\tFred Astaire\t1899\t1987\tactor\ttt0000001";
    yield "nm0000093\tBrad Pitt\t1963\t\\N\tactor\ttt0137523";
  }
  const result = await findImdbNames(lines(), ["NM0000093", "nm9999999"]);
  assert.deepEqual([...result.found.keys()], ["nm0000093"]);
  assert.deepEqual(result.missing, ["nm9999999"]);
});

test("turns an IMDb row into source-labelled evidence", () => {
  const row = parseImdbNameBasicsRow("nm0000093\tBrad Pitt\t1963\t\\N\tactor\ttt0137523")!;
  const evidence = imdbNameEvidence(row, "2026-08-10T00:00:00.000Z");
  assert.equal(evidence.names[0].value, "Brad Pitt");
  assert.equal(evidence.biography?.birthDate, "1963");
  assert.equal(evidence.sourceRefs[0].source, "imdb");
});
