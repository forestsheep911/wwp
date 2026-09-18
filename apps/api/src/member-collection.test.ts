import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalCollectionDocumentStore, CollectionConflict } from "@wwpdw/cache-store";
import { parseDoubanImport } from "@wwpdw/shared";
import type { DoubanRecord, SearchResult } from "@wwpdw/shared";
import { buildCollectionPlan, MemberCollectionService } from "./member-collection.js";

const record = (id = "123", patch: Partial<DoubanRecord> = {}): DoubanRecord => ({subjectId:id,status:"wish",title:"示例电影",originalTitle:"",info:"",rating:null,tags:"",comment:"",markedAt:"2026-09-13",...patch});
const movie = (id: string, key = id): SearchResult => ({assetKey:key,title:"示例电影",source:"notion",sourceUrl:"",durationLabel:"",updatedAt:"",summary:"",metadata:{externalIds:{douban:id},kind:"movie"},variants:[{assetKey:`${key}-video`,sourceUrl:"https://example.com/video.mp4",label:"1080p",kind:"file",summary:""}]});

test("matches canonical playable works, not stale leaf snapshots; refreshes posters without writing marks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wwp-collection-hydrate-"));
  try {
    const store = new LocalCollectionDocumentStore(root);
    const work = movie("123", "work");
    const leaf = { ...movie("123", "leaf"), variants: undefined };
    let catalog = [leaf, work];
    const service = new MemberCollectionService(store, async () => catalog, async result => ({ ...result, metadata: { ...result.metadata, posters: [{ source: "blob", url: "/api/posters/owned.webp", blobName: "posters/owned.webp" }] } }));
    const preview = await service.preview("a", { records: [record()] }, "site");
    assert.equal(preview.rows[0].match, "已匹配");
    const saved = await service.commit("a", preview.id, false);
    assert.equal(saved.entries[0].assetKey, "work");
    assert.equal(saved.entries[0].result.metadata?.posters?.[0].url, "/api/posters/owned.webp");
    catalog = [];
    const missing = await service.get("a");
    assert.deepEqual(missing.entries[0].result.variants, []);
    assert.equal(missing.revision, saved.revision);
    assert.equal(missing.entries[0].wantToWatchAt, saved.entries[0].wantToWatchAt);
    const noId = { ...work, metadata: { kind: "movie" as const } };
    await store.write("collection:b", { entries: [{ ...saved.entries[0], doubanImport: undefined, result: noId }], revision: "one" });
    catalog = [noId];
    assert.equal((await service.get("b")).entries[0].result.variants?.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("three strategies: replace removes absent items, merges preserve and fill missing fields", () => {
  const original = buildCollectionPlan([record("123",{status:"collect",rating:8}),record("456")],[],[],"replace").entries;
  const incoming = [record("123",{comment:"豆瓣短评",rating:6})];
  const site = buildCollectionPlan(incoming, original, [], "site");
  assert.equal(site.entries.length,2);
  assert.ok(site.entries[0].watchedAt);
  assert.equal(site.entries[0].doubanImport?.rating,8);
  assert.equal(site.entries[0].doubanImport?.comment,"豆瓣短评");
  const douban = buildCollectionPlan(incoming, original, [], "douban");
  assert.ok(douban.entries[0].wantToWatchAt);
  assert.equal(douban.entries[0].doubanImport?.rating,6);
  const replace = buildCollectionPlan(incoming, original, [], "replace");
  assert.equal(replace.entries.length,1);
  assert.equal(replace.rows.filter(row=>row.action==="移除").length,1);
});
test("matching scans beyond 200, refuses ambiguous IDs, avoids title guesses, deduplicates", () => {
  const catalog=Array.from({length:700},(_,i)=>movie(String(i+1)));
  const plan=buildCollectionPlan([record("650"),record("650"),record("999")],[],catalog,"site");
  assert.equal(plan.entries[0].assetKey,"650");
  assert.equal(plan.duplicates,1);
  assert.equal(plan.entries[1].assetKey,"douban:999");
  assert.equal(buildCollectionPlan([record()],[],[movie("123","a"),movie("123","b")],"site").rows[0].match,"多个候选");
});
test("missing dates accepted; malformed statuses, dates and ratings rejected",()=>{
  assert.equal(parseDoubanImport({records:[record("123",{markedAt:""})]}).length,1);
  for(const patch of [{status:"other"},{rating:7},{markedAt:"2026-02-31"}]) assert.throws(()=>parseDoubanImport({records:[{...record(),...patch}]}));
});
test("unavailable, hidden and non-video variants never imply a playable match", () => {
  const hidden = movie("123");
  hidden.metadata = { ...hidden.metadata, hideFromWebsite: true };
  assert.equal(buildCollectionPlan([record()], [], [hidden], "site").rows[0].match, "未匹配");
  const work = movie("123");
  work.variants![0].metadata = { hideFromWebsite: true };
  assert.equal(buildCollectionPlan([record()], [], [work], "site").entries[0].result.variants?.length, 0);
});
test("durability, account isolation, stale preview, idempotency, undo, relinking", async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"wwp-collection-"));
  try {
    const store=new LocalCollectionDocumentStore(root);
    let catalog: SearchResult[]=[];
    const service=new MemberCollectionService(store,async()=>catalog);
    const preview=await service.preview("a",{records:[record()]},"site");
    assert.equal((await service.get("a")).entries.length,0);
    await assert.rejects(service.commit("b",preview.id,false),CollectionConflict);
    const saved=await service.commit("a",preview.id,false);
    assert.equal((await service.commit("a",preview.id,false)).revision,saved.revision);
    assert.equal((await new MemberCollectionService(new LocalCollectionDocumentStore(root),async()=>catalog).get("a")).entries.length,1);
    assert.equal((await service.get("b")).entries.length,0);
    catalog=[movie("123")];
    assert.equal((await service.get("a")).entries[0].assetKey,"123");
    const stale=await service.preview("a",{records:[record()]},"replace");
    await assert.rejects(service.commit("a",stale.id,false),/确认/);
    const update=await service.mark("a","123","watched",true,saved.revision);
    await assert.rejects(service.commit("a",stale.id,true),CollectionConflict);
    await assert.rejects(service.undo("a",preview.id,update.revision),CollectionConflict);
    const latest=await service.preview("a",{records:[record("456")]},"replace");
    const replaced=await service.commit("a",latest.id,true);
    assert.equal(replaced.entries.length,1);
    const undone=await service.undo("a",latest.id,replaced.revision);
    assert.ok(undone.entries[0].watchedAt);
    await assert.rejects(service.mark("a","123","watching",true,undone.revision),/电视剧/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("conditional storage permits only one concurrent writer",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"wwp-collection-cas-"));
  try {
    const store=new LocalCollectionDocumentStore(root);
    await store.write("a",{value:0});
    const etag=(await store.read("a"))!.etag;
    const outcomes=await Promise.allSettled([store.write("a",{value:1},etag),store.write("a",{value:2},etag)]);
    assert.equal(outcomes.filter(item=>item.status==="fulfilled").length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
