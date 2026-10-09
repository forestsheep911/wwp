import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentOptions, deployWeb, validateAssets } from './deploy-web-staticapp.mjs';
function fixture(fail) {
 const calls=[];
 const io={
  az(args){calls.push(args);if(args[1]==='list') return [{name:'stapp-ww-player-dev'}];if(args.includes('defaultHostname')) return 'example.test';if(args.includes('properties.apiKey')) return 'test-token';if(args.includes('appsettings')&&args.includes('list')) return {properties:{WWPDW_ADMIN_KEY:'hidden'}};return 'api.test';},
  build(){calls.push(['build']);if(fail==='build') throw Error('build failed');},validate(){calls.push(['validate']);},
  upload(token){assert.equal(token,'test-token');calls.push(['upload']);if(fail==='upload') throw Error('upload failed');},verify(){calls.push(['verify']);if(fail==='verify') throw Error('verify failed');}
 };return {io,calls};
}
test('explicit options override environment and cloud defaults without shell evaluation',()=>{
 const o=deploymentOptions(['--resource-group','a $(literal)'],{DEPLOY_DEPLOY_WEB_STATICAPP_RESOURCEGROUP:'cloud'},{DEPLOY_DEPLOY_WEB_STATICAPP_RESOURCEGROUP:'env'});
 assert.equal(o['resource-group'],'a $(literal)');assert.throws(()=>deploymentOptions(['--typo','x']));
});
for(const failure of ['build','upload','verify']) test(`${failure} failure prevents legacy cleanup and verification`,async()=>{
 const {io,calls}=fixture(failure);await assert.rejects(deployWeb(deploymentOptions([],{},{}),io));assert.ok(!calls.some(c=>c.includes('delete')));if(failure!=='verify')assert.ok(!calls.some(c=>c[0]==='verify'));
});
test('public assets must verify before legacy settings can be removed',async()=>{
 const {io,calls}=fixture();await deployWeb(deploymentOptions([],{},{}),io);assert.ok(calls.findIndex(c=>c[0]==='upload')<calls.findIndex(c=>c.includes('delete')));assert.ok(calls.findIndex(c=>c[0]==='verify')<calls.findIndex(c=>c.includes('delete')));
});
test('reject missing login route and cross-site origin anywhere in chunks',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wwp-assets-'));
 try{fs.writeFileSync(path.join(dir,'chunk.js'),'missing');assert.throws(()=>validateAssets(dir,'https://api.test'));fs.writeFileSync(path.join(dir,'chunk.js'),'/api/auth/login https://api.test');assert.throws(()=>validateAssets(dir,'https://api.test'));fs.writeFileSync(path.join(dir,'chunk.js'),'/api/auth/login');validateAssets(dir,'https://api.test');}finally{fs.rmSync(dir,{recursive:true});}
});
