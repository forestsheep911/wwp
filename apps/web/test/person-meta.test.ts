import assert from "node:assert/strict";
import test from "node:test";

import { formatPersonDate, getPersonExternalLinks } from "../src/cinema/person-meta";

test("person dates preserve source precision and render in simplified Chinese", () => {
  assert.equal(formatPersonDate("1957"), "1957年");
  assert.equal(formatPersonDate("1957-09"), "1957年9月");
  assert.equal(formatPersonDate("1957-09-12"), "1957年9月12日");
  assert.equal(formatPersonDate("1957-02-29"), undefined);
  assert.equal(formatPersonDate("unknown"), undefined);
});

test("external links accept only stable provider ID formats", () => {
  assert.deepEqual(getPersonExternalLinks({ tmdb: "947", imdb: "nm0001877", wikidata: "q76364" }), [
    { label: "TMDB", url: "https://www.themoviedb.org/person/947" },
    { label: "IMDb", url: "https://www.imdb.com/name/nm0001877/" },
    { label: "Wikidata", url: "https://www.wikidata.org/wiki/Q76364" }
  ]);
  assert.deepEqual(getPersonExternalLinks({ tmdb: "../movie/1", imdb: "tt123", wikidata: "person" }), []);
});
