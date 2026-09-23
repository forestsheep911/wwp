import assert from "node:assert/strict";
import test from "node:test";
import { commitNavigation, backTo } from "../src/cinema/navigation";
import { routeFromUrl } from "../src/cinema/routing";
import { installPublicIdentities } from "../src/cinema/public-identities";
test("detail URL is independent of search, return uses browser history", () => {
  const events = new EventTarget(); let backs = 0;
  const location = { href: "https://test/?channel=tv", pathname: "/", search: "?channel=tv" };
  const history = { state: { entryKey: "source" }, back: () => backs++, pushState(state: any, _: string, url: string) { this.state = state; const next = new URL(url, location.href); Object.assign(location, { href: next.href, pathname: next.pathname, search: next.search }); }, replaceState(state: any, _: string, url: string) { this.pushState(state, _, url); } };
  Object.assign(globalThis, { document: { querySelectorAll: () => [] }, window: { location, history, scrollY: 550, dispatchEvent: (event: Event) => events.dispatchEvent(event) } });
  installPublicIdentities([{kind:"work",id:"w_test",key:"notion-page-a",title:"作品",path:"/works/title-w_test",aliases:[]}]);
  const base = routeFromUrl(new URL(location.href));
  commitNavigation({ ...base, detailAssetKey:"notion-page-a", query:"来源搜索" }, "push");
  assert.equal(location.pathname, "/works/title-w_test"); assert.equal(location.search, "");
  assert.equal((history.state as any).from, "/?channel=tv");
  backTo(base); assert.equal(backs, 1);
});
