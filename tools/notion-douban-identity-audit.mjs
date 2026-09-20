import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import fetch from 'node-fetch';
import { pathToFileURL } from 'node:url';
import { maintainedDoubanSubjectId, parseDoubanSubjectId } from './lib/douban-identity.mjs';

const text = p => (p?.title ?? p?.rich_text ?? []).map(t => t.plain_text ?? t.text?.content ?? '').join('').trim();
export function snapshot(page) {
  const props = page.properties ?? {};
  const links = new Set();
  function walk(value) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/https?:\/\/(?:movie\.|www\.|book\.)?douban\.com\/[^\s<>"']+/g)) links.add(match[0]);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  }
  // No expiring media URLs or unrelated full metadata in the audit artifact.
  for (const p of Object.values(props)) if (['rich_text', 'title', 'url'].includes(p.type)) walk(p);
  return { pageId: page.id, edited: page.last_edited_time,
    title: text(Object.values(props).find(p => p.type === 'title')),
    subjectId: text(props['Douban Subject ID']), subjectUrl: props['Douban URL']?.url ?? '',
    imdbId: text(props['IMDb ID']) || text(props.imdb),
    links: [...links], hidden: props['Hide from Website']?.checkbox ?? false };
}
export function classify(row, indexedId) {
  const peopleIds = row.links.flatMap(url => url.match(/douban\.com\/(?:personage|celebrity)\/(\d+)/)?.[1] ?? []);
  const subjects = [...new Set(row.links.map(parseDoubanSubjectId).filter(Boolean))];
  const id = maintainedDoubanSubjectId(row.subjectId, row.subjectUrl);
  return { ...row, indexedId, subjectCandidates: subjects,
    status: row.subjectId && peopleIds.includes(row.subjectId) ? 'person_id_in_field'
      : row.subjectId && !id ? 'invalid_or_conflicting_fields'
      : id ? 'maintained_unverified' : 'missing_subject_id',
    contaminatedIndex: Boolean(indexedId && peopleIds.includes(indexedId)),
    indexDisagrees: Boolean(indexedId && indexedId !== id) };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('node tools/notion-douban-identity-audit.mjs --scan [--refresh] [--state-dir PATH] [--index JSON]\nRead-only, resumable property scan. Existing completed snapshot is reused unless --refresh is supplied. Refresh preserves the prior snapshot as snapshot.<timestamp>.bak. No block traversal or writes to Notion.'); return; }
  const allowed = new Set(['--scan', '--refresh', '--state-dir', '--index', '--repairs']);
  const valueFlags = new Set(['--state-dir', '--index', '--repairs']);
  for (let i=0;i<args.length;i++) {
    if (!allowed.has(args[i])) throw Error('Unknown argument '+args[i]);
    if (valueFlags.has(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${args[i]} requires a value`);
      i++;
    }
  }
  const get = key => args.includes(key) ? args[args.indexOf(key)+1] : undefined;
  const dir = path.resolve(get('--state-dir') ?? '.local-data/douban-identity-audit');
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'snapshot.json');
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { pages: [], cursor: undefined, complete: false };
  if (args.includes('--refresh') && fs.existsSync(stateFile)) {
    const backupPath = path.join(dir, `snapshot.${new Date().toISOString().replaceAll(':', '-')}.bak`);
    fs.copyFileSync(stateFile, backupPath);
    state = { pages: [], cursor: undefined, complete: false, refreshedFrom: backupPath };
  }
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const ip = process.env.NOTION_API_RESOLVE_IP;
  const agent = ip ? new https.Agent({lookup:(host,options,cb)=>options.all ? cb(null,[{address:ip,family:4}]) : cb(null,ip,4)}) : undefined;
  let last = 0;
  if (args.includes('--scan') && !state.complete) {
    const sourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID;
    if (!sourceId) throw Error('Missing NOTION_LIBRARY_DATA_SOURCE_ID');
    while (!state.complete) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100-(Date.now()-last)))); last=Date.now();
      const response = await fetch(`https://api.notion.com/v1/data_sources/${sourceId}/query`, {agent,method:'POST',
        headers:{authorization:`Bearer ${process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_TOKEN}`, 'Notion-Version':'2025-09-03','content-type':'application/json'},
        body:JSON.stringify({page_size:100,start_cursor:state.cursor}),signal:AbortSignal.timeout(30000)});
      if (!response.ok) {
        state.stopped = { status: response.status, retryAfter: response.headers.get('retry-after'), at:new Date().toISOString() }; save();
        throw Error(`Notion ${response.status}; stopped, resume snapshot after Retry-After=${state.stopped.retryAfter}`);
      }
      const body = await response.json();
      const pages = new Map(state.pages.map(row=>[row.pageId,row]));
      for (const page of body.results) pages.set(page.id,snapshot(page));
      state.pages=[...pages.values()]; state.cursor=body.next_cursor; state.complete=!body.has_more; state.capturedAt=new Date().toISOString(); save();
      console.log(JSON.stringify({pages:state.pages.length,complete:state.complete}));
    }
  }
  const indexFile = get('--index');
  const indexPayload = indexFile ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
  // Local search indexes evolved from a flat array to { entries: { ... } }.
  // Audit identity against either shape without forcing a full index rebuild.
  const index = Array.isArray(indexPayload)
    ? indexPayload
    : Object.values(indexPayload?.entries ?? {});
  const byPage = new Map(index.map(e=>[String(e.sourcePageId??e.result?.sourcePageId??'').replaceAll('-',''),e.result?.metadata?.externalIds?.douban]));
  const repairFile = get('--repairs');
  const repairs = repairFile ? JSON.parse(fs.readFileSync(repairFile,'utf8')).rows.filter(row=>row.status==='applied') : [];
  const repaired = new Map(repairs.map(row=>[row.pageId,row.after]));
  const rows = state.pages.map(saved=>{
    const row = repaired.get(saved.pageId) ?? saved;
    return {...classify(row,byPage.get(row.pageId.replaceAll('-',''))), repaired:repaired.has(saved.pageId)};
  });
  const counts = rows.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{});
  const duplicates = Object.entries(Object.groupBy(rows.filter(r=>r.subjectId),r=>r.subjectId)).filter(([,v])=>v.length>1).map(([id,v])=>({id,pages:v.map(r=>({pageId:r.pageId,title:r.title}))}));
  const report = {capturedAt:state.capturedAt,complete:state.complete,counts,appliedRepairs:repairs.length,contaminatedIndex:rows.filter(r=>r.contaminatedIndex).length,duplicates,rows};
  fs.writeFileSync(path.join(dir,repairFile?'remaining.json':'report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({complete:report.complete,counts,contaminatedIndex:report.contaminatedIndex,duplicateGroups:duplicates.length}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
