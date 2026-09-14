import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("../src/cinema/components/CinemaLayout.tsx");
const library = read("../src/cinema/components/LibraryTab.tsx");
const styles = read("../src/styles.css");

test("touch navigation keeps labelled search and groups secondary destinations", () => {
  assert.match(layout, /aria-label="搜索影片"/);
  assert.match(layout, /aria-label="更多功能"/);
  for (const label of ["浏览与发现", "我的观影", "服务与账户"]) assert.ok(layout.includes(label));
  assert.match(layout, /active=\{activeTab === "profile"\}/);
  assert.match(styles, /@media \(any-pointer: coarse\)[\s\S]*?\[data-desktop-header\]\s*\{\s*display: none/);
});

test("tablet touch controls retain 44px targets and filters start collapsed", () => {
  assert.match(styles, /\[data-ui-button\],[\s\S]*?min-height: 44px;\s*min-width: 44px/);
  assert.match(library, /!window\.matchMedia\("\(any-pointer: coarse\)"\)\.matches/);
});

test("card detail navigation stays a native link and collection actions expose state", () => {
  const card = library.slice(library.indexOf("function MovieCard("), library.indexOf("function SummaryText("));
  assert.match(card, /data-movie-actions/);
  assert.match(card, /<a href=\{getDetailHref\(result\)\} onClick=\{\(event\) => openDetailFromLink\(event, result, onOpenDetail\)\}>\s*查看详情/);
  assert.match(card, /aria-pressed=\{favoriteAssetKeys.has\(result.assetKey\)\}/);
  assert.match(library, /aria-label="管理观影片单"/);
});
