import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readCloudConfiguration} from '../tools/lib/cloud-config.mjs';
import {resolveSecretReferences} from '../tools/lib/project-secrets.mjs';
import {contractFor,parseParameters} from './lib/native-contract.mjs';
import {buildImage,startJob,deployJob,deployApi,setAdmin,provision} from './lib/native-operations.mjs';
export const repoRoot=fileURLToPath(new URL('../',import.meta.url));
export const commands=['build-api-image','build-worker-image','deploy-api-containerapp','deploy-cleanup-job','deploy-metadata-sync-job','deploy-people-sync-job','deploy-worker-job','provision','set-admin-key','start-metadata-sync-job','start-people-sync-job','start-worker-job'];
export function createIO(p,cloud,env=process.env) {
 const temporary=new Set();
 const cleanup=()=>{for(const dir of temporary)fs.rmSync(dir,{recursive:true,force:true});temporary.clear();};
 const signals=['SIGINT','SIGTERM'];
 const handlers=signals.map((signal,index)=>{const handler=()=>{cleanup();process.exit(130+index*13);};process.once(signal,handler);return handler;});
 const az=args=>{
  try {
   const output=execFileSync(p.AzCli,args.concat(['--only-show-errors','--output','json']),{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:args[0]==='acr'&&args[1]==='build'?3600000:180000,env});
   return output.trim()?JSON.parse(output):null;
  }catch(error){
   const code=String(error.stderr??'').match(/(?:ERROR: \(|"code"\s*:\s*")([\w.]+)/u)?.[1]??'AzureCommandFailed';
   const safe=Error(`Azure ${args.slice(0,2).join(' ')} failed (${code}); check subscription, login and RBAC.`);safe.code=code;throw safe;
  }
 };
 return {
  repoRoot,az,
  optional(args){try{return az(args);}catch(error){if(['ResourceNotFound','SecretNotFound','ResourceGroupNotFound','ParentResourceNotFound'].includes(error.code))return null;throw error;}},
  signedInUser(){try{return az(['ad','signed-in-user','show']);}catch{console.warn('Signed-in user role grant unavailable; existing grants remain.');return null;}},
  setSecret(vault,name,value){
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wwp-vault-'));temporary.add(dir);fs.chmodSync(dir,0o700);
   const file=path.join(dir,'value');
   try{fs.writeFileSync(file,value,{mode:0o600});az(['keyvault','secret','set','--vault-name',vault,'--name',name,'--file',file]);}
   finally{fs.rmSync(dir,{recursive:true,force:true});temporary.delete(dir);}
  },
  secret(name){const values={...cloud,...env};resolveSecretReferences(values, undefined, new Set([name]));return values[name];},
  close(){cleanup();signals.forEach((s,i)=>process.removeListener(s,handlers[i]));}
 };
}
export async function execute(name,p,contract,io,cloud={},env={}) {
 if(name.startsWith('build-'))return buildImage(name,p,io);
 if(name.startsWith('start-'))return startJob(name,p,io);
 if(name==='deploy-api-containerapp')return deployApi(p,contract,io,cloud,env);
 if(name.startsWith('deploy-'))return deployJob(name,p,contract,io,cloud,env);
 if(name==='set-admin-key')return setAdmin(p,io);
 if(name==='provision')return provision(p,io);
 throw Error('Unknown native infra operation');
}
async function main() {
 const [name,...argv]=process.argv.slice(2);
 if(!commands.includes(name))throw Error(`Expected an infra command: ${commands.join(', ')}`);
 if(argv.includes('--help')||argv.includes('-h')) {
  console.log(`Usage: zsh infra/${name}.zsh [options]\nOptions (also accept PowerShell-style names):`);
  for(const [key,value]of Object.entries(contractFor(name).parameters))console.log(`  --${key}${value.type==='switch'?'':` <${value.type}>`}`);
  return;
 }
 const cloud=readCloudConfiguration();
 const {values,contract}=parseParameters(name,argv,cloud,process.env);
 const io=createIO(values,cloud);
 try {console.log(JSON.stringify(await execute(name,values,contract,io,cloud,process.env),null,2));}
 finally {io.close();}
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
