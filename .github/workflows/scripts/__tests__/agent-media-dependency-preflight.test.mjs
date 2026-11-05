import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const root=new URL('../../../../',import.meta.url);
const workflow=YAML.parse(readFileSync(new URL('../../ci-l4-runtime.yml',import.meta.url),'utf8'));
const findStep=w=>w.jobs['agent-test'].steps.find(s=>s.name==='Install real media tools for agent runtime contracts');
function validate(w){
 const job=w.jobs['agent-test'],step=findStep(w);
 assert.equal(job['timeout-minutes'],15);
 assert.equal(step['timeout-minutes'],5);
 assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
 assert.equal(step.run.trim(),'timeout --kill-after=5s 235s bash .github/workflows/scripts/prepare-agent-media-tools.sh');
 assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.run==='npx vitest run'));
}
function invoke(t,{present=[],failed='',broken='',absent='',slow=''}={}){
 const top=mkdtempSync(join(tmpdir(),'agent-media-preflight-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const trace=join(top,'trace');writeFileSync(trace,'');
 const realTimeout=['/usr/bin/timeout','/opt/homebrew/bin/gtimeout'].find(existsSync);
 assert.ok(realTimeout,'real GNU timeout is required to test bounded slow transport');
 const put=(name,script)=>writeFileSync(join(top,name),'#!/bin/sh\n'+script+'\n',{mode:0o755});
 const createTools=`for tool in ffmpeg ffprobe; do
 [ "$MEDIA_ABSENT" != "$tool" ] || continue
 printf '#!/bin/sh\nprintf "version %s %%s\\\\n" "$*" >> "$MEDIA_TRACE"\n[ "$MEDIA_BROKEN" != "%s" ] || exit 44\n' "$tool" "$tool" > "$MEDIA_BIN/$tool"
 /bin/chmod +x "$MEDIA_BIN/$tool"
 done`;
 put('timeout',`printf 'timeout %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$1" = --kill-after=5s ] || exit 45
 shift
 [ "$1" = 235s ] || exit 45
 shift
 if [ -n "$MEDIA_SLOW" ]; then exec "${realTimeout}" --kill-after=1s 0.2s "$@"; fi
 exec "$@"`);
 put('sudo','exec "$@"');
 put('apt-get',`printf 'apt %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$MEDIA_FAILED" != index ] || exit 43
 [ "$MEDIA_SLOW" != index ] || /bin/sleep 10`);
 put('bash',`case "$1" in *prepare-openclaw-os-packages.sh)
 printf 'helper %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$MEDIA_FAILED" != helper ] || exit 43
 [ "$MEDIA_SLOW" != helper ] || /bin/sleep 10
 ${createTools}
 ;; *) exec /bin/bash "$@";; esac`);
 for(const name of present)put(name,'printf "version '+name+' %s\\n" "$*" >> "$MEDIA_TRACE"\n[ "$MEDIA_BROKEN" != "'+name+'" ] || exit 44');
 const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',findStep(workflow).run],{cwd:root,encoding:'utf8',timeout:4000,
  env:{PATH:top,RUNNER_TEMP:top,MEDIA_BIN:top,MEDIA_TRACE:trace,MEDIA_FAILED:failed,MEDIA_BROKEN:broken,MEDIA_ABSENT:absent,MEDIA_SLOW:slow}});
 assert.equal(result.error,undefined);
 return {status:result.status,output:result.stdout+result.stderr,trace:readFileSync(trace,'utf8')};
}
test('Agent media preparation keeps original5min step/15min job and one240s total shell boundary before real tests',()=>validate(workflow));
test('required Agent media preparation rejects deadline/entry/continue-on-error mutations',()=>{
 for(const mutate of [w=>{w.jobs['agent-test']['timeout-minutes']=16;},w=>{findStep(w)['timeout-minutes']=6;},w=>{findStep(w).run='true';},w=>{findStep(w).run=findStep(w).run.replace('235s','300s');},w=>{findStep(w)['continue-on-error']=true;},w=>{findStep(w).if='always()';}]){
  const changed=structuredClone(workflow);mutate(changed);assert.throws(()=>validate(changed));
 }
});
test('actual YAML invokes real wrapper, original bounded index and existing signed-plan helper for exact ffmpeg package',t=>{
 const r=invoke(t);assert.equal(r.status,0,r.output);
 assert.match(r.trace,/^timeout --kill-after=5s 235s bash .github\/workflows\/scripts\/prepare-agent-media-tools.sh/m);
 assert.match(r.trace,/^apt .*Acquire::Retries=1.*Acquire::http::Timeout=20.*Acquire::https::Timeout=20.*APT::Update::Error-Mode=any update/m);
 assert.match(r.trace,/^helper .github\/workflows\/scripts\/prepare-openclaw-os-packages.sh \S+ \/etc\/apt\/sources.list.d\/ubuntu.sources \/etc\/apt\/apt-mirrors.txt ffmpeg$/m);
 assert.ok(r.trace.indexOf('apt ')<r.trace.indexOf('helper '));
 assert.doesNotMatch(r.trace,/^apt .*install/m);
 for(const name of ['ffmpeg','ffprobe'])assert.match(r.trace,new RegExp('version '+name+' -version'));
 assert.match(r.output,/PREFLIGHT_DONE agent-media-tools/);
});
test('both installed tools avoid network but each version really executes',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe']});assert.equal(r.status,0,r.output);
 assert.doesNotMatch(r.trace,/^apt |^helper /m);
 for(const name of ['ffmpeg','ffprobe'])assert.match(r.trace,new RegExp('version '+name+' -version'));
});
test('ffmpeg presence alone cannot conceal missing ffprobe; exact package install is still required',t=>{
 const r=invoke(t,{present:['ffmpeg']});assert.equal(r.status,0,r.output);assert.match(r.trace,/^helper .* ffmpeg$/m);assert.match(r.trace,/version ffprobe -version/);
});
for(const failed of ['index','helper'])test(failed+' failure blocks completion and tests',t=>{
 const r=invoke(t,{failed});assert.equal(r.status,43,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE agent-media-tools/);
 assert.doesNotMatch(r.trace,/version /);if(failed==='index')assert.doesNotMatch(r.trace,/^helper /m);
});
for(const name of ['ffmpeg','ffprobe'])test(name+' version failure is fatal even when both paths exist',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe'],broken:name});assert.equal(r.status,44,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE agent-media-tools/);
});
test('helper success with missing ffprobe still fails closed',t=>{
 const r=invoke(t,{absent:'ffprobe'});assert.notEqual(r.status,0);assert.doesNotMatch(r.output,/PREFLIGHT_DONE agent-media-tools/);
});
for(const slow of ['index','helper'])test('real GNU timeout kills slow '+slow+' within the common boundary',t=>{
 const r=invoke(t,{slow});assert.equal(r.status,124,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE agent-media-tools/);assert.match(r.trace,/^timeout --kill-after=5s 235s /m);
});
