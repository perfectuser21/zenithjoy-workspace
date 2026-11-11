import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlan,inspectRuntime} from '../video-tools-release.mjs';

const nodes=['ZenithJoyUploadImage','ZenithJoyImage2','ZenithJoyLoadAsset','ZenithJoyChooseAsset','ZenithJoyWan','ZenithJoyWanRemake','ZenithJoyVideoProject','ZenithJoyVideoSegment','ZenithJoySegmentRemake','ZenithJoyApproveSegment','ZenithJoyAssembleVideo'];
const templates=['image2-select-wan.json','upload-image-wan.json','video-remake-wan.json','short-video-wan.json'];
const roster={schema_version:1,source_commit:'a'.repeat(40),environment:'staging',origin:'https://stage.example.com',providers:Object.fromEntries(['DASHSCOPE_API_KEY','ALIYUN_ACCESS_KEY_ID','ALIYUN_ACCESS_KEY_SECRET','COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','COS_REGION'].map(k=>[k,'fixture'])),users:[{id:'one',email:'one@example.com',token:'a'.repeat(40)},{id:'two',email:'two@example.com',token:'b'.repeat(40)}]};
function httpPrelude(responses){return `import json,io,urllib.request\nfixtures=json.loads(${JSON.stringify(JSON.stringify(responses))})\nclass Reply(io.BytesIO):\n status=200\ndef open_fixture(url,timeout):\n from urllib.parse import urlparse\n assert timeout<=5\n key=urlparse(url).path\n if key not in fixtures: raise RuntimeError('fixture HTTP 404')\n return Reply(json.dumps(fixtures[key]).encode())\nurllib.request.urlopen=open_fixture\n`;}
function fixture({missingNode,missingTemplate,malformed=false,empty=false}={}){
 const plan=createPlan(roster,{sha:roster.source_commit,image:'sha256:'+'b'.repeat(64)}),calls=[];
 const exec=(command,args)=>{
  assert.equal(command,'docker');
  if(args[0]==='inspect'){
   const service=Object.values(plan.compose.services).find(s=>s.container_name===args[1]);assert.ok(service);
   return JSON.stringify([{Image:plan.image,Config:{Env:Object.entries(service.environment).map(([k,v])=>k+'='+v)},State:{Health:{Status:'healthy'}},HostConfig:{PortBindings:{}},NetworkSettings:{Networks:Object.fromEntries(service.networks.map(n=>[n,{}]))},Mounts:[{Destination:'/data',Name:service.volumes[0].split(':')[0]}]}]);
  }
  if(args[0]==='network'&&args[1]==='inspect')return JSON.stringify([{Containers:{}}]);
  assert.deepEqual(args.slice(0,1),['exec']);assert.ok(Object.values(plan.compose.services).some(s=>s.container_name===args[1]));assert.deepEqual(args.slice(2,4),['python','-c']);calls.push(args[1]);
  if(empty)return '';
  // Execute the exact Python delivered to the container, replacing only HTTP I/O.
  const responses=Object.fromEntries([['/object_info',malformed?[]:Object.fromEntries(nodes.filter(n=>n!==missingNode).map(n=>[n,{}]))],...templates.filter(n=>n!==missingTemplate).map(n=>['/extensions/zenithjoy/'+n,{nodes:[],links:[]}])]);
  const prelude=httpPrelude(responses);
  const result=spawnSync('python3',['-c',prelude+args[4]],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);
  return result.stdout;
 };
 return {plan,calls,exec};
}
test('employee verification probes every private instance using fixed source nodes and templates',()=>{
 const f=fixture();assert.equal(inspectRuntime(f.plan,false,f.exec).verified,true);assert.deepEqual(f.calls,Object.values(f.plan.compose.services).map(s=>s.container_name));
});
test('healthy employee container cannot pass with any missing required node',()=>{
 for(const missingNode of nodes){const f=fixture({missingNode});assert.throws(()=>inspectRuntime(f.plan,false,f.exec),undefined,missingNode);}
});
test('healthy employee container cannot pass with a missing template, malformed object_info or empty probe reply',()=>{
 for(const missingTemplate of templates){const f=fixture({missingTemplate});assert.throws(()=>inspectRuntime(f.plan,false,f.exec),undefined,missingTemplate);}
 for(const options of [{malformed:true},{empty:true}]){const f=fixture(options);assert.throws(()=>inspectRuntime(f.plan,false,f.exec));}
});
test('standalone deploy uses the same fixed source capability probe as employee verification',()=>{
 const shell=readFileSync('scripts/deploy/hk-canvas-staging.sh','utf8');
 assert.match(shell,/docker exec "\$CONTAINER" python -c "\$\(cat "\$SOURCE\/scripts\/deploy\/canvas-capabilities\.py"\)"/);
});
test('actual standalone probe rejects absent candidate code and missing new capabilities while preserving explicit historical rollback',t=>{
 const shell=readFileSync('scripts/deploy/hk-canvas-staging.sh','utf8');
 const handler=shell.match(/probe_capabilities\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(handler);
 const oldSource=mkdtempSync(join(tmpdir(),'canvas-old-release-'));t.after(()=>rmSync(oldSource,{recursive:true,force:true}));
 const run=({source=process.cwd(),action='deploy',missingNode,missingTemplate}={})=>{
  const responses=Object.fromEntries([['/object_info',Object.fromEntries(nodes.filter(n=>n!==missingNode).map(n=>[n,{}]))],...templates.filter(n=>n!==missingTemplate).map(n=>['/extensions/zenithjoy/'+n,{nodes:[],links:[]}])]);
  return spawnSync('bash',['-c',`docker() { [[ "$#" == 5 && "$1" == exec && "$2" == fixture && "$3" == python && "$4" == -c ]] || return 99; python3 -c "$TEST_PRELUDE$5"; }\n${handler}\nprobe_capabilities`],{encoding:'utf8',env:{...process.env,SOURCE:source,ACTION:action,CONTAINER:'fixture',TEST_PRELUDE:httpPrelude(responses)}});
 };
 assert.equal(run().status,0);
 for(const missingNode of nodes.slice(-5))assert.notEqual(run({missingNode}).status,0,missingNode);
 assert.notEqual(run({missingTemplate:'short-video-wan.json'}).status,0);
 assert.notEqual(run({source:oldSource}).status,0,'new deployment cannot silently use a legacy probe');
 assert.equal(run({source:oldSource,action:'rollback'}).status,0);
 assert.notEqual(run({source:oldSource,action:'rollback',missingNode:'ZenithJoyWan'}).status,0);
});
