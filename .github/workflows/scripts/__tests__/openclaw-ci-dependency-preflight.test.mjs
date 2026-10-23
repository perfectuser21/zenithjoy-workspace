import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const workflow=YAML.parse(readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8'));
const ids=['openclaw-apt-index','openclaw-os-packages','openclaw-pillow'];
function setup(w=workflow){return ids.map(id=>w.jobs['openclaw-scripts-test'].steps.find(s=>s.id===id));}
function validate(w){
 assert.equal(w.jobs['openclaw-scripts-test']['timeout-minutes'],10);
 for(const [i,s] of setup(w).entries()){
  assert.ok(s,`missing separately visible dependency phase ${ids[i]}`);
  assert.equal(s['timeout-minutes'],2);assert.equal(s['continue-on-error'],undefined);assert.equal(s.if,undefined);
  assert.match(s.run,/PREFLIGHT_START/);assert.match(s.run,/PREFLIGHT_DONE/);assert.match(s.run,/timeout (90s|60s) /);
 }
 assert.match(setup(w)[0].run,/apt-get.*update/);assert.match(setup(w)[1].run,/apt-get.*install.*zsh libxml2-utils ffmpeg/);
 assert.match(setup(w)[2].run,/pip install.*Pillow/);
}
test('依赖准备拆成可定位有界三阶段，原10分钟和全量门禁保持',()=>validate(workflow));
function invoke(t,failed=''){
 validate(workflow);const top=mkdtempSync(join(tmpdir(),'ci-dependency-preflight-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const trace=join(top,'trace');
 const put=(name,script)=>writeFileSync(join(top,name),'#!/bin/sh\n'+script+'\n',{mode:0o755});
 put('timeout','shift; exec "$@"');put('sudo','exec "$@"');
 put('apt-get','printf "apt %s\\n" "$*" >> "$DEPENDENCY_TRACE"; case "$*" in *update*) phase=apt-index;; *) phase=os-packages;; esac; [ "$DEPENDENCY_FAILED" != "$phase" ] || exit 43');
 put('python3','printf "python %s\\n" "$*" >> "$DEPENDENCY_TRACE"; [ "$DEPENDENCY_FAILED" != pillow ] || exit 43');
 for(const name of ['zsh','xmllint','ffmpeg'])put(name,'exit 0');
 let output='',status=0;
 for(const s of setup()){
  const r=spawnSync('bash',['-e','-o','pipefail','-c',s.run],{env:{...process.env,PATH:top+':'+process.env.PATH,DEPENDENCY_TRACE:trace,DEPENDENCY_FAILED:failed},encoding:'utf8',timeout:5000});
  output+=r.stdout+r.stderr;status=r.status;if(status!==0)break;
 }
 return {status,output,trace:readFileSync(trace,'utf8')};
}
test('实际阶段命令包含所有原依赖，成功才发DONE',t=>{const r=invoke(t);assert.equal(r.status,0,r.output);assert.match(r.trace,/apt .*update/);assert.match(r.trace,/apt .*install.*zsh libxml2-utils ffmpeg/);assert.match(r.trace,/pip install.*Pillow/);assert.equal((r.output.match(/PREFLIGHT_DONE/g)||[]).length,3);});
for(const [i,phase] of ['apt-index','os-packages','pillow'].entries())test('依赖失败保留精确阶段且不执行后续：'+phase,t=>{const r=invoke(t,phase);assert.equal(r.status,43,r.output);assert.equal((r.output.match(/PREFLIGHT_START/g)||[]).length,i+1);assert.equal((r.output.match(/PREFLIGHT_DONE/g)||[]).length,i);});
test('准备阶段缺失/放行失败/扩大总时限仍被守卫拒绝',()=>{
 for(const mutate of [w=>{w.jobs['openclaw-scripts-test']['timeout-minutes']=11;},w=>{w.jobs['openclaw-scripts-test'].steps=w.jobs['openclaw-scripts-test'].steps.filter(s=>s.id!==ids[0]);},w=>{setup(w)[1]['continue-on-error']=true;}]){const w=structuredClone(workflow);mutate(w);assert.throws(()=>validate(w));}
});
