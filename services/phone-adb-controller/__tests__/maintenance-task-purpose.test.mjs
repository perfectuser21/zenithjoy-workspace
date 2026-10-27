import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const fixture=new URL('./fixtures/maintenance-task-purpose.py',import.meta.url).pathname;
for(const name of ['fidelity','purpose','source','schema','count','count-bool','missing-payload','payload-type','owner-type','claimed-time-type','duplicate','raw','status']){
 test(`maintenance purpose协议 ${name}`,()=>{const r=spawnSync('python3',[fixture,`validation:${name}`],{encoding:'utf8',timeout:22000});assert.equal(r.status,0,r.stderr||r.stdout);});
}
for(const name of ['large','malicious','owner','duplicate','page','truncated','missing','api-fail','bad-json','wire-purpose','wire-source','wire-raw','ambiguous']){
 test(`真实SSH/parser维护权威 ${name}（synthetic）`,()=>{const r=spawnSync('python3',[fixture,`transport:${name}`],{encoding:'utf8',timeout:22000});assert.equal(r.status,0,r.stderr||r.stdout);});
}
for(const mode of ['missing','hash','symlink','path'])test(`维护authority真实manifest ${mode}必须拒绝`,()=>{const r=spawnSync('python3',[fixture,`manifest:${mode}`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
test('旧完整任务与专用六字段任务check_tasks差分等价',()=>{const r=spawnSync('python3',[fixture,'differential'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
