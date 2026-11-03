import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPublishProfile} from '../publish-runner-adapter.mjs';
test('publishing requires fixed Activity executors and independent validators, never whole-workflow agent fallback',()=>{
 assert.throws(()=>buildPublishProfile({contract:{workflow:'publish',activities:[{key:'publish',order:1}]},implementations:{}}),/publish_activity_binding_required/);
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const fixture=()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'publish-profile-'));
 const entries=['exec.mjs','validator.mjs','precondition.mjs','skill.md'];
 const components=entries.map(entry=>{fs.writeFileSync(path.join(cwd,entry),entry);return {path:entry,revision:'a'.repeat(40),digest:'sha256:'+createHash('sha256').update(entry).digest('hex')};});
 const bind=entry=>({entry,sha256:components.find(c=>c.path===entry).digest.slice(7)});
 const questions=Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1'].map(key=>[key,{ref:key,version:'1',declared:{fixed:true}}]));
 const input={cwd,contract:{workflow:'publish',activities:[{key:'publish',order:3,budget:{max_duration_s:20,heartbeat_s:1}},{key:'cleanup',order:5,budget:{max_duration_s:20,heartbeat_s:1}}],resources:{device_serial:'fixed'}},definition:{workflow_id:randomUUID(),workflow_definition_version_id:randomUUID()},activityBindings:['publish','cleanup'].map(key=>({key,reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()})),components,implementations:{}};
 for(const key of ['publish','cleanup'])input.implementations[key]={executor:{...bind('exec.mjs'),kind:'agent',skill:{...bind('skill.md'),version:'1.0.0'}},validator:{...bind('validator.mjs'),acceptance:{ref:'cleanup'}},precondition:bind('precondition.mjs'),questions};
 input.implementations.workflow={validator:{...bind('validator.mjs'),acceptance:{ref:'workflow'}}};
 return input;
};
test('builds fixed file order with no replay of outward publish',()=>{const x=fixture();try{const p=buildPublishProfile(x);assert.deepEqual(p.contract.activities.map(a=>a.key),['publish','cleanup']);assert.equal(p.contract.activities[0].runtime.max_attempts,1);assert.equal(p.contract.activities[0].runtime.recovery_safe,false);assert.equal(p.contract.activities[1].runtime.phase,'finalize');assert.equal(p.metadata.publish.identity.activity_definition_version_id,x.activityBindings[0].activity_definition_version_id);}finally{fs.rmSync(x.cwd,{recursive:true,force:true});}});
test('rejects worker input trying to substitute an unpinned skill',()=>{const x=fixture();try{x.implementations.publish.executor.skill.entry='../external.md';assert.throws(()=>buildPublishProfile(x),/source_binding_invalid/);}finally{fs.rmSync(x.cwd,{recursive:true,force:true});}});
test('rejects filesystem replacement after source was frozen',()=>{const x=fixture();try{fs.writeFileSync(path.join(x.cwd,'exec.mjs'),'changed');assert.throws(()=>buildPublishProfile(x),/source_changed/);}finally{fs.rmSync(x.cwd,{recursive:true,force:true});}});
test('rejects worker self-validation',()=>{const x=fixture();try{x.implementations.publish.validator=x.implementations.publish.executor;assert.throws(()=>buildPublishProfile(x),/independent/);}finally{fs.rmSync(x.cwd,{recursive:true,force:true});}});
test('native phase CLI rejects command injection and performs no SSH action',()=>{
 const result=spawnSync('python3',['services/phone-adb-controller/commander/publish-native-activity.py','publish;echo wrong','/missing/manifest.json'],{input:JSON.stringify({run_tag:randomUUID()}),encoding:'utf8'});
 assert.equal(result.status,0);const parsed=JSON.parse(result.stdout);assert.equal(parsed.status,'needs_review');assert.equal(parsed.reason_code,'publish_native_unconfirmed');assert.equal(parsed.execution_stopped,undefined);assert.equal(parsed.external_effect,undefined);
});
test('real native Activity processes preserve phone owner, native receipts and exact cleanup boundary',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'publish-native-')),bin=path.join(root,'bin');fs.mkdirSync(bin);
 const ownerFile=path.join(root,'owner');fs.writeFileSync(ownerFile,'free');
 fs.writeFileSync(path.join(bin,'ssh'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.at(-1),f=process.env.FIXTURE_PHONE_OWNER,owner=fs.readFileSync(f,'utf8');
if(a.includes('cat ')&&a.endsWith('.png'))process.stdout.write(Buffer.from('89504e470d0a1a0a49454e44ae426082','hex'));
else if(a.includes('cat ')&&a.endsWith('.xml'))console.log('<hierarchy><node package="fixture.launcher"/></hierarchy>');
else if(a.includes('lock-status'))console.log(owner==='free'?'lock=free':'lock=held owner='+owner);
else if(a.includes('lock-acquire')){fs.writeFileSync(f,a.split(' ').at(-1));console.log('acquired');}
else if(a.includes('lock-release')){if(a.split(' ').at(-1)!==owner)process.exit(7);fs.writeFileSync(f,'free');console.log('released');}
else if(a.includes('account-current'))console.log('nickname=人工智能小诺考评');
else if(a.includes('return-safe-desktop'))console.log('launcher=fixture.launcher\\nforeground_package=fixture.launcher');
else if(a.includes('preflight'))console.log('serial=ANGYVB4402004137 state=device');
else console.log('native receipt');
`,{mode:0o700});
 const run=randomUUID(),task=randomUUID(),ids=['preflight','cleanup'].map(key=>({key,reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID(),steps:[]}));
 const manifest={state_root:path.join(root,'runs'),contract:{resources:{machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'}},definition:{expected_path:ids.map(({key,steps,...rest})=>rest)},activity_bindings:ids};
 const file=path.join(root,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 const invoke=phase=>spawnSync('python3',['services/phone-adb-controller/commander/publish-native-activity.py',phase,file],{input:JSON.stringify({run_tag:run,task_id:task,publication_input:{title:'fixed'}}),encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,FIXTURE_PHONE_OWNER:ownerFile}});
 try{
  const first=invoke('preflight');assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).status,'completed',first.stdout);assert.equal(fs.readFileSync(ownerFile,'utf8'),run);
  const second=invoke('cleanup');assert.equal(JSON.parse(second.stdout).status,'completed',second.stdout);assert.equal(fs.readFileSync(ownerFile,'utf8'),'free');
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'runs',run,'cleanup.json'),'utf8'));assert.equal(evidence.lock_status,'free');assert.equal(evidence._shell.run_id,run);
  const events=JSON.parse(fs.readFileSync(path.join(root,'runs',run,'events.json'),'utf8'));assert.equal(events.filter(e=>e.type==='activity_completed').length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native SSH timeout preserves unknown remote execution so core cannot run cleanup',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'publish-unknown-')),bin=path.join(root,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'ssh'),'#!/bin/sh\nsleep 3\n',{mode:0o700});
 const b={key:'preflight',reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID(),steps:[]};
 const manifest={state_root:path.join(root,'runs'),contract:{resources:{machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'},recovery:{total_timeout_sec:1,cleanup_timeout_sec:1}},definition:{expected_path:[{reference_id:b.reference_id,activity_id:b.activity_id,activity_definition_version_id:b.activity_definition_version_id}]},activity_bindings:[b]};
 const file=path.join(root,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 try{const result=spawnSync('python3',['services/phone-adb-controller/commander/publish-native-activity.py','preflight',file],{input:JSON.stringify({run_tag:randomUUID(),task_id:randomUUID()}),encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}});const value=JSON.parse(result.stdout);assert.equal(value.execution_stopped,false);assert.equal(value.external_effect,'unknown');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native SSH255 after remote acceptance retains unknown execution and original transport evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'publish-disconnected-')),bin=path.join(root,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'ssh'),'#!/bin/sh\nprintf accepted > "$FIXTURE_ACCEPTED"\nprintf "connection lost after acceptance\\n" >&2\nexit 255\n',{mode:0o700});
 const b={key:'preflight',reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID(),steps:[]};
 const manifest={state_root:path.join(root,'runs'),contract:{resources:{machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'}},definition:{expected_path:[{reference_id:b.reference_id,activity_id:b.activity_id,activity_definition_version_id:b.activity_definition_version_id}]},activity_bindings:[b]};
 const file=path.join(root,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 try{
  const result=spawnSync('python3',['services/phone-adb-controller/commander/publish-native-activity.py','preflight',file],{input:JSON.stringify({run_tag:randomUUID(),task_id:randomUUID()}),encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,FIXTURE_ACCEPTED:path.join(root,'accepted')}});
  const value=JSON.parse(result.stdout);assert.equal(fs.readFileSync(path.join(root,'accepted'),'utf8'),'accepted');assert.equal(value.execution_stopped,false);assert.equal(value.external_effect,'unknown');assert.ok(value.evidence.some(p=>p.endsWith('.stderr')&&fs.readFileSync(p,'utf8').includes('connection lost after acceptance')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('cleanup disconnect enters persistent readback-only isolation before native finally can release the phone',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'publish-cleanup-isolated-')),bin=path.join(root,'bin');fs.mkdirSync(bin);
 const ownerFile=path.join(root,'owner'),callsFile=path.join(root,'calls');fs.writeFileSync(ownerFile,'free');
 fs.writeFileSync(path.join(bin,'ssh'),`#!/usr/bin/env node
const fs=require('fs'),command=process.argv.at(-1),ownerFile=process.env.FIXTURE_PHONE_OWNER;
fs.appendFileSync(process.env.FIXTURE_CALLS,command+'\\n');
if(command.includes('lock-status')){const owner=fs.readFileSync(ownerFile,'utf8');console.log(owner==='free'?'lock=free':'lock=held owner='+owner);}
else if(command.includes('lock-acquire')){fs.writeFileSync(ownerFile,command.split(' ').at(-1));console.log('acquired');}
else if(command.includes('lock-release')){fs.writeFileSync(ownerFile,'free');console.log('released');}
else if(command.includes('account-current'))console.log('nickname=人工智能小诺考评');
else if(command.includes('close-app')){fs.writeFileSync(process.env.FIXTURE_ACCEPTED,'accepted');console.error('disconnect after close accepted');process.exit(255);}
else if(command.includes('preflight'))console.log('serial=ANGYVB4402004137 state=device');
else console.log('native receipt');
`,{mode:0o700});
 const run=randomUUID(),task=randomUUID(),ids=['preflight','cleanup'].map(key=>({key,reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID(),steps:[]}));
 const manifest={state_root:path.join(root,'runs'),contract:{resources:{machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'}},definition:{expected_path:ids.map(({key,steps,...rest})=>rest)},activity_bindings:ids};
 const file=path.join(root,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 const invoke=phase=>JSON.parse(spawnSync('python3',['services/phone-adb-controller/commander/publish-native-activity.py',phase,file],{input:JSON.stringify({run_tag:run,task_id:task}),encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,FIXTURE_PHONE_OWNER:ownerFile,FIXTURE_CALLS:callsFile,FIXTURE_ACCEPTED:path.join(root,'accepted')}}).stdout);
 try{
  assert.equal(invoke('preflight').status,'completed');fs.writeFileSync(callsFile,'');
  const first=invoke('cleanup');assert.equal(first.execution_stopped,false);assert.equal(first.external_effect,'unknown');assert.equal(fs.readFileSync(path.join(root,'accepted'),'utf8'),'accepted');assert.equal(fs.readFileSync(ownerFile,'utf8'),run);
  const firstCalls=fs.readFileSync(callsFile,'utf8').trim().split('\n');const index=firstCalls.findIndex(c=>c.includes('close-app'));assert.ok(index>=0);assert.ok(firstCalls.slice(index+1).every(c=>c.includes('lock-status')));assert.ok(firstCalls.every(c=>!c.includes('lock-release')));
  const latch=JSON.parse(fs.readFileSync(path.join(root,'runs',run,'native-transport-unknown.json'),'utf8'));assert.equal(latch.run_id,run);assert.equal(latch.task_id,task);
  fs.writeFileSync(callsFile,'');const second=invoke('cleanup');assert.equal(second.execution_stopped,false);assert.equal(second.external_effect,'unknown');assert.equal(fs.readFileSync(ownerFile,'utf8'),run);
  assert.ok(fs.readFileSync(callsFile,'utf8').trim().split('\n').filter(Boolean).every(c=>c.includes('lock-status')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
