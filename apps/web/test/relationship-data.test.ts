import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult, PublicPersonDetail } from "@wwpdw/shared";
import { workRelationships, personRelationships, buildRelationshipNetwork, type RelationshipView } from "../src/cinema/relationship-data";
const work = { assetKey: "asset", title: "电影", metadata: { work: { workId: "w1", credits: [
  { personId: "p1", name: "同名", department: "acting" },
  { personId: "p1", name: "同名", department: "writing" },
  { personId: "p2", name: "同名", department: "acting" },
  { name: "未建档", department: "directing" }
] } } } as SearchResult;
test("merges roles by identity without merging namesakes or inventing person links", () => {
 const view = workRelationships(work);
 assert.equal(view.center.id, "work:w1");
 assert.equal(view.neighbors.length, 3);
 assert.equal(view.neighbors[0].role, "演员 / 编剧");
 assert.equal(view.neighbors[1].personId, "p2");
 assert.equal(view.neighbors[2].personId, undefined);
});

test("two hops merge shared works, preserve both paths and never traverse a third hop", () => {
 const root: RelationshipView = { center: { id: "work:root", label: "中心" }, neighbors: [
  { id: "person:a", label: "甲" }, { id: "person:b", label: "乙" }
 ] };
 const branches: RelationshipView[] = [
  { center: root.neighbors[0], neighbors: [root.center, { id: "work:shared", label: "共同作品", role: "导演" }] },
  { center: root.neighbors[1], neighbors: [{ id: "work:shared", label: "共同作品", role: "演员" }] },
  { center: { id: "work:shared", label: "共同作品" }, neighbors: [{ id: "person:third", label: "第三层" }] }
 ];
 const graph = buildRelationshipNetwork(root, branches, 2, 60);
 assert.equal(graph.nodes.length, 4);
 assert.equal(graph.edges.length, 4);
 assert.deepEqual(graph.nodes.find(node => node.id === "work:shared")?.via, ["甲", "乙"]);
 assert.equal(graph.nodes.find(node => node.id === "work:shared")?.depth, 2);
 assert.equal(graph.nodes.some(node => node.id === "person:third"), false);
 assert.deepEqual(graph.edges.filter(edge => edge.depth === 2).map(edge => edge.role), ["导演", "演员"]);
 const one = buildRelationshipNetwork(root, branches, 1, 60);
 assert.equal(one.nodes.length, 3);
 assert.equal(one.edges.length, 2);
});

test("second-level budget favors shared connections and keeps all their parent edges", () => {
 const root: RelationshipView = { center: { id: "work:root", label: "中心" }, neighbors: [{ id: "person:a", label: "甲" }, { id: "person:b", label: "乙" }] };
 const branches = root.neighbors.map(center => ({ center, neighbors: [
  ...Array.from({ length: 100 }, (_, i) => ({ id: `work:${center.id}-${i}`, label: String(i) })),
  { id: "work:shared", label: "共同作品" }
 ] }));
 const graph = buildRelationshipNetwork(root, branches, 2, 60, 3);
 assert.equal(graph.secondTotal, 201);
 assert.equal(graph.nodes.filter(node => node.depth === 2).length, 3);
 assert.ok(graph.nodes.some(node => node.id === "work:shared"));
 assert.equal(graph.edges.filter(edge => edge.target === "work:shared").length, 2);
 assert.ok(graph.nodes.some(node => node.id === "work:person:a-0"));
 assert.ok(graph.nodes.some(node => node.id === "work:person:b-0"));
 const cappedFirst = buildRelationshipNetwork(root, branches, 2, 1, 3);
 assert.equal(cappedFirst.nodes.some(node => node.id === "person:b"), false);
 assert.equal(cappedFirst.edges.some(edge => edge.source === "person:b"), false);
});

test("unresolved names from different works cannot create a false shared person", () => {
 const other = { ...work, metadata: { work: { ...work.metadata!.work!, workId: "w2" } } } as SearchResult;
 const a = workRelationships(work).neighbors.find(node => !node.personId)!;
 const b = workRelationships(other).neighbors.find(node => !node.personId)!;
 assert.notEqual(a.id, b.id);
});
test("retains unavailable works and consolidates multiple credits for a single work", () => {
 const person = { personId: "p1", names: { primary: "人物" }, works: [
  { workId: "w1", title: "电影", department: "acting" },
  { workId: "w1", title: "电影", department: "writing" },
  { workId: "w2", title: "待补", department: "acting" }
 ] } as PublicPersonDetail;
 const view = personRelationships(person, [work]);
 assert.equal(view.neighbors.length, 2);
 assert.equal(view.neighbors[0].work, work);
 assert.equal(view.neighbors[0].role, "演员 / 编剧");
 assert.equal(view.neighbors[1].label, "待补");
 assert.equal(view.neighbors[1].work, undefined);
});
