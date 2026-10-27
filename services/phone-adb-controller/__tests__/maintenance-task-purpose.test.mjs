import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const fixture=new URL('./fixtures/maintenance-task-purpose.py',import.meta.url).pathname;
for(const name of ['fidelity','purpose','source','schema','count','count-bool','missing-payload','payload-type','owner-type','claimed-time-type','duplicate','raw','status']){
 test(`maintenance purpose协议 ${name}`,()=>{const r=spawnSync('python3',[fixture,`validation:${name}`],{encoding:'utf8',timeout:22000});assert.equal(r.status,0,r.stderr||r.stdout);});
}
for(const name of ['large','malicious','owner','duplicate','page']){
 test(`真实SSH/parser维护权威 ${name}（synthetic）`,()=>{const r=spawnSync('python3',[fixture,`transport:${name}`],{encoding:'utf8',timeout:22000});assert.equal(r.status,0,r.stderr||r.stdout);});
}
test('部署manifest缺维护authority模块必须拒绝',()=>{const r=spawnSync('python3',[fixture,'manifest'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
