import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseParameters} from './lib/native-contract.mjs';
import {commands,execute} from './native-cli.mjs';
import {preserveSecretEnvironment} from './lib/native-operations.mjs';

test('every PowerShell infra operation has a native zsh entrypoint and offline help',()=>{
 for(const file of fs.readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.ps1'))){
  const native=new URL(file.replace('.ps1','.zsh'),import.meta.url);assert.ok(fs.existsSync(native),file);
  execFileSync('zsh',['-n',native.pathname]);
  if(file==='cloud-config.ps1')continue;
  const help=execFileSync('zsh',[native.pathname,'--help'],{encoding:'utf8',env:{...process.env,PATH:process.env.PATH}});
  assert.match(help,/Usage:/u);
 }
});
test('cloud defaults, environment and explicit aliases preserve priority and argument boundaries',()=>{
 const cloud={DEPLOY_BUILD_API_IMAGE_RESOURCEGROUP:'cloud-group'};
 const {values}=parseParameters('build-api-image',['--resource-group','name $(literal)','-ImageTag','release'],cloud,{DEPLOY_BUILD_API_IMAGE_RESOURCEGROUP:'env-group'});
 assert.equal(values.ResourceGroup,'name $(literal)');assert.equal(values.ImageTag,'release');
 assert.equal(parseParameters('build-api-image',[],cloud,{}).values.ResourceGroup,'cloud-group');
 assert.throws(()=>parseParameters('deploy-metadata-sync-job',['--mode','typo']),/Mode/);
 assert.throws(()=>parseParameters('deploy-people-sync-job',['--cpu','NaN']),/number/);
});
test('API replacement preserves existing secret references in the same revision',()=>{
 const existing={properties:{template:{containers:[{env:[{name:'CUSTOM_KEY',secretRef:'custom'},{name:'UNCHANGED_PLAIN',value:'old'}]}]},configuration:{secrets:[{name:'admin'}]}}};
 const env=preserveSecretEnvironment(['API_PORT=8787'],existing,[['admin','WWPDW_ADMIN_KEY']]);
 assert.ok(env.includes('CUSTOM_KEY=secretref:custom'));assert.ok(env.includes('WWPDW_ADMIN_KEY=secretref:admin'));assert.ok(!env.some(e=>e.startsWith('UNCHANGED_PLAIN=')));
});
function fake({existing=true,workerState='Succeeded'}={}) {
 const calls=[];
 const az=async args=>{
  calls.push(args);
  if(args.includes('defaultHostname'))return 'web.test';
  if(args.includes('loginServer'))return 'registry.test';
  if(args.join(' ').startsWith('identity show'))return {id:'/identity',clientId:'client',principalId:'principal'};
  if(args.includes('secret')&&args.includes('show'))return 'https://vault.test/secrets/test/0123456789abcdef0123456789abcdef';
  if(args.includes('execution')&&args.includes('show'))return {properties:{status:workerState}};
  if(args.includes('start'))return {name:'execution'};
  if(args.includes('[0].id'))return 'existing-role';
  if(args[0]==='account')return args.includes('--query')?'subscription':{id:'e9219db7-f600-43c5-8d42-9c63aae09138'};
  if(args.includes('list'))return existing?[{name:'job-ww-meta-index-incremental'},{name:'job-ww-meta-index-full'},{name:'job-ww-people-index'},{name:'job-ww-cache-cleanup'},{name:'job-ww-cache-worker'},{name:'ca-ww-player-api'}]:[];
  return {name:'resource',id:'/resource',identity:{userAssignedIdentities:{'/identity':{}}},properties:{provisioningState:'Succeeded',template:{containers:[{env:[{name:'EXISTING_AUTH',secretRef:'retained'}]}]},configuration:{secrets:[]}}};
 };
 return {calls,io:{repoRoot:'/project with spaces',az,optional:az,sleep:async()=>{},setSecret:async(...args)=>calls.push(['setSecret',...args]),secret:async()=> 'private-secret',signedInUser:async()=>null}};
}
for(const existing of [true,false])test(`all native deployment families build Azure commands (${existing?'update':'create'})`,async()=>{
 for(const name of commands.filter(c=>c.startsWith('deploy-'))){
  const {values,contract}=parseParameters(name,[],{},{});
  values.NotionPeopleDataSourceId='people-source';
  const {calls,io}=fake({existing});
  await execute(name,values,contract,io);
  const mutation=calls.find(c=>c[0]==='containerapp'&&c.includes(existing?'update':'create'));
  assert.ok(mutation,name);assert.ok(mutation.includes(existing?'--replace-env-vars':'--env-vars'),name);
  assert.ok(mutation.includes('WWP_CONFIG_MODE=injected'),name);
  if(name==='deploy-api-containerapp'&&existing)assert.ok(mutation.includes('EXISTING_AUTH=secretref:retained'));
  if(name==='deploy-metadata-sync-job')assert.ok(mutation.includes('--cron-expression'));
 }
});
test('full metadata jobs remain manual, while image-only never touches schedule or secrets',async()=>{
 for(const extra of [[],['--image-only','--image-tag','release']]){
  const {values,contract}=parseParameters('deploy-metadata-sync-job',['--mode','full',...extra],{},{});
  const {calls,io}=fake({existing:extra.length>0});await execute('deploy-metadata-sync-job',values,contract,io);
  const change=calls.find(c=>c.includes(extra.length?'update':'create'));
  if(extra.length){assert.ok(!change.includes('--replace-env-vars'));assert.ok(!calls.some(c=>c.includes('secret')));}
  else {assert.ok(change.includes('Manual'));assert.ok(!change.includes('--cron-expression'));}
 }
});
test('failed worker executions return failure instead of a successful shell exit',async()=>{
 const {values,contract}=parseParameters('start-worker-job',[],{},{});const {io}=fake({workerState:'Failed'});
 await assert.rejects(execute('start-worker-job',values,contract,io),/Failed/);
});
test('provision rejects the wrong subscription before mutations',async()=>{
 const {values,contract}=parseParameters('provision',[],{},{});values.ExpectedSubscriptionId='different';const {calls,io}=fake();
 await assert.rejects(execute('provision',values,contract,io),/subscription/);assert.deepEqual(calls,[['account','show']]);
});
test('native image builds preserve linux amd64 and both tags without local Docker',async()=>{
 const {values,contract}=parseParameters('build-api-image',['--image-tag','release'],{},{});const {calls,io}=fake();await execute('build-api-image',values,contract,io);
 const build=calls[0];assert.ok(build.includes('linux/amd64'));assert.ok(build.includes('wwpdw/api:release'));assert.ok(build.includes('wwpdw/api:latest'));assert.ok(build.includes('/project with spaces'));
});
test('administrator key binding restarts only active revisions and supports NoRestart',async()=>{
 for(const noRestart of [false,true]){
  const {values,contract}=parseParameters('set-admin-key',noRestart?['--no-restart']:[],{},{});
  const {calls,io}=fake();const az=io.az;
  io.az=async args=>args.includes('revision')&&args.includes('list')?[{name:'active',properties:{active:true}},{name:'inactive',properties:{active:false}}]:az(args);
  await execute('set-admin-key',values,contract,io);
  assert.ok(calls.some(c=>c[0]==='setSecret'));assert.equal(calls.filter(c=>c.includes('restart')).length,noRestart?0:1);
 }
});
test('provision converges existing resources and preserves storage/identity policy',async()=>{
 const {values,contract}=parseParameters('provision',[],{},{});const {calls,io}=fake();await execute('provision',values,contract,io);
 assert.ok(calls.some(c=>c.includes('management-policy')));
 const storage=calls.find(c=>c[0]==='storage'&&c[1]==='account'&&c[2]==='update');
 assert.ok(storage.includes('TLS1_2'));assert.ok(storage.includes('--allow-blob-public-access'));
 assert.ok(!calls.some(c=>c[0]==='containerapp'&&c[1]==='env'&&c[2]==='create'));
});
test('Azure failures abort API revisions before any environment replacement',async()=>{
 const {values,contract}=parseParameters('deploy-api-containerapp',[],{},{});const {calls,io}=fake();
 io.optional=async()=>{throw Error('Forbidden');};
 await assert.rejects(execute('deploy-api-containerapp',values,contract,io),/Forbidden/);
 assert.ok(!calls.some(c=>c.includes('--replace-env-vars')));
});
