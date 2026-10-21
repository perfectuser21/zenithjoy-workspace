import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,mkdirSync,symlinkSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {transportFixture} from './candidate-transport-fixture.mjs';
test('远端已提交而本地运输失败：同SHA重试不重传，仍真实逐字节采集和ACK',t=>{
 const f=transportFixture(t),first=f.run('lose-once');
 assert.equal(first.ok,false,JSON.stringify(first));assert.match(first.error,/ssh/i);
 const root=join(f.top,'remote-xian-m4/.local/share/zenithjoy/phone-candidates',f.revision),before=readFileSync(join(root,'runtime/transport-payload.bin'));
 assert.equal(existsSync(join(root,'candidate-identity.json')),true,'真实tar已原子提交');
 const beforeCalls=f.calls().length,count=f.calls().filter(c=>c.archive).length,second=f.run('recover');
 assert.equal(second.ok,true,JSON.stringify(second));
 assert.equal(f.calls().filter(c=>c.archive).length,count,'复用不再次传输archive');
 assert.deepEqual(readFileSync(join(root,'runtime/transport-payload.bin')),before);
 for(const host of ['mmv','xian-m4']){
  assert.ok(f.calls().slice(beforeCalls).filter(c=>c.host===host&&c.collect).length>=1);
  assert.ok(f.calls().slice(beforeCalls).some(c=>c.host===host&&c.manifest));
 }
 assert.equal(second.result.business_runtime_status,'not_evaluated');
});

function base(f,host='mmv'){return join(f.top,'remote-'+host,'.local/share/zenithjoy/phone-candidates');}
function assertPrivateSsh(calls){for(const c of calls)assert.deepEqual(c.args.slice(0,-2),['-C','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none']);}
test('权威 absent 首次安装原字节，所有SSH原语使用私有连接且完成真实ACK',t=>{
 const f=transportFixture(t),result=f.run('normal');assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(f.calls().filter(c=>c.archive).length,2);assertPrivateSsh(f.calls());
 for(const host of ['mmv','xian-m4'])assert.equal(readFileSync(join(base(f,host),f.revision,'runtime/transport-payload.bin')).length,270000);
 const posts=readFileSync(join(f.top,'brain.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(posts.length,2);
});
for(const mode of ['unknown','bad-json','late-pending','late-final'])test('未知或安装前出现同SHA写者拒绝继续：'+mode,t=>{
 const f=transportFixture(t),result=f.run(mode);assert.equal(result.ok,false);
 assert.equal(existsSync(join(base(f),f.revision)),mode==='late-final');assert.equal(f.calls().filter(c=>c.collect||c.manifest).length,0);
 if(!mode.startsWith('late-'))assert.equal(f.calls().filter(c=>c.archive).length,0);
 else if(mode==='late-pending')assert.ok(existsSync(join(base(f),'.'+f.revision+'.late-writer')),'不清除其他写者');
 else assert.equal(readFileSync(join(base(f),f.revision,'foreign-writer'),'utf8'),'preserve');
});
for(const kind of ['pending','identity','identity-mode','identity-symlink','root-symlink','runtime-symlink','missing-identity','collector-drift','content-drift'])test('已有同SHA不覆盖且不发布异常候选：'+kind,t=>{
 const f=transportFixture(t);assert.equal(f.run('normal').ok,true);
 const root=join(base(f),f.revision),identity=join(root,'candidate-identity.json');
 if(kind==='pending')mkdirSync(join(base(f),'.'+f.revision+'.unresolved'));
 if(kind==='identity')writeFileSync(identity,JSON.stringify({source_commit:f.revision,release_id:'other',manifest_sha256:'x'}));
 if(kind==='identity-mode')chmodSync(identity,0o644);
 if(kind==='missing-identity')rmSync(identity);
 if(kind==='identity-symlink'){const bytes=readFileSync(identity);rmSync(identity);writeFileSync(join(f.top,'foreign-identity'),bytes,{mode:0o600});symlinkSync(join(f.top,'foreign-identity'),identity);}
 if(kind==='root-symlink'){rmSync(root,{recursive:true});symlinkSync(f.home,root);}
 if(kind==='runtime-symlink'){rmSync(join(root,'runtime'),{recursive:true});symlinkSync(f.home,join(root,'runtime'));}
 if(kind==='collector-drift')writeFileSync(join(root,'runtime/deployment-manifest.mjs'),'console.log("fake green")');
 if(kind==='content-drift')writeFileSync(join(root,'runtime/transport-payload.bin'),'changed');
 const count=f.calls().length,posts=readFileSync(join(f.top,'brain.jsonl'),'utf8');
 const result=f.run('recover');assert.equal(result.ok,false,JSON.stringify(result));
 assert.equal(f.calls().slice(count).filter(c=>c.archive||c.collect||c.manifest).length,0);
 assert.equal(readFileSync(join(f.top,'brain.jsonl'),'utf8'),posts);
 if(kind==='pending')assert.ok(existsSync(join(base(f),'.'+f.revision+'.unresolved')));
});
test('presence 后实际内容漂移仍由原collector拒绝，不能ACK或写manifest',t=>{
 const f=transportFixture(t),result=f.run('late-drift');assert.equal(result.ok,false);
 assert.equal(existsSync(join(f.top,'brain.jsonl')),false);assert.equal(f.calls().filter(c=>c.manifest).length,0);
 assert.ok(f.calls().some(c=>c.collect));
});
test('ACK 未知不发布manifest，权威读回不能替代观察ACK',t=>{
 const f=transportFixture(t),result=f.run('ack-fail');assert.equal(result.ok,false);assert.match(result.error,/ACK unavailable/);
 assert.equal(f.calls().filter(c=>c.manifest).length,0);assert.ok(f.calls().some(c=>c.collect));
});

for(const target of ['home','candidate','runtime','collector','wrapper'])test('可被其他用户写入的候选闭包不得签present：'+target,t=>{
 const f=transportFixture(t);assert.equal(f.run('normal').ok,true);
 const root=join(base(f),f.revision),path={home:join(f.top,'remote-mmv'),candidate:root,runtime:join(root,'runtime'),collector:join(root,'runtime/deployment-manifest.mjs'),wrapper:join(root,'run.sh')}[target];
 const count=f.calls().length,posts=readFileSync(join(f.top,'brain.jsonl'),'utf8');chmodSync(path,0o777);
 const result=f.run('recover');assert.equal(result.ok,false,JSON.stringify(result));
 assert.equal(f.calls().slice(count).filter(c=>c.archive||c.collect||c.manifest).length,0);
 assert.equal(readFileSync(join(f.top,'brain.jsonl'),'utf8'),posts);
});
