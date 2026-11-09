import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const secret='FIXTURE_TOKEN_MUST_NEVER_APPEAR';
function cli({localError,nodeError,sleep=false}){
 const dir=mkdtempSync(join(tmpdir(),'adb-safe-diagnostic-'));
 try{
  for(const name of ['adb-managed-client.py','adb-host-instance-policy.py'])copyFileSync(join(root,name),join(dir,name));
  const script=join(dir,'verifier.mjs');
  writeFileSync(script,sleep?'setTimeout(()=>{},20000);':`process.stderr.write(${JSON.stringify(nodeError||'')});process.exitCode=2;`);
  const context={node:{path:process.execPath},module:script,env:{PATH:'/usr/bin:/bin',BRAIN_INTERNAL_TOKEN:secret}};
  // Only the external route/Node boundary is fixture-owned. The published
  // client source, real main/except, and policy verifier_answer run unchanged.
  writeFileSync(join(dir,'adb-existing-route.py'),`import types, pathlib, subprocess, json
ns={'__file__':str(pathlib.Path(__file__).with_name('adb-host-instance-policy.py'))}
exec(compile(pathlib.Path(ns['__file__']).read_bytes(),ns['__file__'],'exec'),ns)
def read_host_policy(*args):
 ${localError?`raise ValueError(${JSON.stringify(localError)})`:`return ns['verifier_answer'](json.loads(${JSON.stringify(JSON.stringify(context))}), ['verify-epoch','--run-dir','/fixture'],subprocess.run)`}
`);
  const result=spawnSync('python3',['-I','-B',join(dir,'adb-managed-client.py'),'-s','fixture','get-state'],{encoding:'utf8',timeout:19000,env:{PATH:process.env.PATH,HOME:dir,ZJ_ADB_HOST_CONFIG:join(dir,'policy.json')}});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,2,result.stderr);assert.equal(result.stdout,'');
  assert.ok(!result.stderr.includes(secret));assert.ok(!result.stderr.includes(dir));
  return result.stderr;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('真实客户端main保留有限instance稳定码，未知/污染仍不泄漏',()=>{
 for(const suffix of ['CREDENTIAL_REQUIRED','SOURCE_BYTES','VERIFIER_AUTHORITY','EPOCH_AUTHORITY'])assert.equal(cli({localError:'ADB_INSTANCE_'+suffix}),'ADB_INSTANCE_'+suffix+'\n');
 for(const value of ['ADB_INSTANCE_'+secret,'ADB_INSTANCE_EPOCH_AUTHORITY '+secret,'ADB_INSTANCE_EPOCH_AUTHORITY\n'+secret])assert.equal(cli({localError:value}),'ADB_MANAGED_FAILED\n');
});
test('真实Node verifier单行稳定码经policy和客户端main两层保留',()=>{
 assert.equal(cli({nodeError:'EPOCH_BUSINESS_DRIFT\n'}),'ADB_INSTANCE_VERIFIER_EPOCH_BUSINESS_DRIFT\n');
 assert.equal(cli({nodeError:'EPOCH_DAEMON_IDENTITY\n'}),'ADB_INSTANCE_VERIFIER_EPOCH_DAEMON_IDENTITY\n');
});
test('Node stderr污染/未知/多码不透传，也不把子进程stdout当错误授权',()=>{
 for(const value of ['EPOCH_BUSINESS_DRIFT '+secret,'EPOCH_BUSINESS_DRIFT\n'+secret+'\n',JSON.stringify({code:'EPOCH_BUSINESS_DRIFT',token:secret}),'EPOCH_BUSINESS_DRIFT\r\n','\u001b[31mEPOCH_BUSINESS_DRIFT\n','EPOCH_BUSINESS_DRIFT\0','EPOCH_BUSINESS_DRIFT\nEPOCH_DAEMON_IDENTITY\n',secret])assert.equal(cli({nodeError:value}),'ADB_INSTANCE_VERIFIER_AUTHORITY\n');
});
test('真实固定verifier进程15秒超时为专码且无异常cmd/token泄漏',{timeout:22000},()=>{
 const began=Date.now();assert.equal(cli({sleep:true}),'ADB_INSTANCE_VERIFIER_TIMEOUT\n');
 assert.ok(Date.now()-began>=14500);assert.ok(Date.now()-began<18500);
});
test('CI原L3矩阵自动包含本永久测试，不落Darwin排除列表',()=>{
 const workflow=readFileSync(resolve(root,'../../.github/workflows/ci-l3-code.yml'),'utf8');
 assert.match(workflow,/for path in services\/phone-adb-controller\/__tests__\/\*\.test\.mjs/);
 assert.ok(!workflow.includes('adb-managed-diagnostics'));
 assert.match(workflow,/node --test --test-shard=/);
});
