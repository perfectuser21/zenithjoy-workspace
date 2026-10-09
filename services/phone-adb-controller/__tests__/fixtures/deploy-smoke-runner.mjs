// required smoke用真实HTTP预检；SSH/scp仍由外层临时桩记录，绝不接触设备。
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {digest} from '../../runtime-definition.mjs';
import {normalizedDescriptions} from './normalized-description-bindings.mjs';
const deploy=resolve(process.argv[2]),root=execFileSync('git',['-C',resolve(deploy,'..'),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const repo='perfectuser21/zenithjoy-workspace',path='services/phone-adb-controller/douyin-phone-adb';
const activity='33333333-3333-4333-8333-333333333333',av='44444444-4444-4444-8444-444444444444';
const ids={'xian-m4':'55555555-5555-4555-8555-555555555555','mmv':'77777777-7777-4777-8777-777777777777'};
const component={kind:'code',repo,path,revision:sha,digest:'sha256:'+digest(readFileSync(join(root,path)))};
const row=(id,payload,extra)=>({id,...extra,source_repo:repo,source_path:'fixture-only.json',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'fixture-only.json',commit:sha},payload})});
const definitions={workflows:[101,102,103,104].map(n=>{const id=`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;return row(id,{workflow_id:id,activities:[{activity_id:activity,activity_version_id:av}]},{workflow_id:id});}),activities:[row(av,{activity_id:activity,steps:[],implementation_bindings:[{...component,scope:'activity',status:'verified'},...normalizedDescriptions]},{activity_id:activity})]};
const releases=Object.fromEntries(Object.entries(ids).map(([target,id])=>{const payload={...definitions,components:[{kind:'repo',repo,revision:sha},component],verification:{status:'verified'}};const release={id,target,environment:'fixture',payload};release.manifest_sha256=digest({environment:release.environment,target,payload});return [id,release];}));
const server=createServer((req,res)=>{
 const release=releases[req.url.split('/').at(-1)];
 if(req.method!=='GET'||req.headers.authorization!=='Bearer fixture-deploy-only'||!release){res.writeHead(404);res.end('{}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({release}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const child=spawn('bash',[deploy],{stdio:['ignore','inherit','inherit'],env:{...process.env,WF_RELEASE_IDS:JSON.stringify(ids),WF_DEPLOY_ENVIRONMENT:'fixture',WF_DEPLOY_COLLECTOR:'fixture',WF_DEPLOY_ATTEMPT_KEY:'smoke',BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-deploy-only'}});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code||0));});
}finally{server.close();}
