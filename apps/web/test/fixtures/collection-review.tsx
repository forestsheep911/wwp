import React, {useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {DoubanImportPanel} from "../../src/cinema/components/DoubanImportPanel";
import {getMemberCollection} from "../../src/api";
import "../../src/styles.css";
function Fixture(){const [collection,setCollection]=useState({entries:[],revision:"0"} as any);useEffect(()=>{void getMemberCollection().then(setCollection);},[]);return <main className="mx-auto max-w-5xl p-4 text-slate-100"><p>隔离测试账号 · 已保存 {collection.entries.length} 条</p><DoubanImportPanel collection={collection} onImport={setCollection} legacyRecords={[]} disabled={false}/></main>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
