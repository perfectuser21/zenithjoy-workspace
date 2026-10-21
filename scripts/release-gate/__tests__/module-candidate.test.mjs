import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('模块候选：不同打包时间相同内容重用历史字节，改内容不改版本拒绝，新版本可复现',()=>{
 const result=spawnSync('python3',['-c',`
import importlib.util,tempfile,pathlib,tarfile,io
spec=importlib.util.spec_from_file_location('candidate','scripts/release-gate/prepare-module-candidate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 a,b,c=[pathlib.Path(d)/x for x in ['a.tar.gz','b.tar.gz','c.tar.gz']]
 def tar(p,t,data):
  with tarfile.open(p,'w:gz') as out:
   info=tarfile.TarInfo('./index.js');info.size=len(data);info.mtime=t;info.mode=0o644;out.addfile(info,io.BytesIO(data))
 tar(a,1,b'old');tar(b,999,b'old');old=a.read_bytes();m.prepare(b,a);assert b.read_bytes()==old
 tar(b,999,b'changed')
 try:m.prepare(b,a)
 except ValueError:pass
 else:raise AssertionError('same version different code admitted')
 tar(b,111,b'new');tar(c,222,b'new');m.prepare(b,None);m.prepare(c,None);assert b.read_bytes()==c.read_bytes()
`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
