import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare,transport,verify} from './fixtures/paired-deploy-smoke-transport.mjs';
const service=new URL('../',import.meta.url).pathname;
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'paired-smoke-'));t.after(()=>rmSync(root,{recursive:true,force:true}));prepare(root);
 const ssh=cmd=>transport(root,'ssh',['xian-m4',cmd]);
 const stage=ssh('mktemp -d /tmp/input-runtime-deploy.XXXXXX').stdout.trim();
 const scp=(...files)=>transport(root,'scp',['-q','-p',...files,`xian-m4:${stage}/`]);
 assert.equal(scp(join(service,'input-runtime-release.py')).status,0);
 const capture=()=>ssh(`python3 ${stage}/input-runtime-release.py capture ~/bin-harvest ~/.local/bin > ${stage}/expected.json`);
 const upload=()=>scp(join(service,'douyin-phone-adb'),join(service,'text-input-focus.py'));
 const install=(dirs='~/bin-harvest ~/.local/bin')=>ssh(`python3 ${stage}/input-runtime-release.py install ${stage}/douyin-phone-adb ${stage}/text-input-focus.py ${stage}/expected.json ~/.config/openclaw/douyin-phone-profiles.tsv /private/tmp/openclaw-phone/locks ${dirs}`);
 return {root,stage,ssh,scp,capture,upload,install};
}
test('paired smoke executes real capture/install and reads both actual runtime pairs',t=>{
 const f=fixture(t);assert.equal(f.capture().status,0);assert.equal(f.upload().status,0);const r=f.install();assert.equal(r.status,0,r.stderr);
 const result=verify(f.root);assert.equal(result.status,'verified');assert.deepEqual(result.remote_dirs,['~/bin-harvest','~/.local/bin']);
});
test('a successful-looking upload without installation cannot satisfy smoke',t=>{
 const f=fixture(t);f.capture();f.upload();assert.throws(()=>verify(f.root),/not verified/);
});
test('wrong runtime destination is rejected, not accepted by a generic SSH stub',t=>{
 const f=fixture(t);f.capture();f.upload();assert.equal(f.install('~/bin-harvest ~/wrong').status,2);assert.throws(()=>verify(f.root),/not verified/);
});
test('missing helper rejects real installation and leaves both runtime paths empty',t=>{
 const f=fixture(t);f.capture();f.scp(join(service,'douyin-phone-adb'));assert.equal(f.install().status,2);assert.throws(()=>verify(f.root),/not verified/);
});
test('invalid staged source is rejected by real source guard before replacement',t=>{
 const f=fixture(t);f.capture();f.upload();writeFileSync(join(f.stage,'text-input-focus.py'),'INPUT_RUNTIME_REVISION = 99\n');const r=f.install();assert.equal(r.status,2);assert.match(r.stderr,/mismatch|incompatible/);assert.throws(()=>verify(f.root),/not verified/);
});
test('changed runtime after capture rejects CAS and preserves the changed original',t=>{
 const f=fixture(t);f.capture();f.upload();const target=join(f.root,'remote/bin-harvest/douyin-phone-adb');writeFileSync(target,'other writer\n');const r=f.install();assert.equal(r.status,2);assert.match(r.stderr,/CAS mismatch/);assert.equal(readFileSync(target,'utf8'),'other writer\n');assert.throws(()=>verify(f.root),/not verified/);
});
test('kernel owner prevents real install and never produces a verified receipt',t=>{
 const f=fixture(t);f.capture();f.upload();mkdirSync(join(f.root,'remote/locks/SER1.lock'));writeFileSync(join(f.root,'remote/locks/SER1.lock/owner'),'another-run\n');const r=f.install();assert.equal(r.status,2);assert.match(r.stderr,/owner exists/);assert.throws(()=>verify(f.root),/not verified/);
});
test('readback corruption after a real install invalidates the receipt',t=>{
 const f=fixture(t);f.capture();f.upload();assert.equal(f.install().status,0);writeFileSync(join(f.root,'remote/.local/bin/text-input-focus.py'),'changed\n');assert.throws(()=>verify(f.root),/readback/);
});
test('a later failed install cannot reuse an earlier successful receipt',t=>{
 const f=fixture(t);f.capture();f.upload();assert.equal(f.install().status,0);assert.equal(verify(f.root).status,'verified');
 assert.equal(f.install('~/bin-harvest ~/wrong').status,2);assert.throws(()=>verify(f.root),/not verified/);
});
test('unsafe source syntax fails before any runtime replacement',t=>{
 const f=fixture(t);f.capture();f.upload();writeFileSync(join(f.stage,'text-input-focus.py'),'INPUT_RUNTIME_REVISION = 1\nif broken:\n');
 const r=f.install();assert.equal(r.status,2);assert.throws(()=>verify(f.root),/not verified/);
});
test('unrelated deploy syntax/hash reads cannot invalidate a verified pair receipt',t=>{
 const f=fixture(t);f.capture();f.upload();assert.equal(f.install().status,0);
 assert.equal(f.ssh('md5 -q ~/bin-harvest/input-runtime-release.py ~/.local/bin/input-runtime-release.py 2>/dev/null | sort -u | wc -l').status,0);
 assert.equal(verify(f.root).status,'verified');
});

for(const mode of ['schema-ready','missing-schema','invalid-json'])test(`真实dry-run公司readiness ${mode} 在admission/安装前判定`,t=>{
 const root=mkdtempSync(join(tmpdir(),'paired-company-readiness-'));t.after(()=>rmSync(root,{recursive:true,force:true}));prepare(root);
 const result=spawnSync(process.execPath,[join(service,'__tests__/fixtures/deploy-smoke-runner.mjs'),join(service,'deploy.sh')],{encoding:'utf8',timeout:30000,env:{...process.env,PATH:root+':'+process.env.PATH,PAIR_COMPANY_READINESS_MODE:mode,...(mode==='schema-ready'?{PAIR_DEPLOY_STOP_AT_ADMISSION:'1'}:{})}});
 const output=result.stdout+result.stderr;
 const ssh=readFileSync(join(root,'ssh.log'),'utf8');
 if(mode==='schema-ready') {
  assert.match(output,/"business_runtime_status":"disabled"/);assert.match(output,/"schema_verified":true/);
  assert.equal(result.error,undefined,'正向readiness必须真正结束，不能靠超时后的旧receipt通过');
  assert.match(output,/explicit fixture admission denied after readiness/);
  assert.match(ssh,/^mmv python3$/m,'schema通过后真实进入admission，显式busy夹具在安装前停止');
  assert.throws(()=>verify(root),/not verified/,'仅readiness通过不生成配套安装receipt');
 } else {
  assert.notEqual(result.status,0);
  assert.match(output,new RegExp(mode==='missing-schema'?'COMPANY_SCHEMA_NOT_READY':'COMPANY_READINESS_RESPONSE_INVALID'));
  assert.throws(()=>verify(root),/not verified/);
  assert.doesNotMatch(ssh,/^mmv python3$/m,'readiness失败不得执行远端admission');
  let uploads='';try{uploads=readFileSync(join(root,'scp.log'),'utf8');}catch{}
  assert.equal(uploads,'','readiness失败不得执行任何安装上传');
 }
});

test('SQL附件transport真实存三份源字节、实际SHA读回并拒绝篡改/未知目标',t=>{
 const f=fixture(t),source=join(service,'../../apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql');
 const name='20261014_130000_leadgen_outreach_bridge.sql',bytes=readFileSync(source);
 const text=readFileSync(join(service,'deploy.sh'),'utf8');const block=text.slice(text.indexOf('deploy_release_evidence() {'),text.indexOf('# Commander 入口'));
 const codes=[...block.matchAll(/python3 -c '([^']+)'/g)].map(m=>m[1].replaceAll('\\"','"'));assert.equal(codes.length,3);
 for(const [host,base,local] of [['xian-m4','~/bin-harvest','remote/bin-harvest'],['mmv','~/bin-harvest','remote-mmv/bin-harvest'],['mmv','~/.openclaw/leadgen-scripts','remote-mmv/.openclaw/leadgen-scripts']]){
  const directory=base+'/release-evidence',file=directory+'/'+name,stage=directory+'/.'+name+'.deploy-new';
  assert.equal(transport(f.root,'ssh',[host,`python3 -c '${codes[1]}' ${directory}`]).status,0);
  assert.equal(transport(f.root,'scp',['-q','-p',source,host+':'+stage]).status,0);
  assert.equal(transport(f.root,'ssh',[host,`chmod 600 ${stage} && mv -f ${stage} ${file}`]).status,0);
  const actual=join(f.root,local,'release-evidence',name);assert.deepEqual(readFileSync(actual),bytes);assert.equal(statSync(actual).mode&0o777,0o600);
  const read=()=>transport(f.root,'ssh',[host,`python3 -c '${codes[2]}' ${file}`]);
  const hash=read();assert.equal(hash.status,0);assert.match(hash.stdout,/^[0-9a-f]{64}\n$/);assert.equal(hash.stdout.trim(),createHash('sha256').update(bytes).digest('hex'));
  writeFileSync(actual,'changed after upload');const changed=read();assert.equal(changed.status,0);assert.notEqual(changed.stdout,hash.stdout,'不得回固定假hash');
  rmSync(actual);assert.notEqual(read().status,0,'缺文件不能伪造成功hash');
 }
 assert.equal(transport(f.root,'scp',['-q',source,'xian-m1:~/bin-harvest/release-evidence/.'+name+'.deploy-new']).status,2);
 assert.equal(transport(f.root,'ssh',['xian-m4','python3 -c "print(1)" ~/outside/release-evidence/'+name]).status,2);
});
