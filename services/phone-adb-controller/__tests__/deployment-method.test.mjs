import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {digest} from '../runtime-definition.mjs';
import {brainRequest} from '../deployment-preflight.mjs';
import {fixture} from './deployment-unified.test.mjs';
const sha='a'.repeat(40),repo='perfectuser21/zenithjoy-workspace';
const home='/Users/administrator',bytes=Buffer.from('real deployed bytes\n');
test('历史方法正式prepare保留完整Pilot计划；独立target安装观测由实物出发并精确回读',async t=>{
 const {prepareMethodRelease,observeMethod}=await import('../deployment-method.mjs');
 const bundle=fixture().commander;let release,observation;const posts=[];
 const server=createServer(async(req,res)=>{let body;for await(const c of req)body=(body||'')+c;body=body&&JSON.parse(body);let out;
  assert.equal(req.headers.authorization,'Bearer fixture-token');
  if(body){posts.push({path:req.url,body});if(req.url==='/api/brain/releases'){
   const workflows=bundle.snapshot.definitions.workflows.filter(w=>body.workflows.some(v=>v.workflow_definition_version_id===w.id));const ids=new Set(workflows.flatMap(w=>w.payload.activities).map(a=>a.activity_version_id));
   release={id:'release-method',environment:body.environment,target:body.target,payload:{workflows,activities:bundle.snapshot.definitions.activities.filter(a=>ids.has(a.id)),components:body.components,verification:{status:'verified'}}};release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});out={release};
  }else {observation={id:'obs-method',release_id:release.id,payload:body};out={observation};}}
  else if(req.url.endsWith('/gate'))out={deployed:true,actual_matches:true,current_observation_id:'obs-method'};
  else if(req.url.includes('/observations/'))out={observation};else out={release};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(out));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const brainUrl=`http://127.0.0.1:${server.address().port}`,request=brainRequest(brainUrl,'fixture-token');
 const plan=await prepareMethodRelease({evidence:bundle,sha,workflowKey:'workflow_report.internal',runId:123,readFile:()=>bytes,request});
 assert.match(plan.release.target,/^mmv--method--[a-f0-9]{64}$/);assert.equal(plan.release.payload.workflows.length,1);
 assert.deepEqual(posts[0].body.ci_evidence[0].report,bundle.report,'不能把完整scope报告裁成目标workflow');
 const root=home+'/.local/share/zenithjoy/commander-methods/'+plan.method_manifest_sha256;
 const bindings=plan.method_manifest.bindings.map(b=>({...b,absolute_path:root+'/'+b.path}));
 const files=bindings.map(b=>({path:b.path,deployed_path:b.path,content_sha256:b.digest.slice(7)}));
 const installation={source_repo:repo,source_commit:sha,files,observed_hostname:'aad17-2',physical_host:'mmv',method_root:root,root_identity:{st_dev:1,st_ino:9},file_identities:bindings.map((b,i)=>({path:b.absolute_path,st_dev:1,st_ino:i+10})),manifest_sha256:plan.method_manifest_sha256,resolved_bindings_sha256:digest(bindings)};
 const observed={source_repo:repo,source_commit:sha,files,observed_hostname:'aad17-2',installation,method_instance:{target:plan.release.target,physical_host:'mmv',method_root:root,manifest_sha256:plan.method_manifest_sha256,resolved_bindings:bindings,resolved_bindings_sha256:digest(bindings),installation_sha256:digest(installation)}};
 const stateDir=mkdtempSync(join(tmpdir(),'method-observe-'));
 const options={plan,request,brainUrl,stateDir,attemptKey:'github:123:method-fixture',home,collect:async()=>observed};
 const ack=await observeMethod(options);assert.equal(ack.target,plan.release.target);assert.equal(posts[1].body.target,plan.release.target);
 const ref=JSON.parse(posts[1].body.evidence_ref.slice('commander-method-v1:'.length));assert.equal(ref.installation_sha256,digest(installation));
 const original=JSON.parse(readFileSync(join(stateDir,readdirSync(stateDir).find(x=>x.endsWith('.evidence.json')))));assert.deepEqual(original.installation,installation);
 for(const mutate of [o=>o.observed_hostname='m4-xian.local',o=>o.method_instance.method_root='/tmp/fake',o=>o.method_instance.resolved_bindings[0].absolute_path='/current/helper.py',o=>o.installation.root_identity.st_ino=99,o=>o.files[0].content_sha256='0'.repeat(64)]){
  const bad=structuredClone(observed);mutate(bad);await assert.rejects(observeMethod({...options,collect:async()=>bad}));
 }
 assert.equal(posts.length,2,'伪实例在POST之前拒绝');
 for(const mutate of [e=>e.receipt.assertions=[],e=>e.report.assertion_source='historical_cache',e=>e.snapshot.definitions.activities.pop()]){const bad=structuredClone(bundle);mutate(bad);await assert.rejects(prepareMethodRelease({evidence:bad,sha,workflowKey:'workflow_report.internal',runId:123,readFile:()=>bytes,request}));}
 assert.equal(posts.length,2);
});
