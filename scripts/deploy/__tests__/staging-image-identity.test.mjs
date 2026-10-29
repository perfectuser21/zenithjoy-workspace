import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const helper=resolve('scripts/deploy/staging-image-identity.py');
function run(mutated=false){
 const builder=spawnSync('python3',['-c',`import io,tarfile,json,hashlib,sys
config=json.dumps({'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+'a'*64,'sha256:'+'b'*64]}}).encode()
digest=hashlib.sha256(config).hexdigest(); name='blobs/sha256/'+digest
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as t:
 for n,d in [(name,config if sys.argv[1]=='0' else config+b' '),('manifest.json',json.dumps([{'Config':name,'RepoTags':['fixture:test'],'Layers':[]}]).encode())]:
  i=tarfile.TarInfo(n);i.size=len(d);t.addfile(i,io.BytesIO(d))`,mutated?'1':'0'],{maxBuffer:1024*1024});
 assert.equal(builder.status,0,builder.stderr?.toString());
 return spawnSync('python3',[helper,'fixture:test'],{input:builder.stdout,encoding:'utf8'});
}
test('reads stable config content and layer identities from stream',()=>{
 const a=run(),b=run();assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);const parsed=JSON.parse(a.stdout);assert.match(parsed.config,/^sha256:[a-f0-9]{64}$/);assert.equal(parsed.layers.length,2);assert.deepEqual(parsed,JSON.parse(b.stdout));
});
test('rejects tampered config even when archive path claims original digest',()=>{
 const r=run(true);assert.notEqual(r.status,0);assert.match(r.stderr,/config digest mismatch/);
});
