import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execInput} from '../leadgen-client.mjs';
import {createHandlers} from '../leadgen-workflow.mjs';

test('实际进程超时保留安全首因，跨chunk凭据和长图片不得进入回执',async()=>{
 const code=`process.stdout.write('phase=vision request-start\\n');process.stderr.write('phase=vision HTTP waiting\\nAuthorization: Bear');setTimeout(()=>process.stderr.write('er sk-fake-token\\n{"api_key":"fake-private"}\\ndata:image/png;base64,'+'A'.repeat(12000)+'\\n'),25);setInterval(()=>{},1000)`;
 let failure;try{await execInput(process.execPath,['-e',code],{timeoutMs:300});}catch(e){failure=e;}
 assert.equal(failure?.message,'EXECUTION_DEADLINE');assert.match(failure.stdout,/phase=vision request-start/);assert.match(failure.stderr,/phase=vision HTTP waiting/);
 assert.doesNotMatch(failure.stderr,/sk-fake-token|fake-private|A{30}|Bearer sk/);
 assert.ok(failure.stderr.length<=8000);
});
function setup(execute){
 const d=mkdtempSync(join(tmpdir(),'search-budget-fake-'));const registry=join(d,'accounts');writeFileSync(registry,'yueshengyun-work\t37358506855\n');
 const env={HOME:d,WFR_RUN_DIR:d,P:'yueshengyun-work',SERIAL:'fake-white',WFR_TAG:'fake-run',DOUYIN_ACCOUNT_REGISTRY:registry,LEADGEN_LINE:'悦升云端',LEADGEN_SOURCES_FILE:join(d,'sources'),WF_RUN_MAX_SECONDS:'3600',LEADGEN_SORT:'comprehensive',LEADGEN_TIME_LAYER:'unlimited'};writeFileSync(env.LEADGEN_SOURCES_FILE,'AI\n');
 const h=createHandlers({root:d,env,rpc:async()=>{throw Error('no queue writes');},execute:async(c,a,o)=>{
  const s=a.join(' ');if(s.includes('search-video-tab')||s.includes('open-search'))return execute(c,a,o);
  let stdout=s.includes('get-state')?'device\n':s.includes('preflight')?'serial=fake-white\n':s.includes('lock-acquire')?'lock=acquired\n':s.includes('lock-refresh')?'lock=refreshed\n':s.includes('telephony.registry')?'mCallState=0\n':s.includes('account-current')?'douyin_id=37358506855\n':'';
  return {code:0,stdout,stderr:''};
 }});return {d,h};
}
for(const remaining of [300000,65000])test(`只有视频tab180秒且仍受活动剩余${remaining}ms夹紧`,async()=>{
 const calls=[];const {d,h}=setup(async(_c,a,o)=>{calls.push({a,o});if(a.includes('search-video-tab'))throw Error('fake-end-of-probe');return {code:0,stdout:'',stderr:''};});
 try{await h.preflight();h.state.budgetDeadline=Date.now()+remaining;await assert.rejects(h.collect_videos(),/fake-end-of-probe/);
  const tab=calls.find(x=>x.a.includes('search-video-tab'));const search=calls.find(x=>x.a.includes('open-search'));
  assert.ok(tab.o.timeoutMs<=Math.min(180000,remaining));assert.ok(tab.o.timeoutMs>=Math.min(180000,remaining)-1000);assert.ok(search.o.timeoutMs<=120000);
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('超时诊断真实写私有活动log，保持原错误且不重试',async()=>{
 const error=Object.assign(Error('EXECUTION_DEADLINE'),{stderr:'phase=vision timeout\nAuthorization: Bearer sk-fake-token\ndata:image/png;base64,AAAAFAKE\n'});let calls=0;
 const {d,h}=setup(async()=>{calls++;throw error;});writeFileSync(join(d,'activity.log'),'previous\n',{mode:0o644});
 try{await h.preflight();await assert.rejects(h.collect_videos(),e=>e===error);assert.equal(calls,1);
  const log=readFileSync(join(d,'activity.log'),'utf8');assert.match(log,/phase=vision timeout/);assert.doesNotMatch(log,/sk-fake-token|AAAAFAKE/);assert.equal(statSync(join(d,'activity.log')).mode&0o777,0o600);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('正常非零动作错误摘要也先脱敏再截断',async()=>{
 const {d,h}=setup(async()=>({code:1,stdout:'',stderr:'HTTP unavailable\nAuthorization: Bearer sk-fake-secret\n'}));
 try{await h.preflight();await assert.rejects(h.collect_videos(),e=>{assert.match(e.message,/HTTP unavailable/);assert.doesNotMatch(e.message,/sk-fake-secret/);return true;});}
 finally{rmSync(d,{recursive:true,force:true});}
});
