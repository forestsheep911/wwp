import assert from "node:assert/strict";
import test from "node:test";

import { auditWebsiteCoverage } from "./film-website-coverage-audit.mjs";

test("coverage audit distinguishes six full variants from a three-item list preview", () => {
  const pageId = "15f20ac1-2f0a-80a1-92ea-f7c8b4702329";
  const variants = Array.from({ length: 6 }, (_, index) => ({ assetKey: `asset-${index + 1}`, label: `规格 ${index + 1}`, metadata: { mediaAssetPageId: `media-${index + 1}` } }));
  const report = auditWebsiteCoverage({ entries: { [`notion-page-${pageId}`]: { title: "理智与情感", result: { title: "理智与情感", variants } } } }, pageId);
  assert.equal(report.fullVariantCount, 6);
  assert.equal(report.previewVariantCount, 3);
  assert.equal(report.previewOnly, true);
  assert.deepEqual(report.variants.map((variant) => variant.assetKey), ["asset-1", "asset-2", "asset-3", "asset-4", "asset-5", "asset-6"]);
});

test("coverage audit fails closed for an unindexed page", () => {
  const report = auditWebsiteCoverage({ entries: {} }, "missing-page");
  assert.equal(report.status, "missing");
  assert.equal(report.fullVariantCount, 0);
});
