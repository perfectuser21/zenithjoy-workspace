import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
const helper=new URL('../preflight-local-step.py',import.meta.url).pathname;
const read=name=>readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
function inspect(xml){const p=spawnSync('/usr/bin/python3',['-I','-S',helper,'ui'],{input:xml,encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);}
test('preflight account facts require real own-profile markers; foreign and partial identities are never returned',()=>{
 assert.equal(inspect(read('real-0930-own-profile-cold-start.xml')).account.douyin_id,'44997267357');
 const foreign=inspect(read('real-0930-foreign-profile-after-dm.xml'));assert.equal(foreign.kind,'foreign');assert.equal(foreign.account,null);
 const partial=inspect('<hierarchy><node text="抖音号：pretend"/></hierarchy>');assert.equal(partial.kind,'partial');assert.equal(partial.account,null);
});
test('preflight Me coordinates come from one actual bound; ambiguity refuses navigation',()=>{
 assert.deepEqual(inspect('<hierarchy><node content-desc="我，按钮" bounds="[910,2400][1030,2500]"/></hierarchy>').me,{x:970,y:2450});
 const p=spawnSync('/usr/bin/python3',['-I','-S',helper,'ui'],{input:'<hierarchy><node content-desc="我，按钮" bounds="[1,2][3,4]"/><node content-desc="我，按钮" bounds="[5,6][7,8]"/></hierarchy>',encoding:'utf8'});assert.notEqual(p.status,0);assert.equal(p.stdout,'');
});
test('local lock endpoint rejects a caller-selected unverified root without creating ownership',()=>{
 const p=spawnSync('/usr/bin/python3',['-I','-S',helper,'lock'],{input:JSON.stringify({root:'/tmp/untrusted-preflight-root',serial:'SERIAL',operation:'acquire',owner:'fixture_run',epoch:'00000000-0000-4000-8000-000000000001',receipt:{}}),encoding:'utf8'});
 assert.notEqual(p.status,0);assert.equal(p.stdout,'');assert.equal(p.stderr,'PREFLIGHT_LOCAL_INVALID\n');
});
