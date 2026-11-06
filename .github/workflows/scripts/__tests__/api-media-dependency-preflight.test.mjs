import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const root=new URL('../../../../',import.meta.url);
const workflow=YAML.parse(readFileSync(new URL('../../ci-l4-runtime.yml',import.meta.url),'utf8'));
const findStep=w=>w.jobs['api-test'].steps.find(s=>s.name==='Install media tools required by current video contracts');
function validate(w){
 const job=w.jobs['api-test'],step=findStep(w);
 assert.equal(job['timeout-minutes'],15);
 assert.equal(step['timeout-minutes'],5);
 assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
 assert.equal(step.run.trim(),'timeout --signal=KILL 240s bash .github/workflows/scripts/prepare-api-media-tools.sh');
 assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.run==='npx vitest run --coverage'));
}
function invoke(t,{present=[],failed='',broken='',absent='',slow='',font='ready',afterFont='ready'}={}){
 const top=mkdtempSync(join(tmpdir(),'api-media-preflight-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const trace=join(top,'trace'),fontFile=join(top,'NotoSansCJK-Regular.ttc');writeFileSync(trace,'');
 if(font!=='missing-file')writeFileSync(fontFile,'isolated fixture font bytes');
 const realTimeout=['/usr/bin/timeout','/opt/homebrew/bin/gtimeout'].find(existsSync);
 assert.ok(realTimeout,'real GNU timeout is required to test bounded slow transport');
 const put=(name,script)=>writeFileSync(join(top,name),'#!/bin/sh\n'+script+'\n',{mode:0o755});
 const toolScript=name=>name==='fc-match'?`printf 'font-check %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$MEDIA_BROKEN" != fc-match ] || exit 44
 case "$*" in *family*) if [ "$MEDIA_FONT" = fallback ]; then printf DejaVu; else printf 'Noto Sans CJK SC'; fi;; *file*) printf '%s' "$MEDIA_FONT_FILE";; *) printf fontconfig;; esac`:
 `printf 'version ${name} %s\\n' "$*" >> "$MEDIA_TRACE"\n[ "$MEDIA_BROKEN" != '${name}' ] || exit 44`;
 // Only subprocess-boundary tools are modeled. The real YAML, wrapper and timeout execute.
 put('timeout',`printf 'timeout %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$1" = --signal=KILL ] || exit 45
 shift
 [ "$1" = 240s ] || exit 45
 shift
 if [ -n "$MEDIA_SLOW" ]; then exec "${realTimeout}" --signal=KILL 0.2s "$@"; fi
 exec "$@"`);
 put('sudo','exec "$@"');
 put('apt-get',`printf 'apt %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$MEDIA_FAILED" != index ] || exit 43
 [ "$MEDIA_SLOW" != index ] || /bin/sleep 10`);
 const createTools=['ffmpeg','ffprobe','fc-match'].map(name=>`if [ "$MEDIA_ABSENT" != '${name}' ]; then /bin/cp "$MEDIA_BIN/template-${name}" "$MEDIA_BIN/${name}"; fi`).join('\n');
 for(const name of ['ffmpeg','ffprobe','fc-match'])put('template-'+name,toolScript(name));
 put('bash',`case "$1" in *prepare-openclaw-os-packages.sh)
 printf 'helper %s\\n' "$*" >> "$MEDIA_TRACE"
 [ "$MEDIA_FAILED" != helper ] || exit 43
 [ "$MEDIA_SLOW" != helper ] || /bin/sleep 10
 [ "$MEDIA_SLOW" != helper-ignore-term ] || { trap '' TERM; while :; do /bin/sleep 10; done; }
 ${createTools}
 if [ "$MEDIA_AFTER_FONT" != missing-file ]; then printf 'installed fixture font bytes' > "$MEDIA_FONT_FILE"; fi
 /bin/touch "$MEDIA_BIN/installed"
 ;; *) exec /bin/bash "$@";; esac`);
 // After installation fontconfig reads the modeled post-install state.
 const fc=toolScript('fc-match').replace('[ "$MEDIA_BROKEN"', '[ ! -e "$MEDIA_BIN/installed" ] || MEDIA_FONT="$MEDIA_AFTER_FONT"\n[ "$MEDIA_BROKEN"');
 put('template-fc-match',fc);
 for(const name of present)put(name,name==='fc-match'?fc:toolScript(name));
 const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',findStep(workflow).run],{cwd:root,encoding:'utf8',timeout:4000,
  env:{PATH:top,RUNNER_TEMP:top,MEDIA_BIN:top,MEDIA_TRACE:trace,MEDIA_FAILED:failed,MEDIA_BROKEN:broken,MEDIA_ABSENT:absent,MEDIA_SLOW:slow,MEDIA_FONT:font,MEDIA_AFTER_FONT:afterFont,MEDIA_FONT_FILE:fontFile}});
 assert.equal(result.error,undefined);
 return {status:result.status,signal:result.signal,output:result.stdout+result.stderr,trace:readFileSync(trace,'utf8')};
}
test('API preparation keeps15min job and one240s shell boundary before coverage tests',()=>validate(workflow));
test('required API preparation rejects deadline, bypass and continuation mutations',()=>{
 for(const mutate of [w=>{w.jobs['api-test']['timeout-minutes']=16;},w=>{findStep(w)['timeout-minutes']=6;},w=>{findStep(w).run='true';},w=>{findStep(w).run=findStep(w).run.replace('240s','300s');},w=>{findStep(w)['continue-on-error']=true;},w=>{findStep(w).if='always()';}]){
  const changed=structuredClone(workflow);mutate(changed);assert.throws(()=>validate(changed));
 }
});
test('actual YAML runs bounded original index then signed-plan helper with all three original packages',t=>{
 const r=invoke(t);assert.equal(r.status,0,r.output);
 assert.match(r.trace,/^timeout --signal=KILL 240s bash .github\/workflows\/scripts\/prepare-api-media-tools.sh/m);
 assert.match(r.trace,/^apt .*Acquire::Retries=1.*Acquire::http::Timeout=20.*Acquire::https::Timeout=20.*APT::Update::Error-Mode=any update/m);
 assert.match(r.trace,/^helper .github\/workflows\/scripts\/prepare-openclaw-os-packages.sh \S+ \/etc\/apt\/sources.list.d\/ubuntu.sources \/etc\/apt\/apt-mirrors.txt ffmpeg fontconfig fonts-noto-cjk$/m);
 assert.ok(r.trace.indexOf('apt ')<r.trace.indexOf('helper '));assert.doesNotMatch(r.trace,/^apt .*install/m);
 for(const name of ['ffmpeg','ffprobe'])assert.match(r.trace,new RegExp('version '+name+' -version'));
 assert.match(r.trace,/font-check .*family/);assert.match(r.trace,/font-check .*file/);
 assert.match(r.output,/PREFLIGHT_DONE api-media-tools/);
});
test('preinstalled media tools and actual CJK font skip acquisition but still execute tool and font readbacks',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe','fc-match']});assert.equal(r.status,0,r.output);assert.doesNotMatch(r.trace,/^apt |^helper /m);
 for(const name of ['ffmpeg','ffprobe'])assert.match(r.trace,new RegExp('version '+name+' -version'));
 assert.match(r.trace,/font-check .*file/);
});
for(const name of ['ffmpeg','ffprobe','fc-match'])test('missing '+name+' cannot be concealed by other installed tools',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe','fc-match'].filter(x=>x!==name)});assert.equal(r.status,0,r.output);assert.match(r.trace,/^helper .* ffmpeg fontconfig fonts-noto-cjk$/m);
});
for(const font of ['fallback','missing-file'])test('preinstalled fontconfig with '+font+' still requires full package acquisition',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe','fc-match'],font});assert.equal(r.status,0,r.output);assert.match(r.trace,/^helper .* ffmpeg fontconfig fonts-noto-cjk$/m);
});
for(const failed of ['index','helper'])test(failed+' failure blocks completion and coverage tests',t=>{
 const r=invoke(t,{failed});assert.equal(r.status,43,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE api-media-tools/);assert.doesNotMatch(r.trace,/version /);if(failed==='index')assert.doesNotMatch(r.trace,/^helper /m);
});
for(const name of ['ffmpeg','ffprobe','fc-match'])test(name+' execution failure is fatal despite installed paths',t=>{
 const r=invoke(t,{present:['ffmpeg','ffprobe','fc-match'],broken:name});assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE api-media-tools/);
});
for(const name of ['ffmpeg','ffprobe','fc-match'])test('helper success with missing '+name+' still fails closed',t=>{
 const r=invoke(t,{absent:name});assert.notEqual(r.status,0);assert.doesNotMatch(r.output,/PREFLIGHT_DONE api-media-tools/);
});
for(const afterFont of ['fallback','missing-file'])test('helper success with '+afterFont+' CJK font still fails closed',t=>{
 const r=invoke(t,{font:'missing-file',afterFont});assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE api-media-tools/);
});
for(const slow of ['index','helper','helper-ignore-term'])test('real GNU timeout kills '+slow+' inside the single common boundary',t=>{
 const started=performance.now(),r=invoke(t,{slow});assert.ok(r.status===137 || r.signal==='SIGKILL',JSON.stringify(r));assert.ok(performance.now()-started<3000);assert.doesNotMatch(r.output,/PREFLIGHT_DONE api-media-tools/);assert.match(r.trace,/^timeout --signal=KILL 240s /m);
});
