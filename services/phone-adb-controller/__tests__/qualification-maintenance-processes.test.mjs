import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {execInput} from '../leadgen-client.mjs';
import {receiptPath} from '../native-operation-receipt.mjs';
const api=await import('../qualification-maintenance-processes.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('qualification-maintenance-processes.mjs'))return null;
  throw error;
});
const needApi=()=>assert.equal(typeof api?.evaluateProcessCensus,'function','缺少受限维护完整进程观察验证');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=value=>createHash('sha256').update(value).digest('hex');
function scope(){return {host:'xian-m4',uid:process.getuid(),run_started_at_ms:Date.now()-2000,
  run_tag:'maintenance-kernel-fixture',serial:'NO-PHONE',run_dir:'/tmp/NO-PHONE-RUN',runtime_root:'/tmp/NO-PHONE-RUN/runtime',tracked:[]};}
function quiet(s){return {protocol:'qualification-process-census-v1',host:s.host,uid:s.uid,platform:process.platform,
  observer_pid:999999,observer_sha256:api?.processObserverDigest,started_at_ms:Date.now(),finished_at_ms:Date.now(),
  enumerated:[{pid:999999,uid:s.uid}],final_enumerated:[{pid:999999,uid:s.uid,start_identity:'fixture:observer'}],
  observations:[{pid:999999,uid:s.uid,ppid:1,pgid:999999,start_identity:'fixture:observer',classification:'observer'}],
  absent:[],tracked:[],unknown:[]};}

test('完整受限静默观察只能证明该程序effects域，不改称OS全停',()=>{
  needApi();const s=scope(),before=structuredClone(s);const result=api.evaluateProcessCensus(quiet(s),s);
  assert.equal(result.status,'verified');assert.equal(result.os_full_stop,false);assert.deepEqual(s,before);
});
test('最终枚举瞬时进程须真实ESRCH才可证明缺席，不使观察器自己的ps永久堵塞',()=>{
  needApi();const s=scope(),c=quiet(s);c.final_enumerated.push({pid:999998,uid:s.uid,absence_reason:'ESRCH'});
  assert.equal(api.evaluateProcessCensus(c,s).status,'verified');
  c.final_enumerated.at(-1).absence_reason='not_in_ps';assert.equal(api.evaluateProcessCensus(c,s).status,'blocked');
});
test('legacy launch父或capture无出生记录时，必须另有fresh ESRCH，不能从80名单推全停',()=>{
 needApi();const s={...scope(),pid_only:[{pid:98765,origin:'launch_parent'}]},c=quiet(s);
 c.pid_only=[{pid:98765,origin:'launch_parent',state:'alive',reason:'KERNEL'}];assert.equal(api.evaluateProcessCensus(c,s).status,'blocked');
 c.pid_only[0]={pid:98765,origin:'launch_parent',state:'absent',reason:'not_in_ps'};assert.equal(api.evaluateProcessCensus(c,s).status,'blocked');
 c.pid_only[0].reason='ESRCH';assert.equal(api.evaluateProcessCensus(c,s).status,'verified');
});
for(const [name,change]of [
  ['权限不明',c=>c.unknown.push({pid:17,code:'EPERM'})],
  ['枚举遗漏',c=>c.final_enumerated.push({pid:18,uid:process.getuid()})],
  ['假定缺席',c=>{c.enumerated.push({pid:19,uid:process.getuid()});c.absent.push({pid:19,reason:'not_in_ps'});}],
  ['原程序相关活执行者',c=>c.observations[0].classification='active_related'],
  ['截图命令未绑定ADB字节和父链',c=>c.observations[0].classification='read_only_screenshot'],
  ['只读inline未绑定真实解释器',c=>c.observations[0].classification='read_only_native_observer'],
  ['未归属脱组执行者',c=>c.observations[0].classification='unknown_detached'],
  ['观察器源码漂移',c=>c.observer_sha256='0'.repeat(64)],
  ['终态PID出生变化',c=>c.final_enumerated[0].start_identity='reused:new'],
])test(name+'不得获得维护effects闭合',()=>{
  needApi();const s=scope(),c=quiet(s);change(c);assert.equal(api.evaluateProcessCensus(c,s).status,'blocked');
});

for(const [name,argv,old] of [
  ['普通参数伪装维护actor',['python3','-c','pass','/tmp/qualification-maintenance-processes.py','NO-PHONE'],false],
  ['早于run的未归属解释器',['python3','-c','pass'],true],
  ['外目录脚本未证明独立',['python3','/tmp/unrelated.py'],false],
])test(name+'不能被路径或年龄免检',()=>{
  const observer=fileURLToPath(new URL('../qualification-maintenance-processes.py',import.meta.url));
  const code=`import importlib.util,json,sys,os\np=sys.argv[1];s=importlib.util.spec_from_file_location('observer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.loads(sys.stdin.read());r={'pid':987654,'ppid':42,'terminal':False,'executable':'/usr/bin/python3','start_ms':x['scope']['run_started_at_ms']+(-1 if x['old'] else 1)}\nprint(m.classify(r,x['argv'],x['scope']))`;
  const s=scope(),actualArgv=argv.map(x=>x==='/tmp/qualification-maintenance-processes.py'?observer:x);
  const out=spawnSync('python3',['-B','-I','-c',code,observer],{input:JSON.stringify({scope:s,argv:actualArgv,old}),encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);
  assert.ok(['active_related','unknown_producer','unknown_detached'].includes(out.stdout.trim()),out.stdout);
});

test('已观测脱组执行者且另有权限未知时，blocked摘要空不能冒充内核未发现',()=>{
 needApi();const s=scope(),c=quiet(s);
 const escaped={pid:123456,uid:s.uid,ppid:1,pgid:123456,start_identity:'fixture:escaped',terminal:false,classification:'unknown_detached'};
 c.enumerated.push({pid:escaped.pid,uid:s.uid});c.final_enumerated.push({...escaped});c.observations.push(escaped);
 c.unknown.push({pid:234567,code:'EPERM'});
 const result=api.evaluateProcessCensus(c,s);
 assert.equal(result.status,'blocked');assert.equal(result.reason,'PROCESS_OBSERVATION_UNKNOWN');
 assert.deepEqual(result.blocked_pids,[]);assert.equal(c.observations.find(x=>x.pid===escaped.pid),escaped);
});

test('原tracked名单全停仍须从真实kernel发现未登记doublefork/setsid后台',
  {skip:process.platform==='win32'},async()=>{
    const dir=mkdtempSync(join(tmpdir(),'qualification-maintenance-detached-'));
    const oracle=join(dir,'oracle'),runDir=join(dir,'original');mkdirSync(oracle);mkdirSync(runDir);
    const fixture=fileURLToPath(new URL('./fixtures/native-operation-coverage.py',import.meta.url));
    const receipt={runDir,operationId:'original',runId:'original__a1',taskId:null,profile:'fixture',serial:'NO-PHONE',
      sourceCommit:'353b910f11ce3852b2ef69c8ead5c37e97850b4a',owner:'fixture',activity:'qualification'};
    const started=Date.now();
    try{
      const result=await execInput('python3',[fixture,oracle],{receipt,timeoutMs:3000});assert.equal(result.code,0);
      const escaped=JSON.parse(readFileSync(join(oracle,'identity.json'))),originalPath=receiptPath(runDir,'original');
      const original=JSON.parse(readFileSync(originalPath));assert.notEqual(escaped.pgid,original.pgid);
      const observer=fileURLToPath(new URL('../qualification-maintenance-processes.py',import.meta.url));
      // oracle只用于独立核验预期出生，绝不传进正式全量观察scope。
      const identityRead=spawnSync('python3',['-B','-I','-c',
        "import importlib.util,json,sys;s=importlib.util.spec_from_file_location('o',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.kernel(int(sys.argv[2]))))",observer,String(escaped.pid)],{encoding:'utf8',timeout:2000});
      assert.equal(identityRead.status,0,identityRead.stderr);const expected=JSON.parse(identityRead.stdout);
      assert.equal(expected.pid,escaped.pid);assert.equal(expected.uid,process.getuid());assert.equal(expected.terminal,false);assert.ok(expected.start_identity);
      assert.equal(escaped.stdio_closed,true);const before=sha(readFileSync(originalPath));
      needApi();assert.equal(typeof api.collectProcessCensus,'function');
      const s={...scope(),run_started_at_ms:started-1000,tracked:[{pid:original.pid,start_identity:original.start_identity}]};
      // 不向正式观察器传oracle PID；初始名单故意仅代表已退出的旧父集合。
      const census=await api.collectProcessCensus(s),verdict=api.evaluateProcessCensus(census,s);
      assert.equal(verdict.status,'blocked');
      const found=census.observations.find(x=>x.pid===escaped.pid);
      const diagnostic=JSON.stringify({expected_pid:escaped.pid,expected_birth:expected.start_identity,
        found:found&&{pid:found.pid,uid:found.uid,start_identity:found.start_identity,terminal:found.terminal,classification:found.classification},
        unknown:census.unknown,verdict_reason:verdict.reason});
      assert.ok(found,'真实脱组子必须由完整kernel观察发现: '+diagnostic);
      assert.equal(found.uid,expected.uid,diagnostic);assert.equal(found.start_identity,expected.start_identity,diagnostic);
      assert.equal(found.terminal,false,diagnostic);
      assert.ok(['unknown_producer','unknown_detached','active_related'].includes(found.classification),diagnostic);
      assert.ok(census.enumerated.some(x=>x.pid===escaped.pid&&x.uid===expected.uid),diagnostic);
      assert.ok(census.final_enumerated.some(x=>x.pid===escaped.pid&&x.start_identity===expected.start_identity),diagnostic);
      assert.equal(sha(readFileSync(originalPath)),before,'不得改旧UNKNOWN收据');
      assert.equal(JSON.parse(readFileSync(originalPath)).execution_stopped,false);
    }finally{
      while(!existsSync(join(oracle,'ttl-exit.json'))&&Date.now()-started<9000)await sleep(50);
      assert.ok(existsSync(join(oracle,'ttl-exit.json')),'只等fixture自己的五秒TTL，不对未知PID发送停止');
      rmSync(dir,{recursive:true,force:true});
    }
  });
