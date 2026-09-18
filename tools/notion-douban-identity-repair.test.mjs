import assert from 'node:assert/strict';
import test from 'node:test';
import { identityPatch } from './notion-douban-identity-repair.mjs';
import { classify, snapshot } from './notion-douban-identity-audit.mjs';
import { assertDoubanIdentityCompatible, verifyDoubanIdentityReadback } from './notion-metadata-backfill.mjs';
const rich = s => ({type:'rich_text',rich_text:[{plain_text:s,text:{content:s}}]});
const page = {id:'page',properties:{Title:{type:'title',title:[{plain_text:'珀尔 Pearl (2022)'}]},'IMDb ID':rich('tt18925334'),'Douban Subject ID':rich(''),'Douban URL':{type:'url',url:null},'Human Issue':rich('keep me')}};
const evidence = {subjectId:'35801819',subjectUrl:'https://movie.douban.com/subject/35801819/',imdbId:'tt18925334',releaseYear:2022,doubanDisplayTitle:'珀尔 Pearl'};
test('repair writes identity pair only and guards stale plans, mismatches and scope',()=>{
  const before=snapshot(page);
  assert.deepEqual(Object.keys(identityPatch(page,before,evidence)),['Douban Subject ID','Douban URL']);
  assert.throws(()=>identityPatch(page,{...before,subjectId:'27233188'},evidence),/Stale/);
  assert.throws(()=>identityPatch(page,before,{...evidence,imdbId:'tt0000000'}),/IMDb/);
  assert.throws(()=>identityPatch(page,before,{...evidence,releaseYear:2023}),/Year/);
  assert.throws(()=>identityPatch(page,before,{...evidence,subjectUrl:'https://www.douban.com/personage/35801819/'}),/evidence/);
});
test('audit distinguishes missing IDs, people contamination and URL conflicts',()=>{
  const row={...snapshot(page),links:['https://www.douban.com/personage/27233188/']};
  assert.equal(classify(row,'27233188').contaminatedIndex,true);
  assert.equal(classify({...row,subjectId:'27233188'}).status,'person_id_in_field');
  assert.equal(classify({...row,subjectId:'35801819',subjectUrl:'https://movie.douban.com/subject/1234567/'}).status,'invalid_or_conflicting_fields');
});
test('normal Meta backfill refuses identity conflicts and validates persisted pair',()=>{
  assert.throws(()=>assertDoubanIdentityCompatible({'Douban Subject ID':rich('27233188')},evidence),/conflict/);
  assert.throws(()=>verifyDoubanIdentityReadback(page.properties,evidence),/readback/);
  const properties={...page.properties,'Douban Subject ID':rich('35801819'),'Douban URL':{type:'url',url:evidence.subjectUrl}};
  assert.equal(verifyDoubanIdentityReadback(properties,evidence).status,'verified');
  assert.equal(verifyDoubanIdentityReadback(properties,{}).status,'pending');
});
