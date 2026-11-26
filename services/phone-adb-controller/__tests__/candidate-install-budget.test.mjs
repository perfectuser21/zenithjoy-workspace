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

test('有实收进度的西安候选按包大小获得有界总预算',()=>{
 const budget=bytes=>candidate.candidateInstallTimeout(bytes,{progressive:true});
 assert.equal(budget(1024),12*60_000);
 assert.equal(budget(11_530_240),1_216_000);
 assert.equal(budget(128*1024*1024),22*60_000);
 assert.throws(()=>budget(128*1024*1024+1),/archive size/);
});

test('西安普通候选按远端收包延长预算，慢传仍完成原安装与回执',t=>{
 const f=transportFixture(t),result=f.run('install-progress-slow');
 assert.equal(result.ok,true,JSON.stringify(result));
 const calls=f.calls().filter(c=>c.host==='xian-m4');
 assert.equal(calls.filter(c=>c.archive).length,1);
 assert.equal(calls.filter(c=>c.collect).length,1);
 assert.ok(result.result.observation_ids['xian-m4']);
});
test('西安完整候选与生产同等大小，持续接收超过旧720秒仍可完整校验和ACK',t=>{
 // The larger collector closure takes three extra tar records. Keep the original fixture archive size.
 const f=transportFixture(t,{payloadBytes:10_795_840}),result=f.run('install-progress-live-sized');
 assert.equal(result.ok,true,JSON.stringify(result));
 const calls=f.calls().filter(c=>c.host==='xian-m4');
 const transfers=calls.filter(c=>c.archive);
 assert.equal(transfers.length,1);
 assert.ok(Math.abs(transfers[0].input_bytes-11_530_240)<=10_240,`production-sized tar received ${transfers[0].input_bytes} bytes`);
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
