import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { transportUrl } from "./lib/notion-attachment-transport.mjs";
export const { parseArgs, childEnvironment, validateRunOptions, main } = await import(transportUrl("with-notion-upload-route.mjs"));
if(process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href.toLowerCase()===import.meta.url.toLowerCase()) main().catch(error=>{console.error(error.message);process.exitCode=1;});
