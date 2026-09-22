import assert from "node:assert/strict";
import test from "node:test";
import type { PublicPersonDetail, SearchResult } from "@wwpdw/shared";
import { createRelationshipLoader } from "../src/cinema/relationship-loader";

const profile = (id: string) => ({ personId: id, names: { primary: id }, works: [
 { workId: "w1", title: "作品一", department: "acting" },
 { workId: "w2", title: "作品二", department: "acting" }
] } as PublicPersonDetail);
const work = (id: string) => ({ assetKey: id, title: id, metadata: { work: { workId: id, credits: [] } } } as unknown as SearchResult);

test("person navigation renders its credit index without waiting for asset pagination", async () => {
 let reads = 0;
 const loader = createRelationshipLoader({
  person: async id => { reads++; return profile(id); },
  works: async () => { throw new Error("Person navigation must not browse assets"); }
 }, 0);
 const node = { id: "person:p", label: "p", personId: "p" };
 const view = await loader.resolve(node, () => true);
 assert.equal(view.neighbors.length, 2);
 await loader.resolve(node, () => true);
 assert.equal(reads, 1);
});

test("navigation aborts a slow background request and releases the shared queue", async () => {
 let started!: () => void;
 const ready = new Promise<void>(resolve => { started = resolve; });
 let aborted = false;
 const loader = createRelationshipLoader({
  person: async (id, signal) => {
   if (id !== "slow") return profile(id);
   started();
   return new Promise((_, reject) => signal.addEventListener("abort", () => {
    aborted = true; reject(signal.reason);
   }, { once: true }));
  },
  works: async () => ({ results: [] })
 }, 0);
 const pending = loader.resolve({ id: "person:slow", label: "slow", personId: "slow" }, () => true, true);
 const canceled = assert.rejects(pending, /加载已取消/);
 await ready;
 loader.cancelPending();
 const next = await loader.resolve({ id: "person:next", label: "next", personId: "next" }, () => true);
 await canceled;
 assert.equal(aborted, true);
 assert.equal(next.center.id, "person:next");
});

test("branch expansion reads only credits; selecting a work hydrates exact identity and reuses cached pages", async () => {
 const calls: string[] = [];
 const loader = createRelationshipLoader({
  person: async id => { calls.push(`person:${id}`); return profile(id); },
  works: async (id, offset) => { calls.push(`works:${id}:${offset}`); return { results: [work(offset === 0 ? "w1" : "w2")], nextOffset: offset === 0 ? 100 : undefined }; }
 }, 0);
 const node = { id: "person:p", label: "p", personId: "p" };
 const branch = await loader.resolve(node, () => true, true);
 assert.deepEqual(calls, ["person:p"]);
 assert.equal(branch.neighbors[1].sourcePersonId, "p");
 const selected = await loader.resolve(branch.neighbors[1], () => true);
 assert.equal(selected.center.id, "work:w2");
 assert.deepEqual(calls, ["person:p", "works:p:0", "works:p:100"]);
 await loader.resolve(node, () => true);
 await loader.resolve(branch.neighbors[1], () => true);
 assert.equal(calls.length, 3);
});

test("shared read queue serializes expansion with navigation and skips canceled jobs", async () => {
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let active = 0, maxActive = 0, count = 0;
 const loader = createRelationshipLoader({
  person: async id => { count++; active++; maxActive = Math.max(maxActive, active); await gate; active--; return profile(id); },
  works: async () => ({ results: [] })
 }, 0);
 const first = loader.resolve({ id: "person:p", label: "p", personId: "p" }, () => true, true);
 let current = true;
 const second = loader.resolve({ id: "person:q", label: "q", personId: "q" }, () => current, true);
 const canceled = assert.rejects(second, /加载已取消/);
 current = false;
 release();
 await Promise.all([first, canceled]);
 assert.equal(maxActive, 1);
 assert.equal(count, 1);
});

test("429 stops subsequent reads during provider cooldown without a retry storm", async () => {
 let count = 0;
 const loader = createRelationshipLoader({
  person: async () => { count++; throw Object.assign(new Error("rate limited"), { statusCode: 429, retryAfterMs: 120000 }); },
  works: async () => ({ results: [] })
 }, 0);
 await assert.rejects(loader.resolve({ id: "person:p", label: "p", personId: "p" }, () => true, true), /rate limited/);
 await assert.rejects(loader.resolve({ id: "person:q", label: "q", personId: "q" }, () => true, true), /稍后重试/);
 assert.equal(count, 1);
});
