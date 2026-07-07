import assert from "node:assert/strict";
import test from "node:test";

import { planUpdates } from "./notion-omdb-enrichment.js";

function richText(value: string) {
  return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] };
}

function available(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, { type: "test" }]));
}

test("planUpdates appends omdb to existing Metadata Source", () => {
  const plan = planUpdates(
    {
      id: "page-1",
      properties: {
        Title: { type: "title", title: [{ plain_text: "牡丹花下 The Beguiled (2017)" }] },
        "IMDb ID": richText("tt5592248"),
        "Metadata Source": { type: "multi_select", multi_select: [{ name: "douban" }] },
        "Box Office": { type: "rich_text", rich_text: [] }
      }
    },
    available(["Metadata Source", "Box Office", "Box Office Amount", "Box Office Currency", "Box Office Source"]),
    { includeNonMovies: false } as never,
    {
      Title: "The Beguiled",
      imdbID: "tt5592248",
      Type: "movie",
      BoxOffice: "$10,709,995",
      Response: "True"
    }
  );

  const source = plan.updates["Metadata Source"] as { multi_select: Array<{ name: string }> };
  assert.deepEqual(source.multi_select.map((item) => item.name), ["douban", "omdb"]);
});

test("planUpdates does not rewrite Metadata Source when omdb already exists", () => {
  const plan = planUpdates(
    {
      id: "page-1",
      properties: {
        Title: { type: "title", title: [{ plain_text: "牡丹花下 The Beguiled (2017)" }] },
        "IMDb ID": richText("tt5592248"),
        "Metadata Source": { type: "multi_select", multi_select: [{ name: "douban" }, { name: "omdb" }] },
        "Box Office": richText("$10,709,995"),
        "Box Office Amount": { type: "number", number: 10709995 },
        "Box Office Currency": richText("USD"),
        "Box Office Source": richText("omdb")
      }
    },
    available(["Metadata Source", "Box Office", "Box Office Amount", "Box Office Currency", "Box Office Source"]),
    { includeNonMovies: false } as never,
    {
      Title: "The Beguiled",
      imdbID: "tt5592248",
      Type: "movie",
      BoxOffice: "$10,709,995",
      Response: "True"
    }
  );

  assert.equal(plan.updates["Metadata Source"], undefined);
});
