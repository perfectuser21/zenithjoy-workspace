import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const ctl=new URL('../douyin-phone-adb',import.meta.url).pathname;
test('SDK31 runtime resolves from the real controller path when caller cwd differs',()=>{
 const d=mkdtempSync(join(tmpdir(),'record-cli-guard-')),owner='probe-capture-owned';let pid;
 const native=new URL('./fixtures/real-honor-native-audio-playing.txt',import.meta.url).pathname;
 writeFileSync(join(d,'registry'),'p1\tSER1\tMODEL\t1199\t2663\n');
 writeFileSync(join(d,'adb'),`#!/bin/sh
case "$*" in
 *get-state*) echo device;;
 *ro.build.version.sdk*) echo 31;;
 *'dumpsys window'*) echo 'mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}';;
 *'cmd package list packages'*) echo 'package:com.ss.android.ugc.aweme uid:10203';;
 *'volume --stream 3 --get'*) echo 'volume is 1 in range [0..17]';;
 *'dumpsys audio'*) cat '${native}';;
 *'dumpsys media_session'*) echo '';;
esac
`,{mode:0o755});
 writeFileSync(join(d,'scrcpy'),`#!/bin/sh
for arg; do case "$arg" in --record=*) out="\${arg#--record=}";; esac; done
trap 'exit 0' INT TERM
printf media > "$out"
printf 'INFO: Recording started to matroska file: %s\n' "$out"
while :; do sleep .05; done
`,{mode:0o755});
 writeFileSync(join(d,'ffprobe'),'#!/bin/sh\ncase "$*" in *format=duration*) echo 5.1;; *"-select_streams a"*) echo audio;; *"-select_streams v"*) echo video;; esac\n',{mode:0o755});
 writeFileSync(join(d,'ffmpeg'),'#!/bin/sh\necho "mean_volume: -35 dB" >&2\n',{mode:0o755});
 writeFileSync(join(d,'python'),`#!/bin/sh
case "$1" in
 *runtime/scrcpy-runtime.py)
  if [ "$1" != "$EXPECTED_RUNTIME_HELPER" ]; then echo WRONG_SCRIPT_ROOT >&2;exit 19;fi
  echo RUNTIME_HELPER_LOCATED >&2;exit 19;;
esac
exec /usr/bin/python3 "$@"
`,{mode:0o755});
 const env={...process.env,DOUYIN_PHONE_REGISTRY:join(d,'registry'),DOUYIN_PHONE_TMP_ROOT:join(d,'tmp'),DOUYIN_ADB_BIN:join(d,'adb'),DOUYIN_SCRCPY_BIN:join(d,'scrcpy'),DOUYIN_FFPROBE_BIN:join(d,'ffprobe'),DOUYIN_FFMPEG_BIN:join(d,'ffmpeg'),DOUYIN_PYTHON_BIN:join(d,'python'),EXPECTED_RUNTIME_HELPER:new URL('../runtime/scrcpy-runtime.py',import.meta.url).pathname};
 const run=(...args)=>spawnSync('zsh',[ctl,'--profile','p1',...args],{env,cwd:d,encoding:'utf8',timeout:15000});
 try{
  assert.equal(run('lock-acquire',owner).status,0);
  const start=run('--lock-owner',owner,'record-start','guard-probe','5');
  const pidfile=join(d,'tmp/evidence/p1/guard-probe.rec.pid');if(existsSync(pidfile))pid=Number(readFileSync(pidfile,'utf8'));
  assert.notEqual(start.status,0);assert.match(start.stderr,/RUNTIME_HELPER_LOCATED/);assert.doesNotMatch(start.stderr,/WRONG_SCRIPT_ROOT/);assert.equal(existsSync(pidfile),false);
  assert.equal(run('lock-release-exact',owner).status,0);
 }finally{
  if(pid){const r=spawnSync('/bin/ps',['-ww','-p',String(pid),'-o','stat=,command='],{encoding:'utf8'});if(r.status===0&&!r.stdout.trim().startsWith('Z')){assert.ok(r.stdout.includes(join(d,'scrcpy')),'fixture process identity changed');try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}}
  rmSync(d,{recursive:true,force:true});
 }
});
