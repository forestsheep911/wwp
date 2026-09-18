import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import fetch from 'node-fetch';
import { pathToFileURL } from 'node:url';
import { fetchDoubanMetadata, findDoubanSubject } from './notion-metadata-backfill.mjs';
import { parseDoubanSubjectId } from './lib/douban-identity.mjs';
import { snapshot } from './notion-douban-identity-audit.mjs';

export function identityPatch(page, candidate, evidence) {
  const row = snapshot(page);
  if (row.pageId.replaceAll('-','') !== candidate.pageId.replaceAll('-','') || row.title !== candidate.title) throw Error('Page identity changed');
  if (row.subjectId !== candidate.subjectId || row.subjectUrl !== candidate.subjectUrl || row.imdbId !== candidate.imdbId) throw Error('Stale identity plan');
  const legacy = (page.properties?.imdb?.rich_text ?? []).map(t=>t.plain_text??t.text?.content??'').join('').trim();
  if (legacy && legacy !== row.imdbId) throw Error('Conflicting existing IMDb fields');
  if (!/^tt\d+$/.test(row.imdbId) || evidence.imdbId !== row.imdbId) throw Error('Unverified IMDb identity');
  if (/第.+季|Season\s*\d|旧媒体|旧版|失效/i.test(row.title) || /series|TV|电视|剧集/i.test(JSON.stringify(page.properties?.['影别']??''))) throw Error('Series or legacy scope requires explicit review');
  const year = row.title.match(/\((\d{4})\)\s*$/)?.[1];
  if (!year || Number(year) !== Number(evidence.releaseYear)) throw Error('Year conflict or missing year');
  const id = parseDoubanSubjectId(evidence.subjectId);
  if (!id || parseDoubanSubjectId(evidence.subjectUrl) !== id || !evidence.doubanDisplayTitle) throw Error('Missing verified subject evidence');
  if (!page.properties['Douban Subject ID'] || !page.properties['Douban URL']) throw Error('Identity schema missing');
  return { 'Douban Subject ID': { rich_text: [{type:'text',text:{content:id}}] }, 'Douban URL': { url:evidence.subjectUrl } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('node tools/notion-douban-identity-repair.mjs --manifest JSON --plan JSON [--apply]\nManifest: {pages:[{pageId,title,subjectId,subjectUrl,imdbId,candidateSubjectId?}]}, maximum 5. Dry-run fetches verified Douban evidence; apply reuses that plan, checks old values, writes only ID/URL, reads back.'); return; }
  const get = key => args[args.indexOf(key)+1];
  for(let i=0;i<args.length;i++){if(args[i]==='--apply')continue;if(['--manifest','--plan'].includes(args[i]))i++;else throw Error('Unknown flag '+args[i]);}
  if (!args.includes('--manifest') || !args.includes('--plan')) throw Error('manifest and plan required');
  const apply = args.includes('--apply');
  const pages = JSON.parse(fs.readFileSync(get('--manifest'),'utf8')).pages;
  if (!Array.isArray(pages) || !pages.length || pages.length>5) throw Error('Use a bounded batch of 1-5 pages');
  const planPath = path.resolve(get('--plan'));
  const report = fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath,'utf8')) : {rows:[]};
  const save = () => { fs.mkdirSync(path.dirname(planPath),{recursive:true}); fs.writeFileSync(planPath,JSON.stringify(report,null,2)); };
  const ip = process.env.NOTION_API_RESOLVE_IP;
  const agent = ip ? new https.Agent({lookup:(h,o,cb)=>o.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4)}) : undefined;
  let last = 0;
  async function notion(url, method='GET', body) {
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-last)))); last=Date.now();
    const response=await fetch('https://api.notion.com/v1/'+url,{agent,method,headers:{authorization:`Bearer ${apply?(process.env.NOTION_WRITE_TOKEN||process.env.NOTION_TOKEN):(process.env.NOTION_READ_ONLY_TOKEN||process.env.NOTION_TOKEN)}`,'Notion-Version':'2025-09-03','content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw Error(`Notion ${response.status}; stop batch. Retry-After=${response.headers.get('retry-after')}`);
    return response.json();
  }
  const cookie=fs.existsSync('.douban.cookie')?fs.readFileSync('.douban.cookie','utf8').trim():'';
  for (const candidate of pages) {
    let row=report.rows.find(r=>r.pageId===candidate.pageId);
    if (row?.status==='applied') {console.log(JSON.stringify({pageId:candidate.pageId,status:'already_applied'}));continue;}
    const page=await notion('pages/'+candidate.pageId);
    try {
      if (!apply) {
        let id=candidate.candidateSubjectId;
        if (!id) { const found=await findDoubanSubject(candidate.title,'','Movie',cookie); if(found.status!=='ok')throw Error(found.reason);id=found.subject.id; }
        const metadata=await fetchDoubanMetadata(id,cookie,candidate.title);
        const evidence=Object.fromEntries(['subjectId','subjectUrl','imdbId','releaseYear','doubanDisplayTitle'].map(k=>[k,metadata[k]]));
        const patch=identityPatch(page,candidate,evidence);
        row={pageId:candidate.pageId,title:candidate.title,before:candidate,evidence,patch,verifiedAt:new Date().toISOString(),status:'planned'};
        report.rows=report.rows.filter(r=>r.pageId!==candidate.pageId);report.rows.push(row);save();
      } else {
        if (!row || !['planned','write_pending'].includes(row.status)) throw Error('No verified plan');
        const current=snapshot(page);
        // Interrupted writes are reconciled before retrying, never duplicated.
        const already=current.subjectId===row.evidence.subjectId&&current.subjectUrl===row.evidence.subjectUrl;
        if (!already) {
          const patch=identityPatch(page,row.before,row.evidence);
          row.status='write_pending';save();
          await notion('pages/'+candidate.pageId,'PATCH',{properties:patch});
        } else identityPatch(page,{...row.before,subjectId:current.subjectId,subjectUrl:current.subjectUrl},row.evidence);
        const back=snapshot(await notion('pages/'+candidate.pageId));
        if(back.subjectId!==row.evidence.subjectId||back.subjectUrl!==row.evidence.subjectUrl)throw Error('Readback mismatch');
        row.after=back;row.status='applied';row.appliedAt=new Date().toISOString();save();
      }
      console.log(JSON.stringify({title:row.title,status:row.status,subjectId:row.evidence.subjectId}));
    } catch(error) {report.lastError={pageId:candidate.pageId,message:error.message,at:new Date().toISOString()};save();throw error;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
