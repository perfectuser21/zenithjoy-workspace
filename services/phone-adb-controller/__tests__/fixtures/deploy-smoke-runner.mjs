// required smoke用真实HTTP预检；SSH/scp仍由外层临时桩记录，绝不接触设备。
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {digest} from '../../runtime-definition.mjs';
const deploy=resolve(process.argv[2]),root=execFileSync('git',['-C',resolve(deploy,'..'),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const repo='perfectuser21/zenithjoy-workspace',path='services/phone-adb-controller/douyin-phone-adb';
const activity='33333333-3333-4333-8333-333333333333',av='44444444-4444-4444-8444-444444444444';
const ids={'xian-m4':'55555555-5555-4555-8555-555555555555','xian-m1':'66666666-6666-4666-8666-666666666666'};
const component={kind:'code',repo,path,revision:sha,digest:'sha256:'+digest(readFileSync(join(root,path)))};
const row=(id,payload,extra)=>({id,...extra,source_repo:repo,source_path:'fixture-only.json',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'fixture-only.json',commit:sha},payload})});
const definitions={workflows:[1,2].map(n=>{const id=`b1000000-0000-4000-8000-00000000000${n}`;return row(id,{workflow_id:id,activities:[{activity_id:activity,activity_version_id:av}]},{workflow_id:id});}),activities:[row(av,{activity_id:activity,steps:[],implementation_bindings:[{...component,status:'verified'}]},{activity_id:activity})]};
const releases=Object.fromEntries(Object.entries(ids).map(([target,id])=>{const payload={...definitions,components:[{kind:'repo',repo,revision:sha},component],verification:{status:'verified'}};const release={id,target,environment:'fixture',payload};release.manifest_sha256=digest({environment:release.environment,target,payload});return [id,release];}));
// 完整部署fixture把SSH采集明确映射到本地真实源文件；机器名只是运输桩，绝不代表设备验收。
const originalSSH=execFileSync('/bin/sh',['-c','command -v ssh'],{encoding:'utf8'}).trim();
const transportDir=process.env.WF_DEPLOY_TEST_TRANSPORT_DIR;
if(!transportDir)throw Error('deploy smoke缺少显式运输桩目录');
if(originalSSH!==join(transportDir,'ssh')||execFileSync('/bin/sh',['-c','command -v scp'],{encoding:'utf8'}).trim()!==join(transportDir,'scp'))throw Error('deploy smoke必须显式提供首位PATH中的SSH/scp桩，禁止真实运输fallback');
const scratch=mkdtempSync(join(tmpdir(),'deploy-smoke-protocol-')),bin=join(scratch,'bin');mkdirSync(bin);
const collector=join(scratch,'collect.mjs');
writeFileSync(collector,`import {readFileSync} from 'node:fs';
import {collectDeployment} from ${JSON.stringify(new URL('../../deployment-manifest.mjs',import.meta.url).href)};
const actual=collectDeployment(${JSON.stringify(resolve(deploy,'..'))},JSON.parse(readFileSync(0,'utf8')));
actual.observed_hostname={'xian-m4':'m4-xian.local','xian-m1':'m1-us.local'}[process.argv[2]];
process.stdout.write(JSON.stringify(actual));
`);
const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
writeFileSync(join(bin,'ssh'),`#!/bin/sh
case "$2" in *"deployment-manifest.mjs collect"*) exec ${quote(process.execPath)} ${quote(collector)} "$1";; esac
exec ${quote(originalSSH)} "$@"
`,{mode:0o700});
const observations=new Map();
const server=createServer(async(req,res)=>{
 const parts=req.url.split('/'),release=releases[parts[4]];
 if(req.headers.authorization!=='Bearer fixture-deploy-only'||!release){res.writeHead(404);res.end('{}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});
 if(req.method==='POST'&&parts[5]==='observations'){
  let body='';for await(const chunk of req)body+=chunk;
  const observation={id:`fixture-${release.target}`,release_id:release.id,payload:JSON.parse(body)};
  observations.set(release.id,observation);res.end(JSON.stringify({observation}));
 }else if(req.method==='GET'&&parts[5]==='observations')res.end(JSON.stringify({observation:observations.get(release.id)}));
 else if(req.method==='GET'&&parts[5]==='gate')res.end(JSON.stringify({deployed:observations.has(release.id),actual_matches:observations.has(release.id),current_observation_id:observations.get(release.id)?.id}));
 else if(req.method==='GET'&&parts.length===5)res.end(JSON.stringify({release}));
 else {res.end('{}');}

});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const child=spawn('bash',[deploy],{stdio:['ignore','inherit','inherit'],env:{...process.env,PATH:`${bin}:${process.env.PATH}`,WF_DEPLOY_STATE_DIR:join(scratch,'state'),WF_RELEASE_IDS:JSON.stringify(ids),WF_DEPLOY_ENVIRONMENT:'fixture',WF_DEPLOY_COLLECTOR:'fixture',WF_DEPLOY_ATTEMPT_KEY:'smoke',BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-deploy-only'}});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code===null?1:code));});
}finally{server.close();rmSync(scratch,{recursive:true,force:true});}
