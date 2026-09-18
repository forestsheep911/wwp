import { useState, useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { previewMemberCollection, commitMemberCollection, undoMemberCollection } from "../../api";
import type { CollectionPreview, CollectionResponse, ImportStrategy } from "@wwpdw/shared";
const labels = {wantToWatch:"想看", watching:"在看", watched:"已看"};
const strategies = {replace:"完全替换为豆瓣", douban:"融合，豆瓣优先", site:"融合，本站优先"};
export function DoubanImportPanel({collection, onImport, legacyRecords, disabled}: {collection:CollectionResponse; onImport:(value:CollectionResponse)=>void; legacyRecords:unknown[]; disabled:boolean}) {
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const [data,setData]=useState<unknown>();
  const [strategy,setStrategy]=useState<ImportStrategy>("site");
  const [preview,setPreview]=useState<CollectionPreview>();
  const [confirmed,setConfirmed]=useState(false);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [page,setPage]=useState(0);
  async function prepare() {
    setBusy(true);setMessage("");setPreview(undefined);setConfirmed(false);setPage(0);
    try {setPreview(await previewMemberCollection(data,strategy));} catch(e){setMessage(e instanceof Error ? e.message : "预览失败，请重试。");} finally {setBusy(false);}
  }
  return <section className="grid min-w-0 gap-3 rounded-xl border border-slate-800 p-4 [&_input]:max-w-full [&_select]:max-w-full [&_button]:whitespace-normal">
    <h2 className="font-semibold">导入豆瓣片单</h2>
    <p className="text-sm text-slate-400">上传纳豆 JSON 到本站，按豆瓣条目 ID 与完整片库索引匹配。确认后保存到当前账号，其他设备登录后也能读取。未匹配影片仍会保留。</p>
    <input disabled={disabled || busy} aria-label="选择豆瓣导出 JSON" type="file" accept=".json,application/json" onChange={async event=>{
      const file=event.target.files?.[0];event.target.value="";setData(undefined);setPreview(undefined);setMessage("");setBusy(true);
      try {if(file){if(file.size>20*1024*1024) throw new Error("文件不能超过 20 MB。");setData(JSON.parse((await file.text()).replace(/^\uFEFF/,"")));setMessage(`已选择：${file.name}。请选择策略并生成预览。`);}} catch{setMessage("无法读取文件，请选择不超过 20 MB 的有效 JSON。");} finally{setBusy(false);}
    }}/>
    {legacyRecords.length>0 && <Button variant="outline" disabled={disabled || busy} onClick={()=>{setData({records:legacyRecords});setPreview(undefined);setStrategy("site");setMessage("已选择本浏览器旧版豆瓣记录，生成预览后可保存到账号。原始浏览器备份不会删除。");}}>迁移本浏览器旧版豆瓣记录（{legacyRecords.length} 条）</Button>}
    <label>冲突处理 <select aria-label="冲突处理" className="rounded border border-slate-700 bg-slate-950 p-2" disabled={busy} value={strategy} onChange={e=>{setStrategy(e.target.value as ImportStrategy);setPreview(undefined);setConfirmed(false);}}>{Object.entries(strategies).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <p className="text-sm text-slate-400">{strategy==="replace" ? "完整替换个人片单：文件中没有的现有记录将移除。日期筛选导出可能不完整，请核对移除清单。" : "保留双方独有影片；同一影片的状态按优先方选择，评分、短评和标签在优先方为空时由另一方补充。"}</p>
    <Button disabled={!data || busy || disabled} onClick={()=>void prepare()}>{busy ? "处理中…" : "上传并生成全库匹配预览"}</Button>
    {preview && <>
      <p>全库索引 {preview.catalogCount} 部 · 导入后 {preview.total} 条 · 文件内重复 {preview.duplicates} 条</p>
      <p>{["新增","修改","保留","移除"].map(action=>`${action} ${preview.rows.filter(row=>row.action===action).length}`).join(" · ")}</p>
      {preview.dateFiltered && <p className="text-amber-300">这份文件设置了日期筛选，可能不包含全部豆瓣记录。</p>}
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>影片</th><th>状态变化</th><th>匹配</th><th>操作 / 冲突字段</th></tr></thead><tbody>{preview.rows.slice(page*50,(page+1)*50).map(row=><tr key={row.subjectId}><td className="py-2">{row.title}</td><td>{row.before ? labels[row.before] : "—"} → {row.after ? labels[row.after] : "—"}</td><td>{row.match}</td><td>{row.action} {row.fields.join("、")}{row.changes?.map(change=><div key={change.field} className="max-w-sm whitespace-pre-wrap break-words text-xs text-slate-400">{change.field}：{change.before || "空"} → {change.after || "空"}</div>)}</td></tr>)}</tbody></table></div>
      <div className="flex gap-2"><Button disabled={busy || page===0} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>{page+1} / {Math.max(1,Math.ceil(preview.rows.length/50))}</span><Button disabled={busy || (page+1)*50>=preview.rows.length} onClick={()=>setPage(p=>p+1)}>下一页</Button></div>
      {strategy==="replace" && <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我确认用本文件完整替换个人片单，包括移除上面列出的现有记录</label>}
      <Button disabled={busy || disabled || (strategy==="replace" && !confirmed)} onClick={async()=>{setBusy(true);try{const result=await commitMemberCollection(preview.id,confirmed);if(!mounted.current)return;onImport(result);setPreview(undefined);setData(undefined);setMessage(`已保存到账号，共 ${result.entries.length} 条。`);}catch(e){setMessage(e instanceof Error ? e.message : "保存失败，请重试。");}finally{setBusy(false);}}}>确认保存到账号</Button>
    </>}
    {collection.undoImportId && <Button disabled={busy || disabled} variant="outline" onClick={async()=>{setBusy(true);try{const value=await undoMemberCollection(collection.undoImportId!,collection.revision);if(!mounted.current)return;onImport(value);setPreview(undefined);setMessage("已撤销最近一次导入。");}catch(e){setMessage(e instanceof Error ? e.message : "撤销失败。");}finally{setBusy(false);}}}>撤销最近一次导入</Button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
