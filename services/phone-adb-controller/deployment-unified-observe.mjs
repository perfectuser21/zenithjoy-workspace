// 先提交xian真实观测，再提交唯一MMV聚合观测；本机视图不混入远端路径。
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {digest} from './runtime-definition.mjs';
import {observeDeployment} from './deployment-release.mjs';
import {brainRequest} from './deployment-preflight.mjs';
import {localManifestView,verifyDeploymentPlan} from './deployment-targets.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const run=(cmd,args,input)=>execFileSync(cmd,args,{input,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
const need=(v,m)=>{if(!v)throw Error(m);};
export function aggregateManifest(plan,local){
 need(plan.source_repo===local.source_repo&&plan.source_commit===local.source_commit,'聚合源与本机manifest不一致');
 const files=new Map(local.files.map(f=>[f.path,{path:f.path,deployed_path:'component:'+f.path,content_sha256:f.content_sha256}]));
 for(const c of plan.releases.mmv.payload.components.filter(c=>c.kind!=='repo')){
  const entry={path:c.path,deployed_path:'component:'+c.path,content_sha256:c.digest.slice(7)};
  need(!files.has(c.path)||files.get(c.path).content_sha256===entry.content_sha256,'本机视图binding漂移');files.set(c.path,entry);
 }
 return{schema_version:1,source_repo:plan.source_repo,source_commit:plan.source_commit,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
function atomicManifest(host,relative,manifest,expected){
 const py="import os,json,hashlib,sys,tempfile;from pathlib import Path;x=json.load(sys.stdin);p=Path.home()/x['path'];assert x['path'] in ['bin-harvest/deployment-manifest.json','.openclaw/leadgen-scripts/deployment-manifest.json'];raw=p.read_bytes() if p.exists() else None;assert (hashlib.sha256(raw).hexdigest() if raw is not None else None)==x['expected'],'manifest CAS conflict';fd,tmp=tempfile.mkstemp(prefix='.deployment-manifest.',dir=p.parent);f=os.fdopen(fd,'w');json.dump(x['manifest'],f);f.close();os.chmod(tmp,0o600);os.replace(tmp,p)";
 run('ssh',['-T',host,'python3 -c '+quote(py)],JSON.stringify({path:relative,manifest,expected}));
}
function manifestHash(host,relative){
 const py="import sys,hashlib;from pathlib import Path;p=Path.home()/sys.argv[1];print(hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else 'missing')";
 const value=run('ssh',['-T',host,'python3 -c '+quote(py)+' '+quote(relative)]).trim();return value==='missing'?null:value;
}
function runtimeFiles(){
 const py="import importlib.util,json,sys;from pathlib import Path;p=Path(sys.argv[1]);s=importlib.util.spec_from_file_location('wfio',p/'wf-v2-io.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.components(p)))";
 return JSON.parse(run('python3',['-c',py,join(HERE,'commander')]));
}
async function collectMmv(plan,local,manifest,xianAck,request){
 const endpoint=`/api/brain/releases/${xianAck.release_id}`;
 const gate=await request(endpoint+'/gate');need(gate.deployed&&gate.actual_matches&&gate.current_observation_id===xianAck.observation_id,'xian正式观测已被其它release覆盖');
 const receipt=(await request(endpoint+'/observations/'+xianAck.observation_id)).observation;need(receipt?.release_id===xianAck.release_id,'xian ACK身份错误');
 const spec={manifest,local_manifest:local,commander_files:runtimeFiles(),commander_releases:plan.commander_releases,xian_ack:xianAck};
 const measured=JSON.parse(run('ssh',['-T','mmv','python3 -c '+quote(readFileSync(join(HERE,'deployment-installed.py'),'utf8'))],JSON.stringify(spec)));
 const finalGate=await request(endpoint+'/gate');need(finalGate.deployed&&finalGate.actual_matches&&finalGate.current_observation_id===xianAck.observation_id,'采集期间xian正式观测变化');
 return{...measured,xian_formal_ack:{observation:receipt,gate:finalGate}};
}
export async function observeUnified({plan,xianManifest,mmvManifest,options,collectXian,collectMmv:measureMmv,publish}){
 const xianAck=await observeDeployment({...options,host:'xian-m4',releaseId:plan.release_ids['xian-m4'],manifest:xianManifest,collect:collectXian});
 await publish('xian-m4','bin-harvest/deployment-manifest.json',xianAck);
 const aggregate=aggregateManifest(plan,mmvManifest);
 const mmvAck=await observeDeployment({...options,host:'mmv',releaseId:plan.release_ids.mmv,manifest:aggregate,collect:()=>measureMmv(aggregate,xianAck)});
 const view=localManifestView(mmvManifest,mmvAck);
 await publish('mmv','.openclaw/leadgen-scripts/deployment-manifest.json',view);
 await publish('mmv','bin-harvest/deployment-manifest.json',view);
 return{xian:xianAck,mmv:view};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const [planFile,xianFile,mmvFile]=process.argv.slice(2),env=process.env;
  const plan=JSON.parse(readFileSync(planFile)),xian=JSON.parse(readFileSync(xianFile)),mmv=JSON.parse(readFileSync(mmvFile));
  const request=brainRequest(env.BRAIN_URL,env.BRAIN_INTERNAL_TOKEN);await verifyDeploymentPlan(plan,request);
  const previous=new Map();for(const [host,path]of [['xian-m4','bin-harvest/deployment-manifest.json'],['mmv','.openclaw/leadgen-scripts/deployment-manifest.json'],['mmv','bin-harvest/deployment-manifest.json']])previous.set(host+':'+path,manifestHash(host,path));
  // observeDeployment传绝对URL，既有Brain request同时接受同origin绝对路径。
  const options={environment:'production',collector:env.WF_DEPLOY_COLLECTOR,attemptKey:env.WF_DEPLOY_ATTEMPT_KEY,brainUrl:env.BRAIN_URL,stateDir:env.WF_DEPLOY_STATE_DIR||join(homedir(),'.config/zenithjoy/deployments'),request};
  const result=await observeUnified({plan,xianManifest:xian,mmvManifest:mmv,options,
   collectXian:async m=>JSON.parse(run('ssh',['-T','xian-m4','node ~/bin-harvest/deployment-manifest.mjs collect ~/bin-harvest -'],JSON.stringify(m))),
   collectMmv:(manifest,ack)=>collectMmv(plan,mmv,manifest,ack,request),
   publish:async(host,path,value)=>atomicManifest(host,path,value,previous.get(host+':'+path))});
  console.log(JSON.stringify(result));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
