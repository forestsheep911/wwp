import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Read only declarative parameter/env literals. PowerShell code is never executed.
export function contractFor(name) {
 if(!/^[a-z-]+$/u.test(name)) throw Error('Invalid infra command');
 const text=fs.readFileSync(path.join(root,`${name}.ps1`),'utf8');
 const header=text.slice(0,text.indexOf('\n)')+2);
 const parameters={};
 for(const line of header.split('\n')) {
  const m=line.match(/\[(string|int|double|switch)\]\$(\w+)(?:\s*=\s*(.*?))?,?$/u);
  if(!m)continue;
  const [,type,key,raw='']=m;let fallback='',env='';
  if(type==='switch')fallback=false;
  else if(raw.startsWith('"'))fallback=JSON.parse(raw.replace(/,$/u,''));
  else if(/^[-\d.]+,?$/u.test(raw))fallback=Number(raw.replace(/,$/u,''));
  else if(raw.startsWith('$env:'))env=raw.match(/^\$env:(\w+)/u)[1];
  else if(raw.includes('Get-Date'))fallback='@timestamp';
  else if(raw.startsWith('$(if')) {
   env=raw.match(/\$env:(\w+)/u)?.[1]??'';
   fallback=raw.match(/else \{ "([^"]*)" \}/u)?.[1]??'';
  } else if(raw)throw Error(`Unsupported parameter default in ${name}: ${key}`);
  parameters[key]={type,fallback,env};
 }
 if(!Object.keys(parameters).length)throw Error(`No native parameter contract for ${name}`);
 const base=text.match(/^\$envVars = @\(\n([\s\S]*?)^\)/mu)?.[1]??'';
 const environment=[...base.matchAll(/^\s*"([^"]*)"/gmu)].map(m=>m[1]);
 const fallbacks={};
 for(const m of text.matchAll(/if \(-not \$(\w+)\) \{\s*\$\1 = Get-CloudConfigValue -Names @\(([^)]*)\)/gu)) fallbacks[m[1]]=[...m[2].matchAll(/"([^"]+)"/gu)].map(x=>x[1]);
 const additions=[...text.matchAll(/\$envVars \+= "([^"]+)"/gu)].map(m=>m[1]);
 return {parameters,environment,additions,fallbacks};
}
export function parseParameters(name,argv,cloud={},env={}) {
 const contract=contractFor(name);const values={};
 const prefix=`DEPLOY_${name.toUpperCase().replaceAll('-','_')}_`;
 const normalized=new Map(Object.keys(contract.parameters).map(key=>[key.toLowerCase(),key]));
 for(const [key,p] of Object.entries(contract.parameters)) {
  values[key]=env[prefix+key.toUpperCase()]??cloud[prefix+key.toUpperCase()]??(p.env?env[p.env]:undefined)??p.fallback;
  if(values[key]==='@timestamp')values[key]=new Date().toISOString().replace(/\D/gu,'').slice(0,14);
  if(!values[key]&&p.env)values[key]=cloud[p.env]??values[key];
  if(!values[key])for(const alias of contract.fallbacks[key]??[])if(env[alias]??cloud[alias]){values[key]=env[alias]??cloud[alias];break;}
 }
 for(let i=0;i<argv.length;i++) {
  const arg=argv[i];const key=normalized.get(arg.replace(/^-+/u,'').replaceAll('-','').toLowerCase());
  if(!arg.startsWith('-')||!key)throw Error(`Unknown option: ${arg}`);
  if(contract.parameters[key].type==='switch')values[key]=true;
  else {if(argv[i+1]==null||/^--[a-z]/iu.test(argv[i+1]))throw Error(`Missing value for ${arg}`);values[key]=argv[++i];}
 }
 for(const [key,p] of Object.entries(contract.parameters)) {
  if(p.type==='switch') {
   if(![true,false,'true','false','1','0'].includes(values[key]))throw Error(`Invalid switch value for ${key}`);
   values[key]=values[key]===true||values[key]==='true'||values[key]==='1';
  }
  if(p.type==='int'||p.type==='double') {
   values[key]=Number(values[key]);
   if(!Number.isFinite(values[key])||(p.type==='int'&&!Number.isInteger(values[key])))throw Error(`Invalid number for ${key}`);
  }
 }
 if(values.Mode&&!['full','incremental'].includes(values.Mode))throw Error('Mode must be full or incremental');
 return {values,contract};
}
export function expandTemplate(template,values) {
 return template.replace(/\$\(\$identity\.clientId\)/gu,String(values.IdentityClientId??''))
  .replace(/\$([a-zA-Z]\w*)/gu,(_,key)=>{
   if(values[key]===undefined)throw Error(`Missing deployment template value: ${key}`);
   return String(values[key]);
  });
}
export function environmentFor(contract,values) {
 const env=new Map();
 const add=template=>{const expanded=expandTemplate(template,values);const i=expanded.indexOf('=');env.set(expanded.slice(0,i),expanded.slice(i+1));};
 contract.environment.forEach(add);
 for(const item of contract.additions) {
  const refs=[...item.matchAll(/\$(\w+)/gu)].map(m=>m[1]);
  if(refs.every(key=>values[key]!==undefined&&values[key]!==''))add(item);
 }
 env.set('WWP_CONFIG_MODE','injected');
 return [...env].map(([k,v])=>`${k}=${v}`);
}
