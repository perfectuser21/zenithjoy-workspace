import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRpc,RPC_FILES} from '../leadgen-client.mjs';
import {runWorkflow} from '../leadgen-workflow.mjs';

test('真实 Commander → RPC CLI → client → Workflow 保留停止未知并隔离',async()=>{
 const sourceRoot=resolve('services/phone-adb-controller'),d=mkdtempSync(join(tmpdir(),'commander-rpc-unknown-')),root=join(d,'runtime');
 const home=join(d,'home'),bin=join(d,'bin'),commit='a'.repeat(40);
 mkdirSync(bin,{recursive:true});mkdirSync(root);
 for(const file of RPC_FILES){const target=join(root,file);mkdirSync(dirname(target),{recursive:true});
  if(existsSync(join(sourceRoot,file)))copyFileSync(join(sourceRoot,file),target);else writeFileSync(target,'fixture frozen dependency\n');}
 writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify({source_commit:commit}));
 for(const directory of ['.openclaw/commander','openclaw-root/workspaces-root/clawd-work-commander'])
  for(const file of ['AGENTS.md','skills/workflow-commander/SKILL.md']){
   const target=join(home,directory,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,'commander',file),target);
  }
 const fake=join(bin,'openclaw'),called=join(d,'openclaw-called');
 writeFileSync(fake,`#!/bin/sh\nprintf x >> ${JSON.stringify(called)}\nnode -e "setTimeout(()=>{},1000)" >/dev/null 2>&1 &\nexit 7\n`,{mode:0o755});
 const preload=join(d,'preload.cjs');
 writeFileSync(preload,`const os=require('os'),Module=require('module');os.homedir=()=>${JSON.stringify(home)};Module.syncBuiltinESMExports();`);
 const source={deployment:{source_commit:commit},files:Object.fromEntries(RPC_FILES.map(path=>['runtime/'+path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]))};
 const oldHome=process.env.WF_HOME;process.env.WF_HOME=realpathSync(root);
 let calls=0,cleaned=0,quarantined=0;const replies=[];
 try{
  const rpc=createRpc({frozen:source,local:true,execute:async(_command,_args,opts)=>{
   calls++;
   const r=spawnSync(process.execPath,['--require',preload,realpathSync(join(root,'leadgen-rpc.mjs'))],{input:opts.input,encoding:'utf8',timeout:10000,env:{...process.env,PATH:bin+':'+process.env.PATH}});
   replies.push({status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});return {code:r.status,stdout:r.stdout,stderr:r.stderr};
  }});
  const result=await runWorkflow({context:{run_id:'rpc-unknown__a1',binding_id:'binding-one',task_id:'task-one',source_commit:commit},
   activities:[{key:'preflight'},{key:'cleanup'}],handlers:{preflight:async()=>({}),cleanup:async()=>{cleaned++;return {};}},
   commander:async receipt=>(await rpc({kind:'commander',receipt},{timeoutMs:9000})).decision,
   record:async()=>{},quarantine:async()=>{quarantined++;return {verified:true};}});
  assert.equal(calls,1,'未知原操作不得再次发起 Commander RPC');
  assert.equal(existsSync(called),true,`请求确实到达假 Commander CLI: ${JSON.stringify(replies)}`);
  assert.equal(readFileSync(called,'utf8'),'x');
  const response=JSON.parse(replies[0].stdout);assert.equal(response.error,'RPC_EXECUTION_STOP_UNKNOWN');assert.equal(response.execution_stopped,false);
  assert.equal(cleaned,0);assert.equal(quarantined,1);assert.equal(result.status,'failed');
  assert.equal(result.results.at(-1).status,'blocked');
 }finally{if(oldHome===undefined)delete process.env.WF_HOME;else process.env.WF_HOME=oldHome;rmSync(d,{recursive:true,force:true});}
});
