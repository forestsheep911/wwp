import test from "node:test";
import assert from "node:assert/strict";
import { auditPage } from "./audit-completed-metadata.mjs";

function richText(value) {
  return { type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] };
}

test("completed metadata audit reopens a ledger and Notion media type mismatch", () => {
  const task = {
    task_id: 1,
    work_id: 111,
    work_type: "series",
    canonical_title: "Example Series",
    notion_work_page_id: "page-1"
  };
  const page = {
    properties: {
      Title: { type: "title", title: [{ plain_text: "Example Series" }] },
      "影别": { type: "select", select: { name: "Movie" } },
      "Metadata Status": { type: "select", select: { name: "verified" } },
      "IMDb ID": richText("tt1234567"),
      "Human Issue": richText(""),
      "AI Issue": richText("")
    }
  };
  const result = auditPage(task, page);
  assert.equal(result.mediaTypeMatches, false);
  assert.equal(result.expectedNotionMediaType, "TV Series");
  assert.equal(result.needsRequeue, true);
  assert.match(result.reasons.join(" "), /expected TV Series/);
});
