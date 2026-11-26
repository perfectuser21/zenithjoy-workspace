import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as candidate from '../deployment-candidate.mjs';
import {transportFixture} from './candidate-transport-fixture.mjs';
test('真实大包安装入口为西安分配300秒有界预算，MMV和读回预算保持原值',t=>{
 const f=transportFixture(t,{payloadBytes:2867200}),result=f.run('normal');assert.equal(result.ok,true,JSON.stringify(result));
 const calls=readFileSync(join(f.top,'ssh-options.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const mmv=calls.find(c=>c.host==='mmv'&&c.install),xian=calls.find(c=>c.host==='xian-m4'&&c.install);
 assert.ok(xian.input_bytes>=2867200);assert.equal(xian.timeout,300000,'原120秒会中断已实证166秒完成的正常传输');
 assert.equal(mmv.timeout,120000);assert.ok(calls.filter(c=>!c.install).every(c=>c.timeout<=60000));
});
test('预算随包大小增加且始终限制在120–300秒，异常尺寸拒绝',()=>{
 const budget=candidate.candidateInstallTimeout;
 assert.equal(budget(1024),120000);assert.ok(budget(1024*1024)>120000);assert.equal(budget(2867200),300000);
 assert.equal(budget(128*1024*1024),300000);
 for(const value of [0,-1,1.5,NaN,Infinity,128*1024*1024+1])assert.throws(()=>budget(value),/archive size/);
});

test('西安普通候选按远端收包延长预算，慢传仍完成原安装与回执',t=>{
 const f=transportFixture(t),result=f.run('install-progress-slow');
 assert.equal(result.ok,true,JSON.stringify(result));
 const calls=f.calls().filter(c=>c.host==='xian-m4');
 assert.equal(calls.filter(c=>c.archive).length,1);
 assert.equal(calls.filter(c=>c.collect).length,1);
 assert.ok(result.result.observation_ids['xian-m4']);
});
for(const [mode,reason] of [['stall','no receive progress'],['limit','transfer deadline'],['truncated','/install: 1'],['corrupt','/install: 1'],['malformed','invalid receive receipt']])test('西安候选拒绝无法完整核验的传输：'+mode,t=>{
 const f=transportFixture(t),result=f.run('install-progress-'+mode);
 assert.equal(result.ok,false);assert.match(result.error,new RegExp(reason));
 const calls=f.calls().filter(c=>c.host==='xian-m4');
 assert.equal(calls.filter(c=>c.archive).length,1);
 assert.equal(calls.filter(c=>c.collect||c.manifest).length,0);
 const base=join(f.top,'remote-xian-m4/.local/share/zenithjoy/phone-candidates');
 assert.equal(existsSync(join(base,f.revision)),false);
 assert.deepEqual(existsSync(base)?readdirSync(base):[],[]);
});
