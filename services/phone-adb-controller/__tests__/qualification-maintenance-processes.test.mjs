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
for(const [name,change]of [
  ['权限不明',c=>c.unknown.push({pid:17,code:'EPERM'})],
  ['枚举遗漏',c=>c.final_enumerated.push({pid:18,uid:process.getuid()})],
  ['假定缺席',c=>{c.enumerated.push({pid:19,uid:process.getuid()});c.absent.push({pid:19,reason:'not_in_ps'});}],
  ['原程序相关活执行者',c=>c.observations[0].classification='active_related'],
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
      assert.equal(escaped.stdio_closed,true);const before=sha(readFileSync(originalPath));
      needApi();assert.equal(typeof api.collectProcessCensus,'function');
      const s={...scope(),run_started_at_ms:started-1000,tracked:[{pid:original.pid,start_identity:original.start_identity}]};
      // 不向正式观察器传oracle PID；初始名单故意仅代表已退出的旧父集合。
      const census=await api.collectProcessCensus(s),verdict=api.evaluateProcessCensus(census,s);
      assert.equal(verdict.status,'blocked');
      assert.ok(verdict.blocked_pids.includes(escaped.pid),'真实脱组子必须由完整kernel观察发现');
      assert.equal(sha(readFileSync(originalPath)),before,'不得改旧UNKNOWN收据');
      assert.equal(JSON.parse(readFileSync(originalPath)).execution_stopped,false);
    }finally{
      while(!existsSync(join(oracle,'ttl-exit.json'))&&Date.now()-started<9000)await sleep(50);
      assert.ok(existsSync(join(oracle,'ttl-exit.json')),'只等fixture自己的五秒TTL，不对未知PID发送停止');
      rmSync(dir,{recursive:true,force:true});
    }
  });
