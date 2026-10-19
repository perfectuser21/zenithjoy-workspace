import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const controller=new URL('../douyin-phone-adb',import.meta.url).pathname;
const fixtures=new URL('./fixtures/',import.meta.url).pathname;
function recordBoundary({session='playing',playFails=false,mediaTarget='com.ss.android.ugc.aweme/FeedPlayerSession/8101',targetChanges=false,native='started',nativeSequence=[],uidMode='unique',playControl=true,nativeAfterTap='started',nativeAfterTapSequence=[],probeMode='record',foregroundChanges=false,recoveryAfterVolume='started',activeRecording=false,initialWrong=false,volumeReadAfterUp='normal',volumeUpSaturated=false,sdk='36',scrcpyOptOut=false,sdkRace='',captureMode='ready',captureOwner='normal',sdk31Runtime=false,sdk33Runtime=true,sdk31Codec='pcm_s16le',workflowRemainingSeconds=null,captureMaxSeconds=25,captureStop='graceful'}={}){
 const d=mkdtempSync(join(tmpdir(),'record-playback-boundary-'));
 try{
  // 只读RED可指定冻结git源的私有副本；生产及默认GREEN仍用仓库实际控制器。
  const text=readFileSync(process.env.RECORD_BOUNDARY_FROZEN_SOURCE||controller,'utf8');
  const fn=text.slice(text.indexOf('record_start() {'),text.indexOf('\nrecord_status() {')).replaceAll("'/bin/ps'",JSON.stringify(join(d,'capture-ps')));
  const adb=join(d,'adb');
  for(const kind of ['paused','playing'])writeFileSync(join(d,'native-'+kind),readFileSync(join(fixtures,'real-honor-native-audio-'+kind+'.txt')));
  if(sdk31Runtime)writeFileSync(join(d,'native-playing'),readFileSync(join(fixtures,'sdk31-native/actual-current-audio.txt'),'utf8').replaceAll('10095/','10203/'));
  const playXml=readFileSync(join(fixtures,'real-honor-paused-play-control.xml'),'utf8');
  let controlXml=playControl==='pause'?playXml.replace('content-desc="播放视频，按钮"','content-desc="暂停视频，按钮"'):playControl?playXml:'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="视频素材白三角" clickable="true" enabled="true" bounds="[300,600][800,1800]"/></hierarchy>';
  if(playControl==='newSemanticId')controlXml=readFileSync(join(fixtures,'real-honor-20261015-semantic-player.xml'),'utf8');
  if(playControl==='mixedResourceMultiple')controlXml=playXml.replace('</hierarchy>','<node package="com.ss.android.ugc.aweme" resource-id="com.ss.android.ugc.aweme:id/qbv" content-desc="播放视频，按钮" clickable="true" enabled="true" bounds="[0,0][1200,2504]"/></hierarchy>');
  if(playControl==='wrongId')controlXml=playXml.replace('resource-id="com.ss.android.ugc.aweme:id/qbt"','resource-id="com.ss.android.ugc.aweme:id/unknown"');
  if(playControl==='multiple')controlXml=playXml.replace('</hierarchy>','<node package="com.ss.android.ugc.aweme" resource-id="com.ss.android.ugc.aweme:id/qbt" content-desc="暂停视频，按钮" clickable="true" enabled="true" bounds="[0,0][1200,2504]"/></hierarchy>');
  writeFileSync(join(d,'play.xml'),controlXml);
  writeFileSync(adb,`#!/bin/zsh
print -r -- "$*" >> "$FIXTURE/calls"
if [[ "$*" == *'getprop ro.build.version.sdk'* ]]; then print -r -- "$SDK";exit 0;fi
if [[ "$*" == *'cmd package list packages'* ]]; then
 print 'package:com.ss.android.ugc.aweme uid:10203'
 [[ "$UID_MODE" != shared || "$*" != *'--uid'* ]] || print 'package:com.other.shared uid:10203'
 exit 0
fi
if [[ "$*" == *'cmd media_session volume --stream 3 --set '* ]]; then print "$argv[-1]" > "$FIXTURE/volume";touch "$FIXTURE/volume-cycle";exit 0;fi
if [[ "$*" == *'cmd media_session volume --stream 3 --get'* ]]; then
 if [[ -f "$FIXTURE/up-issued" && ! -f "$FIXTURE/volume-cycle" ]]; then [[ "$READ_AFTER_UP" != unknown ]] || { print unknown;exit 0; }; [[ "$READ_AFTER_UP" != unchanged ]] || { print "volume is 1 in range [0..17]";exit 0; }; fi
 v=1; [[ ! -f "$FIXTURE/volume" ]] || v="$(cat "$FIXTURE/volume")"; print "volume is $v in range [0..17]"; exit 0
fi
if [[ "$*" == *'input keyevent KEYCODE_VOLUME_'* ]]; then
 v=1; [[ ! -f "$FIXTURE/volume" ]] || v="$(cat "$FIXTURE/volume")"; if [[ "$*" == *KEYCODE_VOLUME_UP* ]]; then if [[ "$UP_SATURATED" == 1 ]]; then print "$v" > "$FIXTURE/volume";else print $((v+1)) > "$FIXTURE/volume";fi; touch "$FIXTURE/up-issued"; else print $((v-1)) > "$FIXTURE/volume"; touch "$FIXTURE/volume-cycle"; fi; exit 0
fi
if [[ "$*" == *'dumpsys audio'* ]]; then
 current="$NATIVE"; [[ ! -f "$FIXTURE/tapped" ]] || current="$AFTER_TAP"
 audio_count=0; [[ ! -f "$FIXTURE/audio-count" ]] || audio_count="$(cat "$FIXTURE/audio-count")"
 print $((audio_count+1)) > "$FIXTURE/audio-count"
 sequence=( ${nativeSequence.map(value=>{assert.match(value,/^[a-zA-Z]+$/);return value;}).join(' ')} )
 if (( \${#sequence} > 0 )); then
  sequence_index=$((audio_count+1)); (( sequence_index <= \${#sequence} )) || sequence_index=\${#sequence}
  current="$sequence[$sequence_index]"
 fi
 after_sequence=( ${nativeAfterTapSequence.map(value=>{assert.match(value,/^[a-zA-Z]+$/);return value;}).join(' ')} )
 if [[ -f "$FIXTURE/tapped" ]] && (( \${#after_sequence} > 0 )); then
  after_count=0; [[ ! -f "$FIXTURE/after-audio-count" ]] || after_count="$(cat "$FIXTURE/after-audio-count")"
  print $((after_count+1)) > "$FIXTURE/after-audio-count"
  after_index=$((after_count+1)); (( after_index <= \${#after_sequence} )) || after_index=\${#after_sequence}
  current="$after_sequence[$after_index]"
 fi
 [[ ! -f "$FIXTURE/volume-cycle" ]] || current="$AFTER_VOLUME"
 case "$current" in
 streamPort) sed 's/mutedState:none/mutedState:streamVolume portVolume/' "$FIXTURE/native-playing";;
 streamPortForeign) sed -e 's/mutedState:none/mutedState:streamVolume portVolume/' -e 's/state:paused/state:started/' "$FIXTURE/native-playing";;
 mixedTarget) sed -e 's#u/pid:10099/#u/pid:10203/#' -e 's/state:paused/state:started/' "$FIXTURE/native-playing";;
 streamPortMultiple) sed -e 's/mutedState:none/mutedState:streamVolume portVolume/' -e 's/u\/pid:10099\//u\/pid:10203\//' -e 's/state:paused/state:started/' "$FIXTURE/native-playing";;
 started) cat "$FIXTURE/native-playing";;
 paused) cat "$FIXTURE/native-paused";;
 other) sed 's#u/pid:10203/#u/pid:10999/#' "$FIXTURE/native-playing";;
 history) cat "$FIXTURE/native-paused";cat "$FIXTURE/native-playing";;
 foreignUnparsed) awk 'index($0,"u/pid:10099/") {sub(/state:paused/,"state:started");sub(/mutedState:[^{}]*FormatInfo/,"FormatInfo")} {print}' "$FIXTURE/native-playing";;
 foreign) sed -e 's/state:paused/state:started/' -e 's/mutedState:streamVolume portVolume/mutedState:none/' "$FIXTURE/native-playing";;
 muted) sed 's/mutedState:none/mutedState:clientVolume/' "$FIXTURE/native-playing";;
 *) print unknown;;
 esac
 exit 0
fi
if [[ "$*" == *'input tap'* ]]; then print tapped > "$FIXTURE/tapped";exit 0;fi
if [[ "$*" == *'uiautomator dump'* ]]; then [[ "$FG_CHANGES" != 1 ]] || print switched > "$FIXTURE/fg-switched";exit 0;fi
if [[ "$*" == *'stat -c %s'* ]]; then wc -c < "$FIXTURE/play.xml" | tr -d '[:space:]';exit 0;fi
if [[ "$*" == *' pull '* ]]; then cp "$FIXTURE/play.xml" "$argv[-1]";exit 0;fi
if [[ "$*" == *'keyevent 126'* ]]; then ${playFails?'exit 1':'exit 0'}; fi
if [[ "$*" == *'dumpsys media_session'* ]]; then
count=0; [[ ! -f "$FIXTURE/session-count" ]] || count="$(cat "$FIXTURE/session-count")"
print $((count+1)) > "$FIXTURE/session-count"
[[ "$TARGET_CHANGES" != 1 || "$count" == 0 ]] || MEDIA_TARGET=com.hihonor.cloudmusic/MediaSession/23
[[ "$MEDIA_TARGET" == absent ]] || print -r -- "  Media button session is $MEDIA_TARGET"
case "$SESSION" in
named) print '  package=com.hihonor.cloudmusic\\n  active=true\\n  state=PlaybackState {state=PAUSED(2), position=17405}\\n  package=com.ss.android.ugc.aweme\\n  active=true\\n  state=PlaybackState {state=PLAYING(3), position=50}' ;;
actualHonor) print '  package=com.android.server.telecom\\n  active=false\\n  package=com.hihonor.cloudmusic\\n  active=true\\n  state=PlaybackState {state=PAUSED(2), position=17405, buffered position=0, speed=1.0}' ;;
namedStopped) print '  package=com.ss.android.ugc.aweme\\n  active=true\\n  state=PlaybackState {state=STOPPED(1), position=0}' ;;
namedPaused) print '  package=com.ss.android.ugc.aweme\\n  active=true\\n  state=PlaybackState {state=PAUSED(2), position=50}' ;;
mismatch) print '  package=com.ss.android.ugc.aweme\\n  active=true\\n  state=PlaybackState {state=PAUSED(3), position=50}' ;;
playing) print '  package=com.ss.android.ugc.aweme\n  active=true\n  state=PlaybackState {state=3, position=50}' ;;
paused) print '  package=com.ss.android.ugc.aweme\n  active=true\n  state=PlaybackState {state=2, position=50}' ;;
other) print '  package=com.netease.cloudmusic\n  active=true\n  state=PlaybackState {state=3, position=50}\n  package=com.ss.android.ugc.aweme\n  active=true\n  state=PlaybackState {state=1, position=0}' ;;
inactive) print '  package=com.ss.android.ugc.aweme\n  active=false\n  state=PlaybackState {state=3, position=50}' ;;
unknown) print 'unexpected output' ;;
esac
fi
`,{mode:0o755});
  writeFileSync(join(d,'scrcpy'),`#!/bin/zsh
print -rl -- "$@" > "$FIXTURE/scrcpy-args"
[[ "$SCRCPY_OPTOUT" != 1 ]] || { print -u2 audio_capture_opt_out;exit 1; }
# Only controlled negative recorders survive TERM so the real controller can verify KILL.
# Foreign/unknown ownership fixtures retain graceful exit for the harness's safe cleanup.
if [[ "$CAPTURE_STOP" == verified_escalation && "$CAPTURE_OWNER" == normal ]]; then
 trap 'print INT >> "$FIXTURE/capture-signal-seen"' INT
 trap 'print TERM >> "$FIXTURE/capture-signal-seen"' TERM
else
 trap 'print stopped > "$FIXTURE/capture-stopped"; exit 0' INT TERM
fi
print start >> "$FIXTURE/scrcpy-started"
print $$ > "$FIXTURE/fixture-recorder.pid"
[[ "$CAPTURE_MODE" != early_exit ]] || exit 0
[[ "$CAPTURE_MODE" != delayed ]] || /bin/sleep 0.15
container=matroska
record_path="$FIXTURE/probe.rec.mkv"
[[ "$SDK31_RUNTIME" != 1 ]] || { container=wav; record_path="$FIXTURE/probe.rec.wav"; }
case "$CAPTURE_MODE" in
  no_ready) ;;
  completed_alive) print media > "$record_path"; print "INFO: Recording started to $container file: $record_path"; print "INFO: Recording complete to $container file: $record_path" ;;
  wrong_path) print media > "$record_path"; print "INFO: Recording started to $container file: $FIXTURE/wrong.rec.mkv" ;;
  delayed_growth) touch "$record_path"; print "INFO: Recording started to $container file: $record_path"; for tick in {1..90}; do /bin/sleep 0.1; done; print media > "$record_path" ;;
  empty_file) touch "$record_path"; print "INFO: Recording started to $container file: $record_path" ;;
  no_file) print "INFO: Recording started to $container file: $record_path" ;;
  *) print media > "$record_path"; print "INFO: Recording started to $container file: $record_path" ;;
esac
for i in {1..3000}; do /bin/sleep 0.01; done
`,{mode:0o755});
  writeFileSync(join(d,'capture-ps'),`#!/bin/zsh
if [[ "$CAPTURE_OWNER" == unknown ]]; then exit 1; fi
if [[ "$CAPTURE_OWNER" == foreign ]]; then print '99999 1 Sat Oct 17 01:02:03 2026 /unrelated/capture --record=elsewhere'; exit 0; fi
exec /bin/ps "$@"
`,{mode:0o755});
  // 其余真实控制器辅助函数后续按相同命名边界加载；只替换设备/等待/页面守卫。
  writeFileSync(join(d,'ffprobe'),`#!/bin/zsh\n[[ \"$*\" != *stream=codec_name* ]] || { print \"$SDK31_CODEC\";exit 0; }\n[[ \"$SDK31_RUNTIME\" != 1 || \"$*\" != *'-select_streams v'* ]] || exit 0\ncase \"$*\" in *format=duration*) print 25;; *stream=codec_type*) [[ \"$*\" != *'-select_streams a'* ]] && print video || print audio;; esac\n`,{mode:0o755});
  writeFileSync(join(d,'ffmpeg'),`#!/bin/zsh
print -u2 -- "mean_volume: -35 dB"
if [[ "$*" == *pipe:1* ]]; then /usr/bin/python3 -c 'import sys;sys.stdout.buffer.write(bytes([20,1])*400000)';fi
`,{mode:0o755});
  const stopFn=text.slice(text.indexOf('record_stop() {'),text.indexOf('record_extract_audio() {')).replace('"${0:A:h}/decode-recording.py"',JSON.stringify(new URL('../decode-recording.py',import.meta.url).pathname));
  const helpers=text.slice(text.indexOf('record_pid_file()'),text.indexOf('# set_playback_speed'));
  const extraStart=text.indexOf('record_playback_');
  const volumeHelpers=text.slice(text.indexOf('media_volume() {'),text.lastIndexOf('\n#',text.indexOf('record_playback_state() {')));
  const extra=extraStart>=0?text.slice(text.lastIndexOf('\n',extraStart-1)+1,text.indexOf('record_start() {')):'';
  const pinnedKind=sdk31Runtime?'sdk31':Number(sdk)>=33&&sdk33Runtime?'sdk33':null;
  const approved=pinnedKind?JSON.parse(readFileSync(new URL('../runtime/runtime-policy'+(pinnedKind==='sdk33'?'-sdk33':'')+'.json',import.meta.url),'utf8')):null;
  if(approved)writeFileSync(join(d,'probe.capture-runtime.json'),JSON.stringify({runtime:{verified:true,schema:approved.schema,version:approved.version,client_sha256:approved.client_sha256,server_sha256:approved.server_sha256},stage:{verified:true}}));
  const runtimeStub=approved?`record_sdk31_runtime(){ [[ "$2" == ${pinnedKind} ]] || return 1; SCRCPY=$FIXTURE/scrcpy; CAPTURE_RUNTIME_FIELDS='capture_runtime_client_sha256=${approved.client_sha256} capture_runtime_server_sha256=${approved.server_sha256}'; }`:'';
  const script=`setopt NO_UNSET\nADB=$FIXTURE/adb\nSCRCPY=$FIXTURE/scrcpy\nFFPROBE=$FIXTURE/ffprobe\nFFMPEG=$FIXTURE/ffmpeg\nSERIAL=test\nLOCK_OWNER=fixture-sdk31-owner\nDOUYIN_PACKAGE=com.ss.android.ugc.aweme\nEVIDENCE_ROOT=$FIXTURE\nRECORD_MEDIA_VOLUME=1\nPYTHON_BIN=/usr/bin/python3\nREMOTE_UI=/fake/ui\nSCREEN_W=1200\nSCREEN_H=2664\nrequire_evidence_id(){ return 0; }\nrequire_uint(){ return 0; }\ndie(){ print -u2 -- "$*"; exit 2; }\nwait_ms(){ if [[ "$1" == (500|2000) ]]; then /bin/sleep 0.02; fi; if [[ "$1" == 1500 ]]; then for i in {1..20}; do [[ ! -f "$FIXTURE/scrcpy-started" ]] || return 0; /bin/sleep 0.01; done; fi; return 0; }\n${volumeHelpers}\nforeground_package(){ if [[ -f "$FIXTURE/fg-switched" ]]; then print "mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.search.activity.SearchResultActivity}"; else print "mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}"; fi; }\n_foreground_is_exact_douyin(){ return 0; }\n_on_video_detail(){ return 0; }\nforeground_gate(){ return 0; }\n${helpers}\n${extra}\n${runtimeStub}\n${fn}\n${stopFn}\n${activeRecording?'print $$ > $FIXTURE/other.rec.pid':''}\n${initialWrong?'touch $FIXTURE/fg-switched':''}\n${sdkRace?`print ORIGINAL > $FIXTURE/sdk-protected\nTRAPDEBUG(){ if [[ \"$ZSH_DEBUG_CMD\" == *'capture-sdk.txt'* && \"$ZSH_DEBUG_CMD\" == *'$sdk'* && \"$ZSH_DEBUG_CMD\" != '[['* && ! -e $FIXTURE/sdk-race-injected ]]; then touch $FIXTURE/sdk-race-injected; ${sdkRace==='symlink'?'ln -s $FIXTURE/sdk-protected $FIXTURE/probe.capture-sdk.txt':'print PREEXISTING > $FIXTURE/probe.capture-sdk.txt'}; fi; }`:''}\n${probeMode==='session'?'record_playback_state probe':probeMode==='stop'?'record_start probe '+captureMaxSeconds+'; record_stop probe':'record_start probe '+captureMaxSeconds}\n`;
  const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,FIXTURE:d,PHONE_CONTROLLER_DIR:new URL('../',import.meta.url).pathname,SESSION:session,MEDIA_TARGET:mediaTarget,TARGET_CHANGES:targetChanges?'1':'0',NATIVE:native,UID_MODE:uidMode,AFTER_TAP:nativeAfterTap,FG_CHANGES:foregroundChanges?'1':'0',AFTER_VOLUME:recoveryAfterVolume,READ_AFTER_UP:volumeReadAfterUp,UP_SATURATED:volumeUpSaturated?'1':'0',SDK:sdk,SDK31_RUNTIME:sdk31Runtime?'1':'0',SDK31_CODEC:sdk31Codec,SCRCPY_OPTOUT:scrcpyOptOut?'1':'0',CAPTURE_MODE:captureMode,CAPTURE_OWNER:captureOwner,CAPTURE_STOP:captureStop,...(workflowRemainingSeconds===null?{}:{WF_RUN_START_TS:String(Date.now()/1000),WF_RUN_MAX_SECONDS:String(workflowRemainingSeconds)})},timeout:20000});
  const readyPath=join(d,sdk31Runtime?'probe.rec.wav':'probe.rec.mkv');const captureReadyAtReturn=existsSync(readyPath)&&statSync(readyPath).size>0;const captureSignalSeen=existsSync(join(d,'capture-signal-seen'))?readFileSync(join(d,'capture-signal-seen'),'utf8').trim().split('\n'):[];
  let fixtureExitAtReturn='unknown';
  const fixturePidPath=join(d,'fixture-recorder.pid');
  if(existsSync(fixturePidPath)){
   const pid=Number(readFileSync(fixturePidPath,'utf8').trim());
   if(Number.isSafeInteger(pid)&&pid>1){
    const observation=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',timeout:500});
    const state=(observation.stdout??'').trim();
    if((observation.status===1&&!state)||(observation.status===0&&state.startsWith('Z')))fixtureExitAtReturn='gone';
    else if(observation.status===0&&state)fixtureExitAtReturn='alive';
   }
  }
  // A trap marker proves signal receipt only; independently observe exit before cleanup.
  const stoppedBeforeHarnessCleanup=fixtureExitAtReturn==='gone'&&(existsSync(join(d,'capture-stopped'))||captureSignalSeen.includes('TERM'));

  const rawEvidence=Object.fromEntries(['media-session.txt','foreground.txt'].map(kind=>{const f=join(d,'probe-playback-start.'+kind);return [kind,existsSync(f)?{sha256:createHash('sha256').update(readFileSync(f)).digest('hex'),mode:statSync(f).mode&0o777}:null];}));
  return {...r,captureStartup:existsSync(join(d,'probe.capture-startup.json'))?JSON.parse(readFileSync(join(d,'probe.capture-startup.json'),'utf8')):null,captureReadyAtReturn,stoppedBeforeHarnessCleanup,fixtureExitAtReturn,captureSignalSeen,sdkRaceInjected:existsSync(join(d,'sdk-race-injected')),sdkProtected:existsSync(join(d,'sdk-protected'))?readFileSync(join(d,'sdk-protected'),'utf8').trim():null,sdkOriginal:existsSync(join(d,'probe.capture-sdk.txt'))?readFileSync(join(d,'probe.capture-sdk.txt'),'utf8').trim():null,scrcpyArgs:existsSync(join(d,'scrcpy-args'))?readFileSync(join(d,'scrcpy-args'),'utf8').trim().split('\n'):[],finalVolume:existsSync(join(d,'volume'))?readFileSync(join(d,'volume'),'utf8').trim():'1',restoredEvidence:existsSync(join(d,'probe-playback-restored.native-audio.json')),rawEvidence,started:existsSync(join(d,'scrcpy-started')),calls:existsSync(join(d,'calls'))?readFileSync(join(d,'calls'),'utf8'):''};
 }finally{
  // Stop and observe this isolated fixture before deleting files its TERM trap can write.
  // Never retry rmSync while a live writer is still using the directory.
  const pidFile=existsSync(join(d,'fixture-recorder.pid'))?join(d,'fixture-recorder.pid'):join(d,'probe.rec.pid');
  if(existsSync(pidFile)){
   const pid=Number(readFileSync(pidFile,'utf8').trim());assert.ok(Number.isSafeInteger(pid)&&pid>1);
   const inspect=()=>{
    const result=spawnSync('/bin/ps',['-ww','-p',String(pid),'-o','stat=,command='],{encoding:'utf8',timeout:500});
    const output=(result.stdout??'').trim();
    if(result.status===1&&!output)return {kind:'gone',ps_exit:1,matched:false};
    if(result.status!==0)return {kind:'unverified',ps_exit:result.status??null,matched:false,reason:'ps_error'};
    const [state,...command]=output.split(/\s+/);
    if(state.startsWith('Z'))return {kind:'gone',ps_exit:0,matched:false};
    const matched=command.includes(join(d,'scrcpy'));
    return {kind:matched?'owned':'unverified',ps_exit:0,matched};
   };
   let observation=inspect();
   // Signal eligibility comes only from the first fresh exact observation.
   // After TERM (or any unverified observation), only observe: never signal a changed PID.
   if(observation.kind==='owned'){
    try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
   }
   const deadline=Date.now()+2000;
   while(observation.kind!=='gone'&&Date.now()<deadline){
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    observation=inspect();
   }
   assert.equal(observation.kind,'gone','fixture recorder exit unknown; preserve directory '+JSON.stringify(observation));
  }
  rmSync(d,{recursive:true,force:true});
 }
}
// Exercise the actual fixture cleanup; only OS process observations and clock are controlled.
function fixtureCleanupSequence(observations){
 const source=readFileSync(new URL(import.meta.url),'utf8');
 const start=source.indexOf('  // Stop and observe this isolated fixture');
 const end=source.indexOf('\n }\n}\n// Exercise the actual fixture cleanup',start);
 assert.ok(start>=0&&end>start,'locate the real recordBoundary finally body');
 let index=0,clock=0;const signals=[],removed=[];
 const samples={owned:{status:0,stdout:'S /bin/zsh /fixture/scrcpy --record=x\n',stderr:''},unknown:{status:0,stdout:'R (zsh)\n',stderr:''},foreign:{status:0,stdout:'S /foreign/secret-argument\n',stderr:''},gone:{status:1,stdout:'',stderr:''},zombie:{status:0,stdout:'Z (zsh)\n',stderr:''},psError:{status:2,stdout:'',stderr:'sensitive ps diagnostic'}};
 let error;
 try{runInNewContext(source.slice(start,end),{d:'/fixture',join,assert,Number,existsSync:()=>true,readFileSync:()=>'4321',spawnSync:(program,args)=>{assert.equal(program,'/bin/ps');assert.deepEqual(Array.from(args),['-ww','-p','4321','-o','stat=,command=']);return samples[observations[Math.min(index++,observations.length-1)]];},process:{kill:(pid,signal)=>signals.push([pid,signal])},rmSync:(path)=>removed.push(path),Date:{now:()=>clock+=250},Atomics:{wait:()=>{}},Int32Array,SharedArrayBuffer});}catch(caught){error=caught;}
 return {signals,removed,error,reads:index};
}
for(const sequence of [['owned','unknown','gone'],['unknown','gone'],['foreign','owned','gone'],['owned','gone'],['owned','zombie'],['psError','gone']])test('fixture退出清理只读等待暂态并仅首次owned可TERM '+sequence.join('→'),()=>{
 const r=fixtureCleanupSequence(sequence);assert.equal(r.error,undefined,r.error?.stack);assert.deepEqual(r.removed,['/fixture']);assert.deepEqual(r.signals,sequence[0]==='owned'?[[4321,'SIGTERM']]:[]);
});
for(const sequence of [['unknown'],['foreign'],['psError'],['owned','foreign']])test('fixture退出清理持久未知必须保目录 '+sequence.join('→'),()=>{
 const r=fixtureCleanupSequence(sequence);assert.ok(r.error,'persistent unverified exit must fail');assert.deepEqual(r.removed,[]);assert.deepEqual(r.signals,sequence[0]==='owned'?[[4321,'SIGTERM']]:[]);assert.ok(r.reads<20,'same two-second bound');assert.doesNotMatch(r.error.message,/secret-argument|sensitive ps diagnostic/,'do not print foreign argv or raw diagnostics');
});
// MediaSession只作诊断，保留严格原值解析；不再要求其PLAYING才代表真实native播放。
for(const [mediaTarget,expected] of [
 ['com.ss.android.ugc.aweme/FeedPlayerSession/8101','3'],
 ['com.ss.android.ugc.aweme/FeedPlayerSession/8101 (userId=0)','3'],
 ['com.ss.android.ugc.aweme.evil/FeedPlayerSession/8101 (userId=0)','unknown'],
 ['com.ss.android.ugc.aweme/FeedPlayerSession/8101 extra','unknown'],
 ['com.ss.android.ugc.aweme/FeedPlayerSession/8101 (userId=-1)','unknown'],
 ['com.ss.android.ugc.aweme/FeedPlayerSession/8101 (userId=abc)','unknown'],
 ['null','unknown'],
])test('MediaSession原值诊断严格解析 '+mediaTarget,()=>{const r=recordBoundary({session:'named',mediaTarget,probeMode:'session'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),expected);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/keyevent|input tap/);});
test('MediaSession原值PAUSED不会被native播放改写成3',()=>{const r=recordBoundary({session:'namedPaused',native:'started'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/media_session_state=2/);assert.match(r.stdout,/playback_state=2/);assert.match(r.stdout,/native_audio_state=started/);});
test('模拟设备首末原始存证私有并与stdout SHA相符',()=>{const r=recordBoundary();assert.equal(r.status,0,r.stderr);for(const p of Object.values(r.rawEvidence)){assert.ok(p);assert.equal(p.mode,0o600);assert.ok(r.stdout.includes(p.sha256));}});

// 真实HONOR当前native配置：录制客户端PID528不是MediaSession ownerPid，UID绑定才是归属。
test('native真started即使MediaSession STOPPED也可起录且不toggle',()=>{const r=recordBoundary({session:'namedStopped',native:'started'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/playback_proof_kind=native_audio/);assert.match(r.stdout,/native_audio_state=started/);assert.doesNotMatch(r.calls,/keyevent (126|85)|input tap/);});
test('native真paused只点fresh树明确播放视频控件一次，后started才起录',()=>{const r=recordBoundary({session:'namedPaused',native:'paused'});assert.equal(r.status,0,r.stderr);assert.equal(r.calls.split('\n').filter(l=>l.includes('input tap')).length,1);assert.match(r.calls,/input tap 600 1252/);assert.match(r.stdout,/native_audio_state=started/);});
for(const opts of [{native:'other'},{native:'history',nativeAfterTap:'history',playControl:false},{native:'muted'},{native:'unknown'},{uidMode:'shared'},{native:'paused',playControl:false},{native:'paused',nativeAfterTap:'paused'}])test('native缺证据/他人UID/历史日志/共享UID/白三角不许起录 '+JSON.stringify(opts),()=>{const r=recordBoundary(opts);assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);if(opts.playControl===false)assert.doesNotMatch(r.calls,/input tap/);});

test('抖音started但其他UID当前媒体AudioTrack也started时拒绝混音录制',()=>{const r=recordBoundary({native:'foreign'});assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);});

test('无法解析的其他UID当前MEDIA AudioTrack也不能静默忽略混音风险',()=>{const r=recordBoundary({native:'foreignUnparsed'});assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);});
test('新树读回后前台已切搜索页时禁止点播放控件旧坐标',()=>{const r=recordBoundary({native:'paused',foregroundChanges:true});assert.notEqual(r.status,0,r.stderr);assert.doesNotMatch(r.calls,/input tap/);});

// r1现场先读native paused，稍后fresh树显示“暂停视频”；这些序列明确为模拟时序，不冒充实机恢复事实。
for(const nativeSequence of [['paused','started'],['paused','paused','started']])test('native无动作复查：异步inactive到started才起录 '+nativeSequence.join('→'),()=>{
 const r=recordBoundary({session:'namedStopped',nativeSequence,playControl:'pause'});
 assert.equal(r.status,0,r.stderr);assert.equal(r.started,true);
 assert.doesNotMatch(r.calls,/input tap|keyevent (85|126|127)/,'原生音轨自行恢复时禁止点击或媒体键');
 assert.ok(r.calls.split('\n').filter(l=>l.includes('dumpsys audio')).length>=nativeSequence.length,'必须读取新鲜native证据');
 assert.match(r.stdout,/native_audio_state=started/);assert.match(r.stdout,/media_session_state=1/);assert.match(r.stdout,/playback_state=1/);
});
test('native无动作复查：稳定inactive加UI暂停最多单击后仍必须有界拒绝',()=>{
 const r=recordBoundary({session:'namedStopped',nativeSequence:['paused'],playControl:'pause'});
 assert.equal(r.error,undefined,'应在既有6秒测试上界内退出');assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);
 assert.doesNotMatch(r.calls,/keyevent (85|126|127)/);assert.doesNotMatch(r.stdout,/record_started|playback_verified=true/);
 assert.ok(r.calls.split('\n').filter(l=>l.includes('input tap')).length<=1,'实机事实允许单次qbt恢复，稳定inactive不能反复toggle');
 assert.ok(r.calls.split('\n').filter(l=>l.includes('dumpsys audio')).length<=12,'复查与点击后读回必须有明确次数上界');
});

// 0905独立实机核证paused→单击fresh唯一qbt暂停标签→started；这里模拟同一状态转换，不宣称测试为真机。
test('native单次qbt恢复：paused加暂停标签单击后真started才起录且保留MediaSession1',()=>{
 const r=recordBoundary({session:'namedStopped',native:'paused',playControl:'pause',nativeAfterTap:'started'});
 assert.equal(r.status,0,r.stderr);assert.equal(r.started,true);
 assert.equal(r.calls.split('\n').filter(l=>l.includes('input tap')).length,1);assert.match(r.calls,/input tap 600 1252/);
 assert.doesNotMatch(r.calls,/keyevent (85|126|127)/);assert.match(r.stdout,/native_audio_state=started/);
 assert.match(r.stdout,/media_session_state=1/);assert.match(r.stdout,/playback_state=1/);
});
for(const after of ['paused','foreign','unknown'])test('native单次qbt恢复：点击后'+after+'拒绝起录且最多一次点击',()=>{
 const r=recordBoundary({session:'namedStopped',native:'paused',playControl:'pause',nativeAfterTap:after});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);
 assert.ok(r.calls.split('\n').filter(l=>l.includes('input tap')).length<=1);assert.doesNotMatch(r.calls,/keyevent (85|126|127)/);
 assert.doesNotMatch(r.stdout,/record_started|playback_verified=true/);
});
for(const after of ['foreign','unknown'])test('native单次qbt恢复：点击后'+after+'不能继续等started洗白',()=>{
 const r=recordBoundary({session:'namedStopped',native:'paused',playControl:'pause',nativeAfterTapSequence:[after,'started']});
 assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);
 assert.ok(r.calls.split('\n').filter(l=>l.includes('input tap')).length<=1);assert.doesNotMatch(r.calls,/keyevent (85|126|127)/);
});
for(const playControl of ['multiple','mixedResourceMultiple',false])test('native单次qbt恢复：多个或缺语义播放控件不能点击 '+playControl,()=>{
 const r=recordBoundary({session:'namedStopped',native:'paused',playControl});
 assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/input tap|keyevent (85|126|127)/);
});
test('native单次qbt恢复：fresh树读取后native自行started，点击前复核必须跳过点击',()=>{
 const r=recordBoundary({session:'namedStopped',nativeSequence:['paused','paused','paused','started'],playControl:'pause'});
 assert.equal(r.status,0,r.stderr);assert.equal(r.started,true);assert.match(r.calls,/uiautomator dump/);
 assert.doesNotMatch(r.calls,/input tap|keyevent (85|126|127)/);assert.match(r.stdout,/playback_state=1/);
});
for(const before of ['unknown','foreign'])test('native单次qbt恢复：点击前'+before+'不得点击或等started洗白',()=>{
 const r=recordBoundary({session:'namedStopped',nativeSequence:['paused','paused','paused',before,'started'],playControl:true});
 assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/input tap|keyevent (85|126|127)/);
});
for(const nativeSequence of [['foreign','started'],['unknown','started'],['paused','foreign','started'],['paused','unknown','started']])test('native无动作复查：遇foreign或unknown仍拒绝，不等后续started洗白 '+nativeSequence.join('→'),()=>{
 const r=recordBoundary({session:'namedStopped',nativeSequence,playControl:'pause'});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);
 assert.doesNotMatch(r.calls,/input tap|keyevent (85|126|127)/);assert.doesNotMatch(r.stdout,/record_started|playback_verified=true/);
});

test('streamPort recovery uses one nonzero volume cycle and fresh native before recording',()=>{
 const r=recordBoundary({native:'streamPort'});assert.equal(r.status,0,r.stderr);assert.equal(r.started,true);
 assert.equal(r.calls.split('\n').filter(s=>s.includes('KEYCODE_VOLUME_UP')).length,1);assert.equal(r.calls.split('\n').filter(s=>s.includes('KEYCODE_VOLUME_DOWN')).length,1);
 assert.match(r.stdout,/native_audio_state=started/);assert.doesNotMatch(r.calls,/keyevent (85|126|127)|input tap/);
});
test('streamPort persistent mute fails closed after one cycle',()=>{const r=recordBoundary({native:'streamPort',recoveryAfterVolume:'streamPort'});assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);assert.equal(r.calls.split('\n').filter(s=>s.includes('KEYCODE_VOLUME_UP')).length,1);});
test('streamPort active managed recording blocks recovery without kill',()=>{const r=recordBoundary({native:'streamPort',activeRecording:true});assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_|input tap/);});
for(const recoveryAfterVolume of ['foreign','foreignUnparsed','unknown','muted'])test('streamPort recovery rejects '+recoveryAfterVolume,()=>{const r=recordBoundary({native:'streamPort',recoveryAfterVolume});assert.notEqual(r.status,0,r.stderr);assert.equal(r.started,false);});

test('record stop verifies independent native evidence after managed process exits',()=>{const r=recordBoundary({probeMode:'stop'});assert.equal(r.status,0,r.stderr);assert.equal(r.restoredEvidence,true);assert.match(r.stdout,/playback_restored=true/);});

for(const opts of [{native:'streamPortForeign'},{native:'streamPortMultiple'},{native:'streamPort',uidMode:'shared'},{native:'streamPort',initialWrong:true}])test('native recovery unsafe candidate must not nudge '+JSON.stringify(opts),()=>{const r=recordBoundary(opts);assert.notEqual(r.status,0);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_|input tap/);});

test('post-stop streamPort restoration uses new evidence and a single volume cycle',()=>{
 const r=recordBoundary({probeMode:'stop',nativeSequence:['started','started','streamPort']});assert.equal(r.status,0,r.stderr);assert.equal(r.restoredEvidence,true);assert.match(r.stdout,/playback_restored=true/);assert.equal(r.calls.split('\n').filter(s=>s.includes('KEYCODE_VOLUME_UP')).length,1);
});
test('post-stop unknown audio cannot be washed into restored or trigger volume keys',()=>{
 const r=recordBoundary({probeMode:'stop',nativeSequence:['started','started','unknown','started']});assert.notEqual(r.status,0);assert.equal(r.restoredEvidence,false);assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_/);assert.doesNotMatch(r.stdout,/playback_restored=true/);
});

for(const state of ['foreign','unknown','started'])test('pre-action native recheck '+state+' never nudges',()=>{const r=recordBoundary({nativeSequence:['streamPort',state]});assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_/);assert.equal(r.started,state==='started',r.stderr);});
for(const volumeReadAfterUp of ['unknown','unchanged'])test('volume cycle restores own target after '+volumeReadAfterUp+' up readback',()=>{const r=recordBoundary({native:'streamPort',volumeReadAfterUp});assert.notEqual(r.status,0);assert.equal(r.started,false);assert.equal(r.finalVolume,'1');assert.equal(r.calls.split('volume --stream 3 --set 1').length-1,1);});

test('volume cycle upper bound unchanged restores exact target without decrement',()=>{const r=recordBoundary({native:'streamPort',volumeUpSaturated:true});assert.notEqual(r.status,0);assert.equal(r.started,false);assert.equal(r.finalVolume,'1');assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_DOWN/);assert.equal(r.calls.split('volume --stream 3 --set 1').length-1,1);});

test('mixed target unmuted and streamPort started tracks never count as unique native',()=>{const r=recordBoundary({native:'mixedTarget'});assert.notEqual(r.status,0);assert.equal(r.started,false);assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_|input tap/);});

test('fresh semantic player survives opaque resource ID drift from actual 20261015 tree',()=>{const r=recordBoundary({native:'paused',playControl:'newSemanticId',nativeAfterTap:'started'});assert.equal(r.status,0,r.stderr);assert.equal(r.started,true);assert.equal(r.calls.split('input tap').length-1,1);assert.match(r.calls,/input tap 600 1252/);});

for(const sdk of ['33','36'])test('playback duplication SDK '+sdk+' uses required official capture flags',()=>{const r=recordBoundary({sdk});assert.equal(r.status,0,r.stderr);for(const flag of ['--audio-source=playback','--audio-dup','--require-audio'])assert.ok(r.scrcpyArgs.includes(flag),r.scrcpyArgs.join(' '));assert.match(r.stdout,new RegExp('capture_audio_sdk='+sdk));assert.match(r.stdout,/capture_audio_mode=playback_dup/);});
for(const sdk of ['32','unknown',''])test('unsupported capture SDK '+sdk+' never records or nudges',()=>{const r=recordBoundary({sdk});assert.notEqual(r.status,0);assert.equal(r.started,false);assert.match(r.stderr,/RECORD_AUDIO_STRATEGY_UNSUPPORTED/);assert.doesNotMatch(r.calls,/KEYCODE_VOLUME_|input tap/);});
test('playback dup app opt-out cannot silently fall back to output recording',()=>{const r=recordBoundary({scrcpyOptOut:true});assert.notEqual(r.status,0);assert.equal(r.started,false);assert.ok(r.scrcpyArgs.includes('--require-audio'));assert.equal(r.scrcpyArgs.filter(a=>a.startsWith('--audio-source=')).join(','),'--audio-source=playback');});

for(const sdkRace of ['symlink','file'])test('SDK evidence atomic creation refuses late '+sdkRace+' without overwrite',()=>{const r=recordBoundary({sdkRace});assert.equal(r.sdkRaceInjected,true);assert.notEqual(r.status,0);assert.equal(r.started,false);assert.equal(r.sdkProtected,'ORIGINAL');assert.equal(r.sdkOriginal,sdkRace==='file'?'PREEXISTING':'ORIGINAL');});

// Runs the actual record_start function; only transport/clock are isolated fixtures.
for(const captureMode of ['no_ready','wrong_path','empty_file','no_file','early_exit','completed_alive'])test('capture readiness rejects '+captureMode+' before success and stops only its recorder',()=>{
 const boundedMaximum=['no_ready','wrong_path','empty_file','no_file'].includes(captureMode);
 const r=recordBoundary({captureMode,captureStop:'verified_escalation',...(boundedMaximum?{captureMaxSeconds:5}:{})});
 assert.notEqual(r.status,0,r.stdout);
 assert.doesNotMatch(r.stdout,/record_started/);
 assert.match(r.stderr,/RECORD_AUDIO_CAPTURE_UNAVAILABLE|RECORD_CAPTURE_EXIT_UNVERIFIED/);
 if(captureMode!=='early_exit')assert.equal(r.stoppedBeforeHarnessCleanup,true,'controller must confirm its recorder stopped before returning failure');
 if(captureMode!=='early_exit'){
  assert.equal(r.fixtureExitAtReturn,'gone','fresh independent ps must confirm recorder exit before harness cleanup');
  assert.ok(r.captureSignalSeen?.includes('TERM'),'the controlled negative recorder must survive through TERM before verified escalation');
  assert.equal(r.captureStartup.execution_stopped,true,'a signal marker alone is not proof of a stopped process');
 }
 if(boundedMaximum){
  assert.ok(r.scrcpyArgs.includes('--time-limit=5'),'the recorder must receive the same real 5s request maximum');
  assert.equal(r.captureStartup.reason,'readiness_timeout');assert.equal(r.captureStartup.status,'unavailable');assert.equal(r.captureStartup.execution_stopped,true);
 }
});
test('capture readiness waits for delayed exact-path log and nonempty file',()=>{
 const r=recordBoundary({captureMode:'delayed'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.captureReadyAtReturn,true,'PID alive before recording ready is not success');
 assert.match(r.stdout,/record_started/);
});

for(const captureOwner of ['foreign','unknown'])test('capture readiness never signals a '+captureOwner+' recorder identity',()=>{
 const r=recordBoundary({captureMode:'no_ready',captureOwner,captureStop:'verified_escalation'});
 assert.notEqual(r.status,0,r.stdout);
 assert.doesNotMatch(r.stdout,/record_started/);
 assert.match(r.stderr,/RECORD_CAPTURE_EXIT_UNVERIFIED/);
 assert.equal(r.stoppedBeforeHarnessCleanup,false,'unverified or foreign recorder must never be signalled');
});

// SDK31 uses an explicitly pinned tested runtime; this seam is a simulated helper, not phone proof.
test('SDK31 pinned audio-only PCM reaches same owned WAV readiness barrier',()=>{
 const r=recordBoundary({sdk:'31',sdk31Runtime:true});assert.equal(r.status,0,r.stderr);
 for(const flag of ['--no-video','--audio-source=output','--audio-codec=raw','--record-format=wav','--require-audio'])assert.ok(r.scrcpyArgs.includes(flag),r.scrcpyArgs.join(' '));
 assert.ok(!r.scrcpyArgs.includes('--audio-dup'));assert.match(r.stdout,/capture_audio_mode=output_pcm_sdk31/);
 assert.match(r.stdout,/capture_runtime_client_sha256=2823f8e8/);
});
test('SDK31 unsupported without verified pinned runtime stays closed',()=>{const r=recordBoundary({sdk:'31'});assert.notEqual(r.status,0);assert.equal(r.started,false);});

test('SDK31 stop validates actual single PCM track and immutable runtime receipt',()=>{const r=recordBoundary({sdk:'31',sdk31Runtime:true,probeMode:'stop'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/record_stopped capture_audio_mode=output_pcm_sdk31/);assert.match(r.stdout,/video_streams=0 audio_streams=1 audio_codec=pcm_s16le/);assert.equal(r.restoredEvidence,true);});
test('SDK31 stop rejects a non-PCM track despite successful process exit',()=>{const r=recordBoundary({sdk:'31',sdk31Runtime:true,sdk31Codec:'aac',probeMode:'stop'});assert.notEqual(r.status,0);assert.match(r.stderr,/RECORD_AUDIO_TRACK_UNVERIFIED/);assert.doesNotMatch(r.stdout,/record_stopped/);});

test('SDK33录制缺固定同版runtime时拒绝，不借原brew路径启动',()=>{
 const r=recordBoundary({sdk:'36',sdk33Runtime:false});
 assert.notEqual(r.status,0);assert.equal(r.started,false);
 assert.match(r.stderr,/RECORD_CAPTURE_STRATEGY_UNVERIFIED/);
});

// 真实Matroska现场：日志已开始但首cluster尚未flush；9s首次增长必须在有界窗口内取得。
// 8s旧窗口会对持续owned且实际增长的录制产生假阴性；仍不得把零字节文件当ready。
test('capture growth accepts first nonempty media after the former 8s cutoff',()=>{
 const r=recordBoundary({captureMode:'delayed_growth'});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/record_started/);assert.equal(r.captureReadyAtReturn,true);
 assert.equal(r.captureStartup.status,'ready');assert.equal(r.stoppedBeforeHarnessCleanup,false);
 assert.ok(r.captureStartup.observations.some(o=>o.media_size===0&&o.media_regular===true&&o.capture_container==='matroska'&&o.artifact_reason==='media_empty'&&o.log_started===true&&o.log_completed===false),'must observe zero-byte started media before growth');
 assert.ok(r.captureStartup.observations.some(o=>o.media_size>0&&o.media_regular===true&&o.capture_container==='matroska'&&o.artifact_reason==='ready'&&o.log_started===true&&o.log_completed===false),'must observe real growth before returning success');
});
test('capture growth observations expose media size plus exact started and completed logs',()=>{
 const r=recordBoundary({captureMode:'completed_alive',captureStop:'verified_escalation'});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.equal(r.stoppedBeforeHarnessCleanup,true);
 assert.ok(r.captureStartup.observations.some(o=>o.media_size>0&&o.log_started===true&&o.log_completed===true));
});
test('capture growth still reserves workflow cleanup time before delayed media arrives',()=>{
 const started=Date.now(),r=recordBoundary({captureMode:'delayed_growth',workflowRemainingSeconds:5,captureStop:'verified_escalation'});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/record_started/);
 assert.equal(r.stoppedBeforeHarnessCleanup,true);assert.equal(r.captureStartup.execution_stopped,true,JSON.stringify(r.captureStartup));
 assert.equal(r.captureStartup.reason,'readiness_timeout');assert.ok(Date.now()-started<7000,'workflow remaining 5s must not wait for 9s growth');
 assert.ok(r.captureStartup.observations.some(o=>o.media_size===0&&o.media_regular===true&&o.capture_container==='matroska'&&o.artifact_reason==='media_empty'&&o.log_started===true&&o.log_completed===false));
});
