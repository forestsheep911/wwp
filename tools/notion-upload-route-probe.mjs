import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {config} from "./lib/project-secrets.mjs";
import {transportUrl} from "./lib/notion-attachment-transport.mjs";
const transfer=await import(transportUrl("notion-upload-route-probe.mjs"));
export const {parseArgs,clashAuthorizationHeaders,filterTransferConnections,mergeConnectionSnapshots}=transfer;
export async function main(){
 if(!process.argv.includes("--help")) {
  config();
  process.env.NOTION_API_KEY ||= process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN || "";
 }
 return transfer.main();
}
if(process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href.toLowerCase()===import.meta.url.toLowerCase()) main().catch(()=>{console.error("WWP attachment probe stopped; report retained.");process.exitCode=1;});
