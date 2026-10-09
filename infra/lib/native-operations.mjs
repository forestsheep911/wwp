import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {environmentFor} from './native-contract.mjs';
const tags=['project=ww-player-cache','env=dev','managedBy=infra-script'];
const defaultLibrary='f47ef878-8acb-4e12-b604-011e95fb1738';
const defaultAssets='9bacb469-eff7-4c92-80bd-8db16838f2e2';
const bindings=[
 ['Notion','NOTION_READ_ONLY_TOKEN',''],['Admin','WWPDW_ADMIN_KEY','AdminKey'],
 ['Bailian','BAILIAN_API_KEY','BailianApiKey'],
 ['AliyunAccessKeyId','ALIBABA_CLOUD_ACCESS_KEY_ID','AliyunAccessKeyId'],
 ['AliyunAccessKeySecret','ALIBABA_CLOUD_ACCESS_KEY_SECRET','AliyunAccessKeySecret'],
 ['OpenAi','OPENAI_API_KEY','OpenAiApiKey']
];
function secretMapping(p,prefix) {
 const key=prefix==='AliyunAccessKeySecret'?'AliyunAccessKeySecretKeyVaultSecretName':`${prefix}KeyVaultSecretName`;
 return [p[key],p[`${prefix}ContainerSecretName`]];
}
function common(p,name=p.JobName??p.ApiAppName){return ['--name',name,'--resource-group',p.ResourceGroup];}
function required(value,message){if(!value)throw Error(message);return value;}
function summary(resource){
 return {name:resource.name,provisioningState:resource.properties?.provisioningState,
  image:resource.properties?.template?.containers?.[0]?.image,
  fqdn:resource.properties?.configuration?.ingress?.fqdn,
  triggerType:resource.properties?.configuration?.triggerType,
  cronExpression:resource.properties?.configuration?.scheduleTriggerConfig?.cronExpression};
}
function resolveSources(p,cloud,env) {
 const lookup=(...names)=>names.map(k=>env[k]??cloud[k]).find(v=>v);
 p.NotionLibraryRootPageId ||= lookup('NOTION_LIBRARY_ROOT_PAGE_ID','PAGE_ID')??'';
 p.NotionLibraryDatabaseId ||= lookup('NOTION_LIBRARY_DATABASE_ID','NOTION_MEDIA_DATABASE_ID')??'';
 p.NotionLibraryDataSourceId ||= lookup('NOTION_LIBRARY_DATA_SOURCE_ID','NOTION_DATA_SOURCE_ID')??'';
 p.NotionMediaAssetsDatabaseId ||= lookup('NOTION_MEDIA_ASSETS_DATABASE_ID')??'';
 p.NotionMediaAssetsDataSourceId ||= lookup('NOTION_MEDIA_ASSETS_DATA_SOURCE_ID')??'';
 if(!p.NotionLibraryDatabaseId&&!p.NotionLibraryDataSourceId)p.NotionLibraryDatabaseId=defaultLibrary;
 if(!p.NotionMediaAssetsDatabaseId&&!p.NotionMediaAssetsDataSourceId)p.NotionMediaAssetsDatabaseId=defaultAssets;
}
export function preserveSecretEnvironment(environment,existing,requiredBindings=[]) {
 const env=new Map(environment.map(entry=>{const i=entry.indexOf('=');return [entry.slice(0,i),entry.slice(i+1)];}));
 for(const entry of existing?.properties?.template?.containers?.[0]?.env??[])if(entry.secretRef&&!env.has(entry.name))env.set(entry.name,`secretref:${entry.secretRef}`);
 const secrets=new Set((existing?.properties?.configuration?.secrets??[]).map(s=>s.name));
 for(const [name,key]of requiredBindings)if(secrets.has(name)&&!env.has(key))env.set(key,`secretref:${name}`);
 return [...env].map(([k,v])=>`${k}=${v}`);
}
async function registryIdentity(p,io) {
 const login=required(await io.az(['acr','show',...common(p,p.RegistryName),'--query','loginServer']),'Could not resolve registry');
 const identity=await io.az(['identity','show',...common(p,p.IdentityName)]);
 required(identity?.id,'Managed identity is missing');required(identity.clientId,'Managed identity clientId is missing');
 return {login,identity,image:`${login}/${p.ImageName}:${p.ImageTag}`};
}
async function secretUri(p,io,name,value,mandatory=false) {
 let secret=await io.optional(['keyvault','secret','show','--vault-name',p.KeyVaultName,'--name',name,'--query','id']);
 if(!secret&&value){await io.setSecret(p.KeyVaultName,name,value);secret=await io.az(['keyvault','secret','show','--vault-name',p.KeyVaultName,'--name',name,'--query','id']);}
 if(mandatory)required(secret,`Required Vault secret is missing: ${name}`);
 return secret?.replace(/\/[0-9a-f]{32}$/iu,'');
}
async function attach(p,io,target,identity,prefix,{mandatory=false,rotate=false}={}) {
 const binding=bindings.find(b=>b[0]===prefix);const [vaultName,containerName]=secretMapping(p,prefix);
 const value=binding[2]?p[binding[2]]:undefined;
 if(rotate)await io.setSecret(p.KeyVaultName,vaultName,required(value,'Admin key is required'));
 const uri=await secretUri(p,io,vaultName,value,mandatory);
 if(!uri)return false;
 await io.az([...target,'secret','set',...common(p),'--secrets',`${containerName}=keyvaultref:${uri},identityref:${identity.id}`]);
 await io.az([...target,'update',...common(p),'--set-env-vars',`${binding[1]}=secretref:${containerName}`]);
 return true;
}
async function attachAliyun(p,io,target,identity,mandatory=false) {
 const specs=[];
 for(const prefix of ['AliyunAccessKeyId','AliyunAccessKeySecret']) {
  const [vault,container]=secretMapping(p,prefix);
  const uri=await secretUri(p,io,vault,p[prefix],mandatory);
  specs.push({container,uri,key:bindings.find(b=>b[0]===prefix)[1]});
 }
 if(specs.some(s=>!s.uri))return false;
 await io.az([...target,'secret','set',...common(p),'--secrets',...specs.map(s=>`${s.container}=keyvaultref:${s.uri},identityref:${identity.id}`)]);
 await io.az([...target,'update',...common(p),'--set-env-vars',...specs.map(s=>`${s.key}=secretref:${s.container}`)]);
 return true;
}
export async function buildImage(name,p,io) {
 const component=name==='build-api-image'?'api':'worker';
 await io.az(['acr','build','--resource-group',p.ResourceGroup,'--registry',p.RegistryName,'--file',`Dockerfile.${component}`,'--image',`${p.ImageName}:${p.ImageTag}`,'--image',`${p.ImageName}:latest`,'--platform','linux/amd64',io.repoRoot]);
 const login=await io.az(['acr','show',...common(p,p.RegistryName),'--query','loginServer']);
 return {registry:p.RegistryName,loginServer:login,image:`${login}/${p.ImageName}:${p.ImageTag}`,latest:`${login}/${p.ImageName}:latest`};
}
export async function startJob(name,p,io) {
 if(name==='start-metadata-sync-job')p.JobName ||=p.Mode==='full'?'job-ww-meta-index-full':'job-ww-meta-index-incremental';
 const execution=await io.az(['containerapp','job','start',...common(p)]);
 required(execution?.name,'Job start did not return an execution name');
 if(name==='start-people-sync-job')return {executionName:execution.name};
 if(name!=='start-worker-job')return {executionName:execution.name};
 for(let i=0;i<60;i++) {
  await (io.sleep??sleep)(3000);
  const state=await io.az(['containerapp','job','execution','show',...common(p),'--job-execution-name',execution.name]);
  const status=state.properties?.status;
  if(status!=='Running') {
   if(status!=='Succeeded')throw Error(`Worker execution ended with status ${status}`);
   return {executionName:execution.name,status};
  }
 }
 throw Error(`Worker execution did not finish in 180 seconds: ${execution.name}`);
}
export async function deployJob(name,p,contract,io,cloud={},env={}) {
 const metadata=name==='deploy-metadata-sync-job',people=name==='deploy-people-sync-job',cleanup=name==='deploy-cleanup-job';
 if(metadata)p.JobName ||=p.Mode==='full'?'job-ww-meta-index-full':'job-ww-meta-index-incremental';
 const target=['containerapp','job'];
 if(metadata&&p.ImageOnly) {
  if(!p.ImageTag||p.ImageTag==='latest')throw Error('ImageOnly requires an explicit release tag');
  const login=await io.az(['acr','show',...common(p,p.RegistryName),'--query','loginServer']);
  await io.az([...target,'show',...common(p)]);
  await io.az([...target,'update',...common(p),'--image',`${login}/${p.ImageName}:${p.ImageTag}`]);
  return summary(await io.az([...target,'show',...common(p)]));
 }
 if(metadata){if(p.DelayMs<0)p.DelayMs=p.Mode==='full'?2500:500;resolveSources(p,cloud,env);}
 if(people)required(p.NotionPeopleDataSourceId,'NOTION_PEOPLE_DATA_SOURCE_ID is required');
 const {login,identity,image}=await registryIdentity(p,io);p.IdentityClientId=identity.clientId;
 const secretBindings=[];
 if(metadata||people){
  const uri=await secretUri(p,io,p.NotionKeyVaultSecretName,undefined,true);
  secretBindings.push(`${p.NotionContainerSecretName}=keyvaultref:${uri},identityref:${identity.id}`);
 }
 const environment=environmentFor(contract,p);
 const existing=(await io.az([...target,'list','--resource-group',p.ResourceGroup])).find(j=>j.name===p.JobName);
 const schedule=cleanup||people||(metadata&&p.Mode==='incremental');
 const timeout=metadata?'14400':people?'1800':cleanup?'900':'3600';
 const command=metadata||people?['--command','node','--args','node_modules/tsx/dist/cli.mjs',`apps/api/src/${metadata?'meta-sync':'people-sync'}.ts`]:[];
 const resources=['--image',image,'--cpu',String(p.Cpu??0.5),'--memory',p.Memory??'1.0Gi','--replica-timeout',timeout,'--replica-retry-limit','1',...command];
 if(existing) {
  if(secretBindings.length)await io.az([...target,'secret','set',...common(p),'--secrets',...secretBindings]);
  await io.az([...target,'update',...common(p),...resources,...(schedule?['--cron-expression',p.CronExpression]:[]),'--replace-env-vars',...environment]);
 } else {
  await io.az([...target,'create',...common(p),'--environment',p.ContainerEnv,'--trigger-type',schedule?'Schedule':'Manual',...(schedule?['--cron-expression',p.CronExpression]:[]),'--replica-completion-count','1','--parallelism','1',...resources,'--registry-server',login,'--registry-identity',identity.id,'--mi-user-assigned',identity.id,...(secretBindings.length?['--secrets',...secretBindings]:[]),'--env-vars',...environment,'--tags',...tags,...(metadata||people||cleanup?[`component=${metadata?'metadata-index':people?'people-index':'cleanup'}`]:[])]);
 }
 if(cleanup)await attachAliyun(p,io,target,identity,true);
 else if(!metadata&&!people){for(const prefix of ['OpenAi','Bailian'])await attach(p,io,target,identity,prefix);}
 return summary(await io.az([...target,'show',...common(p)]));
}
export async function deployApi(p,contract,io,cloud={},env={}) {
 const {login,identity,image}=await registryIdentity(p,io);
 p.IdentityClientId=identity.clientId;p.subscriptionId=await io.az(['account','show','--query','id']);
 resolveSources(p,cloud,env);
 const omdb=await secretUri(p,io,'OMDB-API-KEY',undefined,true);
 const worker=await io.az(['containerapp','job','show',...common(p,p.WorkerJobName)]);
 await ensureRole(io,identity.principalId,'ServicePrincipal','Contributor',required(worker?.id,'Worker job id missing'));
 if(!p.AllowedWebOrigins){const host=await io.az(['staticwebapp','show',...common(p,p.StaticAppName),'--query','defaultHostname']);p.AllowedWebOrigins=host?`https://${host}`:'';}
 required(p.AllowedWebOrigins,'AllowedWebOrigins is required for browser authentication');
 const target=['containerapp'];
 const existing=(await io.az([...target,'list','--resource-group',p.ResourceGroup])).find(a=>a.name===p.ApiAppName);
 const app=existing?await io.az([...target,'show',...common(p)]):undefined;
 const references=bindings.filter(b=>b[0]!=='OpenAi').map(b=>[p[`${b[0]}ContainerSecretName`],b[1]]);
 const environment=preserveSecretEnvironment(environmentFor(contract,p),app,references);
 const omdbBinding=`omdb-api-key=keyvaultref:${omdb},identityref:${identity.id}`;
 const resources=['--image',image,'--cpu','0.5','--memory','1.0Gi','--min-replicas','0','--max-replicas','2'];
 if(existing) {
  await io.az([...target,'identity','assign',...common(p),'--user-assigned',identity.id]);
  await io.az([...target,'registry','set',...common(p),'--server',login,'--identity',identity.id]);
  await io.az([...target,'secret','set',...common(p),'--secrets',omdbBinding]);
  await io.az([...target,'update',...common(p),...resources,'--replace-env-vars',...environment]);
 } else {
  await io.az([...target,'create',...common(p),'--environment',p.ContainerEnv,...resources,'--registry-server',login,'--registry-identity',identity.id,'--user-assigned',identity.id,'--ingress','external','--target-port','8787','--env-vars',...environment,'--secrets',omdbBinding,'--tags',...tags,'component=api']);
 }
 for(const prefix of ['Notion','Bailian','Admin'])await attach(p,io,target,identity,prefix);
 await attachAliyun(p,io,target,identity);
 return summary(await io.az([...target,'show',...common(p)]));
}
async function ensureRole(io,principal,type,role,scope) {
 const args=['--assignee-object-id',principal,'--role',role,'--scope',scope];
 const current=await io.az(['role','assignment','list',...args,'--fill-principal-name','false','--query','[0].id']);
 if(!current)await io.az(['role','assignment','create',...args,'--assignee-principal-type',type]);
}
export async function setAdmin(p,io) {
 p.AdminKey ||= await io.secret('WWPDW_ADMIN_KEY');
 required(p.AdminKey,'WWPDW_ADMIN_KEY is not configured');
 const app=await io.az(['containerapp','show',...common(p)]);
 const id=Object.keys(app.identity?.userAssignedIdentities??{})[0];required(id,'API user-assigned identity is missing');
 await attach(p,io,['containerapp'],{id},'Admin',{mandatory:true,rotate:true});
 if(!p.NoRestart) {
  const revisions=await io.az(['containerapp','revision','list',...common(p)]);
  for(const revision of revisions.filter(r=>r.active||r.properties?.active))await io.az(['containerapp','revision','restart',...common(p),'--revision',revision.name]);
 }
 return {name:p.ApiAppName,keyVaultSecret:p.AdminKeyVaultSecretName,containerSecret:p.AdminContainerSecretName};
}
export async function provision(p,io) {
 const account=await io.az(['account','show']);
 if(account.id!==p.ExpectedSubscriptionId)throw Error('Active Azure subscription differs from ExpectedSubscriptionId');
 const names={storage:`stwwcache${p.Suffix}`,acr:`acrwwcache${p.Suffix}`,vault:`kv-wwcache-${p.Suffix}`,identity:'id-ww-player-cache-dev',workspace:'log-ww-player-cache-dev',environment:'cae-ww-player-cache-dev'};
 const location=['--location',p.Location],tagArgs=['--tags',...tags];
 await io.az(['group','create','--name',p.ResourceGroup,...location,...tagArgs]);
 async function ensure(show,create,update){const current=await io.optional(show);if(!current)await io.az(create);else if(update)await io.az(update);}
 const storageCommon=common(p,names.storage);
 await ensure(['storage','account','show',...storageCommon],['storage','account','create',...storageCommon,...location,'--sku','Standard_LRS','--kind','StorageV2','--min-tls-version','TLS1_2','--https-only','true','--allow-blob-public-access','false',...tagArgs],['storage','account','update',...storageCommon,'--min-tls-version','TLS1_2','--https-only','true','--allow-blob-public-access','false']);
 for(const [kind,name]of [['container','cached-videos'],['queue','cache-jobs'],['table','cacheindex'],['table','cachejobs']])await io.az(['storage',kind,'create','--account-name',names.storage,'--name',name,...(kind==='container'?['--public-access','off']:[])]);
 await io.az(['storage','account','management-policy','create','--account-name',names.storage,'--resource-group',p.ResourceGroup,'--policy',`@${path.join(io.repoRoot,'infra/storage-lifecycle.json')}`]);
 await ensure(['acr','show',...common(p,names.acr)],['acr','create',...common(p,names.acr),...location,'--sku','Basic','--admin-enabled','false',...tagArgs]);
 const workspaceArgs=['--workspace-name',names.workspace,'--resource-group',p.ResourceGroup];
 await ensure(['monitor','log-analytics','workspace','show',...workspaceArgs],['monitor','log-analytics','workspace','create',...workspaceArgs,...location,...tagArgs]);
 const environment=await io.optional(['containerapp','env','show',...common(p,names.environment)]);
 if(!environment) {
  const workspaceId=await io.az(['monitor','log-analytics','workspace','show',...workspaceArgs,'--query','customerId']);
  const workspaceKey=await io.az(['monitor','log-analytics','workspace','get-shared-keys',...workspaceArgs,'--query','primarySharedKey']);
  await io.az(['containerapp','env','create',...common(p,names.environment),...location,'--logs-workspace-id',workspaceId,'--logs-workspace-key',workspaceKey,...tagArgs]);
 }
 await ensure(['keyvault','show',...common(p,names.vault)],['keyvault','create',...common(p,names.vault),...location,'--sku','standard','--enable-rbac-authorization','true','--retention-days','7',...tagArgs],['keyvault','update',...common(p,names.vault),'--enable-rbac-authorization','true']);
 await ensure(['identity','show',...common(p,names.identity)],['identity','create',...common(p,names.identity),...location,...tagArgs]);
 const identity=await io.az(['identity','show',...common(p,names.identity)]);
 const storageId=await io.az(['storage','account','show',...storageCommon,'--query','id']);
 const acrId=await io.az(['acr','show',...common(p,names.acr),'--query','id']);
 const vaultId=await io.az(['keyvault','show',...common(p,names.vault),'--query','id']);
 for(const [role,scope]of [['Storage Blob Data Contributor',storageId],['Storage Queue Data Contributor',storageId],['Storage Table Data Contributor',storageId],['Key Vault Secrets User',vaultId],['AcrPull',acrId]])await ensureRole(io,identity.principalId,'ServicePrincipal',role,scope);
 // Match the PS entrypoint's optional signed-in-user grant; do not hide other failures.
 const user=await io.signedInUser();
 if(user)await ensureRole(io,user.id,'User','Key Vault Secrets Officer',vaultId);
 return {resourceGroup:p.ResourceGroup,location:p.Location,storageAccount:names.storage,blobContainer:'cached-videos',queue:'cache-jobs',tables:['cacheindex','cachejobs'],acr:names.acr,keyVault:names.vault,managedIdentity:names.identity,logAnalytics:names.workspace,containerAppsEnv:names.environment,managedIdentityId:identity.id,managedIdentityAppId:identity.clientId};
}
