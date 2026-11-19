import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {phoneLockFixtureEnv} from './helpers/phone-lock-fixture.mjs';
const script=new URL('../douyin-phone-adb',import.meta.url).pathname;
const source=readFileSync(script,'utf8');
const functions=source.slice(source.indexOf('normalize_run_id() {'),source.indexOf('# 设备锁 TTL（秒）'));
assert.match(functions,/same_run_lock\(\)/);
const shell=(body,args=[])=>spawnSync('zsh',['-f','-c','setopt EXTENDED_GLOB\n'+functions+'\n'+body,'uuid-test',...args],{encoding:'utf8',timeout:5000});
const original='8d4e2d9d-0de3-4865-a377-6eff535e160a';
const roots=[original,'a1234567-0de3-4865-b377-6eff535e160a','8d4e2d9d-a123-4865-b377-6eff535e160a','8d4e2d9d-0de3-a123-b377-6eff535e160a','8d4e2d9d-0de3-4865-b377-a12345678901'];
test('actual zsh preserves complete UUID roots with a-digit segments at every position',()=>{
 const cases=[];
 for(const uuid of roots)for(const prefix of ['','wf102-','batch_root_'])for(const suffix of ['',':a2','-a2-qualification-1','_a3_cleanup_1','-w12'])cases.push([prefix+uuid+suffix,prefix+uuid]);
 const r=shell('for value in "$@"; do normalize_run_id "$value"; done',cases.map(x=>x[0]));assert.equal(r.status,0,r.stderr);assert.deepEqual(r.stdout.trimEnd().split('\n'),cases.map(x=>x[1]));
});
test('different full UUIDs and unrecognized tails never share a run lock',()=>{
 const root='wf102-'+original,other=['wf102-8d4e2d9d-0de3-4865-a378-6eff535e160a','wf102-8d4e2d9d-0de3-4865-a377-6eff535e160b','wf102-8d4e2d9d-0de3-4865',root+'-extra',root+'-a2',root+'-wX'];
 for(const value of other){const r=shell('same_run_lock "$1" "$2"',[root,value]);assert.equal(r.status,1,value+' must remain distinct');}
 for(const tail of ['-extra','-a2','-wX'])assert.equal(shell('normalize_run_id "$1"',[root+tail]).stdout.trimEnd(),root+tail);
});
test('legacy attempts, word suffixes and managed qiumi roots retain their original mappings',()=>{
 const cases=[['legacy:a2','legacy'],['legacy-a12-preflight-1','legacy'],['legacy_a2_cleanup_1','legacy'],['legacy-w12','legacy'],['legacy-w2-a3-cleanup-1','legacy'],['qiumi-a1234567-1791427263848-a2-preflight-1','qiumi-a1234567-1791427263848'],['qiumi-a1234567-1791427263848','qiumi-a1234567-1791427263848']];
 const r=shell('for value in "$@"; do normalize_run_id "$value"; done',cases.map(x=>x[0]));assert.equal(r.status,0,r.stderr);assert.deepEqual(r.stdout.trimEnd().split('\n'),cases.map(x=>x[1]));
});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'phone-lock-uuid-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const registry=join(root,'registry.tsv'),adb=join(root,'adb'),calls=join(root,'calls');
 writeFileSync(registry,'p1\tSER1\tMODEL\t1199\t2663\n');
 writeFileSync(adb,'#!/bin/sh\nprintf called >> "$UUID_ADB_CALLS"\nexit 99\n',{mode:0o700});
 const python=spawnSync('sh',['-c','command -v python3'],{encoding:'utf8'}).stdout.trim();
 const env={...process.env,...phoneLockFixtureEnv(registry,join(root,'tmp')),DOUYIN_ADB_BIN:adb,DOUYIN_PYTHON_BIN:python,UUID_ADB_CALLS:calls};
 const run=(...args)=>spawnSync('zsh',[script,'--profile','p1',...args],{env,encoding:'utf8',timeout:10000});
 return {root,run,lock:join(root,'tmp/locks/SER1.lock'),calls};
}
test('actual fresh acquire, renew and exact release retain the full UUID owner without phone calls',t=>{
 const f=fixture(t),owner='wf102-'+original,r=f.run('lock-acquire-new',owner);assert.equal(r.status,0,r.stderr);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),owner+'\n');assert.match(r.stdout,new RegExp('lock=acquired owner='+owner));
 assert.equal(f.run('lock-refresh',owner).status,0);
 for(const other of ['wf102-8d4e2d9d-0de3-4865',owner+'-a1-cleanup-1','wf102-8d4e2d9d-0de3-4865-a378-6eff535e160a']){
  assert.notEqual(f.run('lock-refresh',other).status,0);assert.notEqual(f.run('lock-release-exact',other).status,0);assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),owner+'\n');
 }
 assert.equal(f.run('lock-release-exact',owner).status,0);assert.ok(!existsSync(f.lock));assert.ok(!existsSync(f.calls));
});
test('actual compatible acquire cannot adopt a different UUID sharing the former truncated prefix',t=>{
 const f=fixture(t),owner='wf102-'+original,other='wf102-8d4e2d9d-0de3-4865-a378-6eff535e160a';assert.equal(f.run('lock-acquire',owner).status,0);
 assert.notEqual(f.run('lock-acquire',other).status,0);assert.notEqual(f.run('lock-refresh',other).status,0);assert.notEqual(f.run('lock-release',other).status,0);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),owner+'\n');assert.equal(f.run('lock-release',owner+'-a2-cleanup-1').status,0);assert.ok(!existsSync(f.calls));
});
