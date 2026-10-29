import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script=resolve('scripts/deploy/staging-measure-archive.py');
test('measures OCI gzip layers and classic uncompressed layers', t=>{
 const dir=mkdtempSync(join(tmpdir(),'zj-image-measure-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'image.tar');
 const make=spawnSync('python3',['-c',`import io,tarfile,gzip,sys
with tarfile.open(sys.argv[1],'w') as t:
 for name,data in [('blobs/sha256/test',gzip.compress(b'x'*12345)),('old/layer.tar',b'y'*5432)]:
  entry=tarfile.TarInfo(name); entry.size=len(data); t.addfile(entry,io.BytesIO(data))`,file],{encoding:'utf8'});
 assert.equal(make.status,0,make.stderr);
 const r=spawnSync('python3',[script,file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);assert.equal(result.unpacked,12345+5432);assert.ok(result.archive>0);
});
test('rejects malformed and layerless archives',t=>{
 const dir=mkdtempSync(join(tmpdir(),'zj-image-empty-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'empty.tar');spawnSync('python3',['-c','import tarfile,sys; tarfile.open(sys.argv[1],"w").close()',file]);
 const r=spawnSync('python3',[script,file],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/no image layers/);
});
