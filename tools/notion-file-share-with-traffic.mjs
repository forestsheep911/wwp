import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { config } from "./lib/project-secrets.mjs";
import { transportUrl } from "./lib/notion-attachment-transport.mjs";
const transport=await import(transportUrl("with-transfer-traffic.mjs"));
export const { uploadedBytesFromState, trafficReportPath } = transport;
export async function main() {
 config({resolveSecrets:["VPN_TRAFFIC_CHECK_URL","VPN_TRAFFIC_CHECK_URL_2"]});
 return transport.main();
}
if(process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href.toLowerCase()===import.meta.url.toLowerCase()) main().catch(()=>{console.error("Transfer traffic wrapper failed; state retained.");process.exitCode=1;});
