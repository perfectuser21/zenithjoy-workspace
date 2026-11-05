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

test('fixed peer executes its pinned source bytes even when an otherwise valid timestamp pycache disagrees',()=>{
 const code=`from pathlib import Path
import tempfile,shutil,importlib.util,marshal,struct,sys
root=Path(tempfile.mkdtemp(prefix='preflight-cache-boundary-'))
try:
 helper=root/'preflight-local-step.py';helper.write_bytes(Path(sys.argv[1]).read_bytes())
 peer=root/'phone-lock-root.py';peer.write_text("VALUE='source'\\n")
 cached=Path(importlib.util.cache_from_source(str(peer)));cached.parent.mkdir()
 cached.write_bytes(importlib.util.MAGIC_NUMBER+struct.pack('<III',0,int(peer.stat().st_mtime),peer.stat().st_size)+marshal.dumps(compile("VALUE='unbound-cache'\\n",str(peer),'exec')))
 spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 assert m.peer('phone-lock-root').VALUE=='source'
 assert peer.read_text()=="VALUE='source'\\n"
finally:shutil.rmtree(root)
`;
 const p=spawnSync('/usr/bin/python3',['-I','-S','-c',code,helper],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
