import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,realpathSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configure103HostManifest} from '../activity-103-checker-repair.mjs';
const program=new URL('../activity-103-tool-host.py',import.meta.url).pathname;
const scope=JSON.parse(readFileSync(new URL('./fixtures/103-tool-host-wiring.json',import.meta.url))).active['tool_scope.py'].source;
function fixture(mode='normal'){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'103-assembly-')));
 const script=String.raw`import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=pathlib.Path(sys.argv[2]);mode=sys.argv[3];scope=sys.stdin.read();ops=m.business_ops(scope)
values={'tools.py':'actual tested tool excerpt','tool_scope.py':scope,'TOOLS.txt':m.instructions(ops),'activity-103-tool-host.py':pathlib.Path(sys.argv[1]).read_text(),'activity-tool-result.py':(m.ROOT/'activity-tool-result.py').read_text(),'checker.mjs':'fixed checker source','activity-103-checker-repair.mjs':(m.ROOT/'activity-103-checker-repair.mjs').read_text(),'repair-runtime.json':json.dumps({'mark_leads':{'checker_repair':{'max_attempts':2,'retry_safe':True}}})}
for name,value in values.items():(p/name).write_text(value)
manifest={'schema':'activity-103-tool-host/v1','operations':ops,'sha256':{k:m.digest(v.encode()) for k,v in values.items()}}
if mode=='missing-helper':(p/'activity-tool-result.py').unlink()
if mode=='drift':(p/'tools.py').write_text('changed')
if mode=='method-drift':
 (p/'TOOLS.txt').write_text('company_config allowed in mark_leads');manifest['sha256']['TOOLS.txt']=m.digest((p/'TOOLS.txt').read_bytes())
if mode=='ops-drift':ops['mark_leads'].append('company_config')
if mode=='budget-drift':
 (p/'repair-runtime.json').write_text(json.dumps({'mark_leads':{'checker_repair':{'max_attempts':3,'retry_safe':True}}}));manifest['sha256']['repair-runtime.json']=m.digest((p/'repair-runtime.json').read_bytes())
(p/'tool-host-103.json').write_text(json.dumps(manifest))
try:m.verify_host(p,ops);print(json.dumps({'verified':True,'instructions':m.instructions(ops)}))
except Exception as e:print(json.dumps({'verified':False,'error':type(e).__name__+':'+str(e)}))`;
 const r=spawnSync('/usr/bin/python3',['-c',script,program,root,mode],{input:scope,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 return {root,result:JSON.parse(r.stdout),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
for(const mode of ['normal','missing-helper','drift','method-drift','ops-drift','budget-drift'])test(`startup host guard ${mode}`,()=>{
 const f=fixture(mode);try{assert.equal(f.result.verified,mode==='normal');if(mode==='normal'){
  assert.match(f.result.instructions,/mark_leads不调用company_config|不要调用company_config/);
  assert.match(f.result.instructions,/mark_leads允许操作：bridge_outreach, bridge_readback, mark_leads, mark_readback, policy_review, score_readback/);
 }}finally{f.cleanup();}
});
test('manifest assembly freezes every actual host source and enables bounded repair',()=>{
 const f=fixture();try{
  const manifest={run:{contract:{workflow:'douyin-leadgen-103',activities:[{key:'scoring',runtime:{executor_kind:'agent'}},{key:'mark_leads',runtime:{executor_kind:'agent'},acceptance:{checks:['unchanged']}}]}},profile:{files:{'existing':'same'}}};
  const result=configure103HostManifest(manifest,{hostRoot:f.root});
  assert.equal(Object.keys(result.profile.files).length,10);assert.equal(result.profile.files.existing,'same');
  assert.deepEqual(result.run.contract.activities[1].runtime.checker_repair,{max_attempts:2,retry_safe:true});
  assert.deepEqual(result.run.contract.activities[1].acceptance,manifest.run.contract.activities[1].acceptance);
  writeFileSync(join(f.root,'activity-tool-result.py'),'different');assert.throws(()=>configure103HostManifest(manifest,{hostRoot:f.root}));
 }finally{f.cleanup();}
});
