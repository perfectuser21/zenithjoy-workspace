import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const [action,path]=process.argv.slice(2),saved=JSON.parse(fs.readFileSync(path)),plan=saved.plan;
const api=await import(pathToFileURL(join(saved.runtime,'device-epoch-fence-resume-process.mjs')));
const context={instance_id:plan.new_instance.instance_id,endpoint:plan.new_instance.policy.endpoint,source_commit:plan.source_authority.commit,policy_path:plan.new_instance.policy_path,policy_sha256:plan.new_instance.policy_sha256,supervisor_source:plan.resume_service_source};
const actual=saved.ready.actual,read=document=>api.invokeResumeProcessHelper({...context,...document},plan);
const terminal=()=>{try{const f=read({action:'terminal',expected:actual});return f.selected_identities_absent&&f.listener_absent&&f.instance_locks_released;}catch{return false;}};
const assertBirth=row=>{for(const key of ['pid','uid','kernel_start','argv_sha256','executable','executable_sha256'])assert.deepEqual(row[key],actual.supervisor[key]);};
if(action==='observe'){
  let row;try{row=read({action:'kernel',pid:actual.supervisor.pid}).identity;}catch{console.log(JSON.stringify({supervisor_alive:false,terminal:terminal(),field_actions:0}));process.exit(0);}
  assertBirth(row);
  const grouping=JSON.parse(execFileSync(plan.execution_context.python.path,['-I','-B','-S','-c','import os,json; p='+actual.supervisor.pid+'; print(json.dumps({"pgid":os.getpgid(p),"sid":os.getsid(p)}))'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000}));
  assertBirth(read({action:'kernel',pid:actual.supervisor.pid}).identity);
  console.log(JSON.stringify({supervisor_alive:true,...grouping,supervisor_pid:row.pid,birth_preserved:true,argv_preserved:true,field_actions:0}));
}else if(action==='cleanup'){
  if(!terminal()){
    // Parent death legitimately reparents this same supervisor. Keep every
    // immutable identity/argv field and the exact child→supervisor parent link.
    const adopted={supervisor:Object.fromEntries(Object.entries(actual.supervisor).filter(([k])=>k!=='ppid')),child:actual.child};
    const fresh=read({action:'inspect',expected:adopted});assertBirth(fresh.actual.supervisor);
    process.kill(actual.supervisor.pid,'SIGTERM');
    for(let n=0;n<100&&!terminal();n++)await new Promise(r=>setTimeout(r,50));
    assert.ok(terminal(),'EXACT_FIXTURE_TERMINAL_REQUIRED');
  }
  console.log(JSON.stringify({terminal:true,field_actions:0}));
}else throw Error('PRIVATE_SESSION_CHECKER_ACTION');
