import assert from "node:assert/strict";
import test from "node:test";
import { routeFromUrl, routeUrl } from "../src/cinema/routing";
import { installPublicIdentities } from "../src/cinema/public-identities";
const root = "https://example.test";
installPublicIdentities([
 {kind:"work",id:"w_abc",key:"notion-page-1",title:"花样年华",path:"/works/花样年华-w_abc",aliases:["old-work"]},
 {kind:"person",id:"p_abc",key:"person-1",title:"梁朝伟",path:"/people/梁朝伟-p_abc",aliases:[]},
 {kind:"video",id:"v_abc",key:"notion-video-1",title:"",path:"/watch/v_abc",aliases:[]}
]);
const parse = (path: string) => routeFromUrl(new URL(path, root));
const serialize = (path: string) => decodeURI(routeUrl(parse(path), root));
test("legacy links canonicalize without origin query leakage", () => {
 assert.equal(serialize("/movie/notion-page-1?q=old"), "/works/花样年华-w_abc");
 assert.equal(serialize("/?detail=old-work"), "/works/花样年华-w_abc");
 assert.equal(serialize("/?person=person-1"), "/people/梁朝伟-p_abc");
 assert.equal(serialize("/?play=notion-video-1"), "/watch/v_abc");
 assert.equal(serialize("/?tab=nowPlaying"), "/now-playing");
});
test("names are decorative and graph centers resolve independently of their title", () => {
 assert.equal(parse("/works/旧名字-w_abc/graph?depth=1").detailAssetKey, "notion-page-1");
 assert.equal(serialize("/works/旧名字-w_abc/graph?depth=1"), "/works/花样年华-w_abc/graph?depth=1");
 assert.equal(parse("/people/梁朝伟-p_abc/graph").personId, "person-1");
});
test("all list/detail destinations round trip", () => {
 for (const path of ["/", "/people?q=Tony", "/search?q=Tony&scope=movie", "/forum/thread-1", "/admin/jobs", "/profile/notices", "/tasks", "/favorites", "/?channel=tv&view=topRated&decade=1990s&seed=42"]) assert.equal(serialize(path), path);
});
test("unknown and malformed addresses do not silently become the library", () => {
 assert.equal(parse("/nonsense").page, "notFound"); assert.equal(parse("/%ZZ").page, "notFound");
});
