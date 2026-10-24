import {test}from'node:test';
import assert from'node:assert/strict';
import {readFileSync,writeFileSync,existsSync}from'node:fs';
import {join}from'node:path';
import {transportFixture}from'./candidate-transport-fixture.mjs';
const presence=c=>c.args.at(-1).includes("' presence ");
const xian=f=>f.calls().filter(c=>c.host==='xian-m4'&&presence(c));
const options=f=>readFileSync(join(f.top,'ssh-options.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
test('首个真实SSH255连接失败后同spec重连，absent仍须原安装/逐字节/ACK',t=>{
 const f=transportFixture(t),r=f.run('presence-connect-once');assert.equal(r.ok,true,JSON.stringify(r));
 const calls=xian(f);assert.equal(calls.length,3);assert.equal(calls[0].args.at(-1),calls[1].args.at(-1));
 assert.ok(calls.every(c=>c.args.includes('ConnectTimeout=10')));assert.equal(f.calls().filter(c=>c.archive).length,2);
 assert.equal(r.result.business_runtime_status,'not_evaluated');
});
test('已提交同SHA首次连接255后严格present，不重复传输安装包',t=>{
 const f=transportFixture(t);assert.equal(f.run('normal').ok,true);const n=f.calls().length;
 assert.equal(f.run('presence-connect-once').ok,true);const calls=f.calls().slice(n);assert.equal(calls.filter(c=>c.archive).length,0);assert.equal(calls.filter(c=>c.host==='xian-m4'&&presence(c)).length,2);
});
test('两次连接255封顶拒绝，不能第三次或安装西安',t=>{
 const f=transportFixture(t),r=f.run('presence-connect-always');assert.equal(r.ok,false);assert.equal(xian(f).length,2);assert.equal(f.calls().filter(c=>c.host==='xian-m4'&&c.archive).length,0);
});
for(const mode of ['presence-connect-non255','presence-connect-output'])test('非255或已有协议stdout不得新连：'+mode,t=>{
 const f=transportFixture(t),r=f.run(mode);assert.equal(r.ok,false);assert.equal(xian(f).length,1);
});
for(const mode of ['presence-connect-bad-json','presence-connect-identity','presence-connect-pending'])test('重连后的实际协议/身份/pending拒绝不得第三次：'+mode,t=>{
 const f=transportFixture(t),r=f.run(mode);assert.equal(r.ok,false);assert.equal(xian(f).length,2);assert.equal(f.calls().filter(c=>c.host==='xian-m4'&&c.archive).length,0);
 if(mode.endsWith('pending'))assert.equal(existsSync(join(f.top,'remote-xian-m4/.local/share/zenithjoy/phone-candidates','.'+f.revision+'.foreign')),true);
});
test('首255重连后原Python发现文件漂移，不能观察/改写manifest',t=>{
 const f=transportFixture(t);assert.equal(f.run('normal').ok,true);const before=f.calls().length,posts=readFileSync(join(f.top,'brain.jsonl'),'utf8');
 writeFileSync(join(f.top,'remote-xian-m4/.local/share/zenithjoy/phone-candidates',f.revision,'runtime/transport-payload.bin'),'drift');
 assert.equal(f.run('presence-connect-once').ok,false);assert.equal(f.calls().slice(before).filter(c=>c.host==='xian-m4'&&presence(c)).length,2);
 assert.equal(f.calls().slice(before).filter(c=>c.host==='xian-m4'&&(c.collect||c.manifest||c.archive)).length,0);
 // MMV正常独立观测可存在；西安不产生新的观测。
 assert.equal(readFileSync(join(f.top,'brain.jsonl'),'utf8').split('\n').filter(l=>l.includes('"target":"xian-m4"')).length,posts.split('\n').filter(l=>l.includes('"target":"xian-m4"')).length);
});
for(const mode of ['install-255','collect-255','manifest-255'])test('非presence原语255从不重试：'+mode,t=>{
 const f=transportFixture(t),r=f.run(mode);assert.equal(r.ok,false);const kind=mode.split('-')[0],calls=f.calls().filter(c=>kind==='install'?c.archive:c[kind]);assert.equal(calls.length,1);
});
test('第二连接真实挂起仅能消费剩余原30秒，不获得另一份30秒',t=>{
 const f=transportFixture(t),start=Date.now(),r=f.run('presence-connect-hang'),elapsed=Date.now()-start;
 assert.equal(r.ok,false);assert.equal(xian(f).length,2);const calls=options(f).filter(c=>c.host==='xian-m4'&&!c.install);assert.equal(calls.length,2);assert.ok(calls[0].timeout<=30000);assert.ok(calls[1].timeout<calls[0].timeout);assert.ok(elapsed<34000,'含真实fixture安装/启动的整个测试仍应有界：'+elapsed);
});
