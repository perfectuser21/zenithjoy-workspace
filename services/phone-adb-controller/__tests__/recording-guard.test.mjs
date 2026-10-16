import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const ctl=new URL('../douyin-phone-adb',import.meta.url).pathname;
test('real recording CLI returns its guard, refuses foreign stop and permits owned stop',()=>{
 const d=mkdtempSync(join(tmpdir(),'record-cli-guard-')),owner='probe-capture-owned';let pid;
 const native=new URL('./fixtures/real-honor-native-audio-playing.txt',import.meta.url).pathname;
 writeFileSync(join(d,'registry'),'p1\tSER1\tMODEL\t1199\t2663\n');
 writeFileSync(join(d,'adb'),`#!/bin/sh
case "$*" in
 *get-state*) echo device;;
 *ro.build.version.sdk*) echo 36;;
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
 const env={...process.env,DOUYIN_PHONE_REGISTRY:join(d,'registry'),DOUYIN_PHONE_TMP_ROOT:join(d,'tmp'),DOUYIN_ADB_BIN:join(d,'adb'),DOUYIN_SCRCPY_BIN:join(d,'scrcpy'),DOUYIN_FFPROBE_BIN:join(d,'ffprobe'),DOUYIN_FFMPEG_BIN:join(d,'ffmpeg'),DOUYIN_PYTHON_BIN:'/usr/bin/python3'};
 const run=(...args)=>spawnSync('zsh',[ctl,'--profile','p1',...args],{env,encoding:'utf8',timeout:15000});
 try{
  assert.equal(run('lock-acquire',owner).status,0);
  const start=run('--lock-owner',owner,'record-start','guard-probe','5');
  const pidfile=join(d,'tmp/evidence/p1/guard-probe.rec.pid');if(existsSync(pidfile))pid=Number(readFileSync(pidfile,'utf8'));
  assert.equal(start.status,0,start.stderr);assert.match(start.stdout,/record_started/);
  assert.equal(run('lock-refresh',owner).status,0,'background recorder must not retain the bounded command guard FD');
  const foreign=run('--lock-owner','other-owner','record-stop','guard-probe');assert.notEqual(foreign.status,0);assert.ok(pid>1);process.kill(pid,0);
  const stop=run('--lock-owner',owner,'record-stop','guard-probe');assert.equal(stop.status,0,stop.stderr);assert.match(stop.stdout,/record_stopped/);
  assert.equal(run('lock-release-exact',owner).status,0);
 }finally{
  if(pid){const r=spawnSync('/bin/ps',['-ww','-p',String(pid),'-o','stat=,command='],{encoding:'utf8'});if(r.status===0&&!r.stdout.trim().startsWith('Z')){assert.ok(r.stdout.includes(join(d,'scrcpy')),'fixture process identity changed');try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}}
  rmSync(d,{recursive:true,force:true});
 }
});
