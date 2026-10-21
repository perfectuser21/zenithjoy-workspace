import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {transportFixture} from './candidate-transport-fixture.mjs';
test('远端已提交而本地运输失败：同SHA重试不重传，仍真实逐字节采集和ACK',t=>{
 const f=transportFixture(t),first=f.run('lose-once');
 assert.equal(first.ok,false,JSON.stringify(first));assert.match(first.error,/ssh/);
 const root=join(f.top,'remote-xian-m4/.local/share/zenithjoy/phone-candidates',f.revision),before=readFileSync(join(root,'runtime/transport-payload.bin'));
 assert.equal(existsSync(join(root,'candidate-identity.json')),true,'真实tar已原子提交');
 const count=f.calls().filter(c=>c.archive).length,second=f.run('recover');
 assert.equal(second.ok,true,JSON.stringify(second));
 assert.equal(f.calls().filter(c=>c.archive).length,count,'复用不再次传输archive');
 assert.deepEqual(readFileSync(join(root,'runtime/transport-payload.bin')),before);
 for(const host of ['mmv','xian-m4']){
  assert.ok(f.calls().filter(c=>c.host===host&&c.collect).length>=1);
  assert.ok(f.calls().some(c=>c.host===host&&c.manifest));
 }
 assert.equal(second.result.business_runtime_status,'not_evaluated');
});
