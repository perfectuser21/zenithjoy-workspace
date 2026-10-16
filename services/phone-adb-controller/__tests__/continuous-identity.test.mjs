import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const controller=new URL('../douyin-phone-adb',import.meta.url).pathname;
const queued=new URL('../process-queued-video.sh',import.meta.url).pathname;
const fixtures=new URL('./fixtures/',import.meta.url).pathname;
const vid='7646309328911907195';
// 单元测试控制器回执为fake；实机录音验收另核原始audio/UID SHA。
function fakeBoundaryNativeFields(eid,phase){const prefix=eid+'-playback-'+phase;return ' capture_runtime_client_sha256=d474146594d6f42ec04eede0049391a647ab27cdcf30c627ac30b281cf5069d7 capture_runtime_server_sha256=8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e capture_runtime_evidence_file='+eid+'.capture-runtime.json capture_runtime_evidence_sha256='+('e'.repeat(64))+' capture_audio_sdk_evidence_file='+eid+'.capture-sdk.txt capture_audio_sdk_evidence_sha256='+('c'.repeat(64))+' playback_proof_kind=native_audio native_audio_state=started native_audio_uid=10203 native_audio_pid=528 native_audio_piid=73615 native_audio_package_uid_verified=true native_audio_foreign_started=0 '+[['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].map(([k,s])=>'native_audio_'+k+'_file='+prefix+'.'+s+' native_audio_'+k+'_sha256='+('a'.repeat(64))).join(' ');}
// 明示模拟设备：真实控制器+队列shell执行；只有ADB、curl和账号锁回执为假。
function phone({mode='continuous_identity',command='queued',wrongId=false,skeleton=false,finalSkeleton=false,recover=false,playFails=false,controlledWait=false,shareIdleFallback=false,copyGuide=false,guideWrongMarker=false,guideDismissFails=false,guideDismissStuck=false,guideDismissIdle=false}={}){
 const d=mkdtempSync(join(tmpdir(),'continuous-identity-'));
 let runner=controller;
 if(controlledWait){
  // 沿用nonce/network测试的wait_ms替身，仅在测试临时副本控制等待。
  // 5轮真实CLI重试、设备读回、nonce与失败处理完全保留；没有生产测试开关。
  const source=readFileSync(controller,'utf8'),wait=source.match(/^wait_ms\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(wait?.includes('/bin/sleep "$seconds"'),'只能替换既有等待函数');
  assert.equal(source.match(/^wait_ms\(\) \{/gm)?.length,1,'等待定义必须恰好一处');
  const controlled='wait_ms() { require_uint "$1"; (( $1 <= 5000 )) || die "wait must be <= 5000 ms"; }';
  const patched=source.replace(wait,controlled);
  assert.equal(patched.split(controlled).length-1,1,'仅替换一处等待函数');
  assert.equal(patched.replace(controlled,wait),source,'归一化等待后所有业务与CLI字节必须完全相同');
  runner=join(d,'douyin-phone-adb');writeFileSync(runner,patched);
  for(const file of ['phone-lock-lib.sh','phone-lock-helper.py'])writeFileSync(join(d,file),readFileSync(join(fixtures,'..','..',file)));
 }
 const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
 const head='<hierarchy><node package="com.ss.android.ugc.aweme" bounds="[0,0][1200,2664]">';
 const field=value=>head+`<node text="${value}" resource-id="com.ss.android.ugc.aweme:id/et_search_kw" hint="人工智能" clickable="true" bounds="[0,0][200,200]"/></node></hierarchy>`;
 // 合成面板遵循真机功能容器合同；不放宽生产selector或nonce核验。
 const panel=head+'<node text="分享给" package="com.ss.android.ugc.aweme" enabled="true" bounds="[40,1900][300,1960]"/><node package="com.ss.android.ugc.aweme" resource-id="com.ss.android.ugc.aweme:id/function_container" enabled="true" bounds="[0,2200][1200,2450]"><node text="分享链接" package="com.ss.android.ugc.aweme" enabled="true" clickable="true" bounds="[40,2300][300,2360]"/></node></node></hierarchy>';
 writeFileSync(join(d,'registry'),'legacy\tSER1\tANY-MODEL\t1200\t2664\n');
 const guide=readFileSync(join(fixtures,'real-copy-success-guide-13.xml'),'utf8');
 writeFileSync(join(d,'guide.xml'),guideWrongMarker?guide.replace('可以通过分享的链接找到我','其他引导'):guide);
 writeFileSync(join(d,'guide-detail.xml'),readFileSync(join(fixtures,'real-copy-guide-restored-detail-41.xml')));
 writeFileSync(join(d,'results.xml'),readFileSync(join(fixtures,'real-search-results-grid.xml')));
 writeFileSync(join(d,'detail.xml'),detail);writeFileSync(join(d,'panel.xml'),panel);
 writeFileSync(join(d,'skeleton.xml'),readFileSync(join(fixtures,'real-keyword-return-skeleton-13.xml')));
 writeFileSync(join(d,'state.json'),JSON.stringify({page:'detail',play:'playing',field:'',clip:'https://v.douyin.com/Fresh/',backs:0}));
 const adb=join(d,'adb');
 writeFileSync(adb,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),d=process.env.FAKE_PHONE_DIR,a=process.argv.slice(2),sfile=p.join(d,'state.json');
const s=JSON.parse(fs.readFileSync(sfile,'utf8'));fs.appendFileSync(p.join(d,'calls'),a.join(' ')+'\\n');
const has=x=>a.join(' ').includes(x);const out=x=>console.log(x);
if(has('get-state'))out('device');
else if(has('getprop'))out('ANY-MODEL');
else if(has('dumpsys'))out('mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.'+(['scratch','results'].includes(s.page)?'search.activity.SearchResultActivity':'detail.ui.DetailActivity')+'}');
else if(has('am start')&&has('aweme/detail')){s.page='detail';s.play='playing';s.detailStarts=(s.detailStarts||0)+1;}
else if(has('am start')&&has('search/tabs')){s.page='scratch';s.field='';s.backs=0;}
else if(has('input keyevent 127')){s.play='paused';s.pauseCount=(s.pauseCount||0)+1;}
else if(has('input keyevent 126')){if(process.env.PLAY_FAILS==='1')process.exit(1);s.play='playing';}
else if(has('input keyevent 85')){s.play=s.play==='playing'?'paused':'playing';s.media85=(s.media85||0)+1;}
else if(has('input text '))s.field=a.at(-1);
else if(has('input keyevent 278'))s.clip=s.field;
else if(has('input keyevent 279'))s.field=s.clip;
else if(has('input keyevent 67'))s.field='';
else if(has('input keyevent 4')){if(s.page==='scratch'&&++s.backs>=4){s.scratchReturns=(s.scratchReturns||0)+1;s.page=process.env.COPY_GUIDE==='1'&&s.scratchReturns===2?'guide':'detail';}else if(s.page==='guide'){s.guideDismisses=(s.guideDismisses||0)+1;s.page=process.env.GUIDE_DISMISS_STUCK==='1'?'guide':process.env.GUIDE_DISMISS_FAILS==='1'?'partial':'detail';}else if(s.page==='panel')s.page='detail';else if(process.env.KEYWORD_RESULTS==='1'&&s.page==='detail'&&s.scratchReturns>=2)s.page='results';}
else if(has('input tap')&&s.page==='detail')s.page='panel';
else if(has('input tap')&&s.page==='panel'){if(a.slice(-2).join(' ')!=='170 2330'){console.error('UNTRUSTED_FAKE_PANEL_TAP');process.exit(33);}s.clip='https://v.douyin.com/Fresh/';s.page='detail';}
else if(has('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(has('uiautomator dump')){
 if(process.env.GUIDE_DISMISS_IDLE==='1'&&s.page==='detail'&&s.guideDismisses&&!s.guideIdleRecovered){
  s.guideIdleAttempts=(s.guideIdleAttempts||0)+1;
  if(s.play==='paused'){fs.writeFileSync(sfile,JSON.stringify(s));console.error('ERROR: could not get idle state.');process.exit(1);}
  s.guideIdleRecovered=true;
 }
 if(process.env.SHARE_IDLE_FALLBACK==='1'&&s.page==='detail'&&s.scratchReturns===1&&s.pauseCount>=3){
  s.shareAttempts=(s.shareAttempts||0)+1;
  if(!s.media85){fs.writeFileSync(sfile,JSON.stringify(s));console.error('ERROR: could not get idle state.');process.exit(1);}
 }
 const isSkeleton=process.env.SKELETON==='1'||(process.env.FINAL_SKELETON==='1'&&s.scratchReturns>=2&&!(process.env.RECOVER==='1'&&s.detailStarts>=2));
 const xml=s.page==='guide'?fs.readFileSync(p.join(d,'guide.xml'),'utf8'):s.page==='partial'?fs.readFileSync(p.join(d,'skeleton.xml'),'utf8'):s.page==='results'?fs.readFileSync(p.join(d,'results.xml'),'utf8'):s.page==='scratch'?(${field.toString()})(s.field||'人工智能'):fs.readFileSync(p.join(d,s.page==='panel'?'panel.xml':isSkeleton?'skeleton.xml':(s.guideDismisses?'guide-detail.xml':'detail.xml')),'utf8');
 fs.writeFileSync(p.join(d,'remote.xml'),xml);fs.appendFileSync(p.join(d,'dumps'),s.page+':'+s.play+'\\n');
}else if(has('stat -c %s'))out(fs.existsSync(p.join(d,'remote.xml'))?fs.statSync(p.join(d,'remote.xml')).size:0);
else if(a.includes('pull')){const i=a.indexOf('pull');if(a[i+1].endsWith('.xml'))fs.copyFileSync(p.join(d,'remote.xml'),a[i+2]);else fs.writeFileSync(a[i+2],'png');}
fs.writeFileSync(sfile,JSON.stringify(s));
`,{mode:0o755});
 // field 的闭包变量替换为字面XML前缀，不涉及生产parser。
 const adbText=readFileSync(adb,'utf8').replace('head+`',JSON.stringify(head)+'+`');writeFileSync(adb,adbText,{mode:0o755});
 const curl=join(d,'curl');writeFileSync(curl,`#!/bin/sh\nprintf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/${wrongId?'7646309328911907196':vid}\\r\\n\\r\\n'\n`,{mode:0o755});
 const wrapper=join(d,'ctl');writeFileSync(wrapper,`#!/bin/zsh
 original_args=("$@")
 [[ "$3" != --lock-owner ]] || set -- "$1" "$2" "\${@:5}"
 print -r -- "$3:\${DOUYIN_DETAIL_PLAYBACK:-standard}" >> "$FAKE_PHONE_DIR/command-env"
 case "$3" in
  lock-refresh) print lock=refreshed;exit 0;;
  set-playback-speed) exit 0;;
  record-start) node -e 'const f=require("fs"),p=require("path"),d=process.env.FAKE_PHONE_DIR;process.exit(JSON.parse(f.readFileSync(p.join(d,"state.json"))).play==="playing"?0:1)' || exit $?;print "record_started capture_audio_mode=playback_dup capture_audio_sdk=36 capture_audio_required=true media_volume=1 playback_verified=true playback_package=com.ss.android.ugc.aweme playback_state=1${fakeBoundaryNativeFields('$4','start')}";exit 0;;
  record-stop) print "record_stopped capture_audio_mode=playback_dup capture_audio_sdk=36 capture_audio_required=true duration_seconds=25.1 audio_streams=1 mean_volume_db=-35 playback_package=com.ss.android.ugc.aweme playback_state=1${fakeBoundaryNativeFields('$4','end')}";exit 0;;
  record-extract-audio) print fixture-audio > "$FAKE_PHONE_DIR/record.wav";print "audio_extracted path=$FAKE_PHONE_DIR/record.wav";exit 0;;
 esac
 exec zsh '${runner}' "\${original_args[@]}"
`,{mode:0o755});
 const qualify=join(d,'qualify');writeFileSync(qualify,"#!/bin/sh\nprintf 'QUAL_RESULT {\"verdict\":\"matched\"}\\n'\n",{mode:0o755});
 writeFileSync(join(d,'scp'),'#!/usr/bin/env node\nconst fs=require("fs");process.exit(fs.existsSync(process.argv.at(-2))?0:4);\n',{mode:0o755});
 const tmp=join(d,'tmp'),cache=join(d,'.config/openclaw/locate-cache');mkdirSync(cache,{recursive:true});
 // 队列已持锁：建本测试自己的lease，实际controller/guard仍验证owner。
 const lock=join(tmp,'locks','SER1.lock');mkdirSync(lock,{recursive:true});writeFileSync(join(lock,'owner'),'continuous-run');writeFileSync(join(lock,'acquired_at'),String(Math.floor(Date.now()/1000)));
 // 同目标旧短链使本次必须走nonce；不得关闭COPY_STALE。
 writeFileSync(join(cache,'legacy-last-clip.txt'),'https://v.douyin.com/Fresh/\n');
 const env={...process.env,PATH:d+':'+process.env.PATH,HOME:d,FAKE_PHONE_DIR:d,DOUYIN_PHONE_REGISTRY:join(d,'registry'),DOUYIN_ADB_BIN:adb,
  DOUYIN_CURL_BIN:curl,DOUYIN_SIPS_BIN:'/usr/bin/true',DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_PHONE_TMP_ROOT:tmp,
  DOUYIN_PHONE_ADB:wrapper,WFR_RUN_DIR:join(d,'run'),DOUYIN_DETAIL_PLAYBACK:mode,QUEUED_VIDEO_QUALIFY_CMD:qualify,SKELETON:skeleton?'1':'0',FINAL_SKELETON:finalSkeleton?'1':'0',
  COPY_GUIDE:copyGuide?'1':'0',GUIDE_DISMISS_FAILS:guideDismissFails?'1':'0',GUIDE_DISMISS_STUCK:guideDismissStuck?'1':'0',GUIDE_DISMISS_IDLE:guideDismissIdle?'1':'0',KEYWORD_RESULTS:command==='results'?'1':'0',SHARE_IDLE_FALLBACK:shareIdleFallback?'1':'0',RECOVER:recover?'1':'0',PLAY_FAILS:playFails?'1':'0',HARVEST_KEYWORD_TESTING:'1'};
 if(command.startsWith('queued'))delete env.DOUYIN_DETAIL_PLAYBACK;
 const args=command.startsWith('queued')?[queued,command==='queued-qualification'?'qualification':'identity','legacy',vid,`https://www.douyin.com/video/${vid}`,'','','continuous-run','jinuo']:
  [runner,'--profile','legacy',...(['results','link'].includes(command)?['current-video-link','continuous-link',...(command==='results'?['人工智能']:[])]:command==='wrong-command'?['preflight']:['open-video',vid,'continuous-open'])];
 const r=spawnSync('zsh',args,{env,encoding:'utf8',timeout:60000});
 const calls=existsSync(join(d,'calls'))?readFileSync(join(d,'calls'),'utf8'):'';
 const result={...r,calls,state:JSON.parse(readFileSync(join(d,'state.json'),'utf8')),dumps:existsSync(join(d,'dumps'))?readFileSync(join(d,'dumps'),'utf8'):'',
  commandEnv:existsSync(join(d,'command-env'))?readFileSync(join(d,'command-env'),'utf8'):''};
 rmSync(d,{recursive:true,force:true});return result;
}

test('队列身份核验连续暂停到nonce完成，只在最终真实ID核验与严格归位后播放一次',()=>{
 const r=phone();assert.equal(r.status,0,r.stderr+' '+r.error?.code);
 assert.match(r.stdout,new RegExp('IDENTITY\\t'+vid+'\\tverified'));
 const media=r.calls.split('\n').filter(s=>/input keyevent 12[67]$/.test(s));
 assert.equal(media.filter(s=>s.endsWith('126')).length,1,media.join('\n'));
 assert.equal(media.at(-1)?.endsWith('126'),true);
 assert.equal(r.state.play,'playing');
 assert.ok(!r.dumps.split('\n').some(s=>s==='detail:playing'),'每次详情验证仍是新鲜暂停页面读回');
 assert.match(r.calls,/input keyevent 278/);assert.match(r.calls,/input keyevent 279/);
});
test('默认open-video仍恢复播放，显式连续身份模式保持暂停',()=>{
 const normal=phone({mode:'standard',command:'open'});assert.equal(normal.status,0,normal.stderr);assert.equal(normal.state.play,'playing');
 const paused=phone({command:'open'});assert.equal(paused.status,0,paused.stderr);assert.equal(paused.state.play,'paused');
});
for(const options of [{mode:'typo',command:'open'},{command:'wrong-command'},{command:'results'}])test('非法暂停模式/命令/结果出口组合在ADB前拒绝 '+JSON.stringify(options),()=>{
 const r=phone(options);assert.notEqual(r.status,0);assert.equal(r.calls,'');
});
test('连续暂停不能用深链回显掩盖实际链接VID错误',()=>{
 const r=phone({wrongId:true});assert.equal(r.status,4,r.stderr);assert.doesNotMatch(r.stdout,/IDENTITY/);
});
test('DetailActivity中13节点骨架仍拒绝，不能以类名或播放策略冒充详情证据',()=>{
 const r=phone({command:'open',skeleton:true});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/video_opened=1/);
});
test('最终归位13节点必须重新打开并暂停读回真实分享树，再恢复播放',()=>{
 const r=phone({finalSkeleton:true,recover:true});assert.equal(r.status,0,r.stderr+' '+r.error?.code);
 assert.equal(r.state.detailStarts,2);assert.equal(r.state.play,'playing');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,1);
 assert.match(r.stdout,/IDENTITY/);assert.match(r.stderr,/falling back to deep link reopen/);
});
test('严格归位持续骨架或最终播放失败，真实exit非零且不能输出IDENTITY成功',()=>{
 for(const options of [{finalSkeleton:true},{playFails:true,controlledWait:true}]){
  const r=phone(options);assert.equal(r.error,undefined,'必须得到真实退出，不能用测试超时替代失败');
  assert.equal(r.status,4,r.stderr);assert.doesNotMatch(r.stdout,/IDENTITY/);
  if(options.finalSkeleton)assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,0);
  if(options.playFails){
   assert.match(r.stderr,/current-video-link failed after 5 attempts/);
   assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,5,'所有5轮失败均真实执行，不能缩成成功或提前绕过');
   assert.equal(r.state.play,'paused');
  }
 }
});
test('qv局部暂停策略不污染锁或录音，record-start必须收到恢复后的播放状态',()=>{
 const r=phone({command:'queued-qualification'});assert.equal(r.status,0,r.stderr+' '+r.error?.code);
 assert.match(r.stdout,new RegExp('QUAL\\t'+vid+'\\tmatched'));
 const commands=r.commandEnv.trim().split('\n');
 assert.deepEqual(commands.slice(0,3),['lock-refresh:standard','open-video:continuous_identity','current-video-link:continuous_identity']);
 assert.deepEqual(commands.slice(3),['set-playback-speed:standard','record-start:standard','record-stop:standard','record-extract-audio:standard']);
 assert.equal(r.state.play,'playing');
});

test('keyword内部nonce归位保持暂停，仍新读分享树与原词视频tab后输出实际VID',()=>{
 const r=phone({mode:'standard',command:'results'});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,new RegExp('video_id='+vid));assert.match(r.stdout,/return_mode=results/);
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,0,'keyword nonce不能中途恢复PLAY');
 assert.equal(r.state.play,'paused');assert.equal(r.state.page,'results');
 assert.ok(!r.dumps.includes('detail:playing'));assert.equal(r.dumps.split('\n').filter(s=>s==='detail:paused').length,3,'入口、nonce归位及分享仍三次独立新鲜树');
 assert.equal(r.dumps.split('\n').filter(s=>s==='results:paused').length,2,'原词与视频tab归位仍两次新鲜树');
 assert.match(r.calls,/input keyevent 278/);assert.match(r.calls,/input keyevent 279/);
});
test('keyword已暂停分享遇idle失败：原85兜底成对恢复原暂停状态且只能用新树成功',()=>{
 const r=phone({mode:'standard',command:'results',shareIdleFallback:true,controlledWait:true});
 assert.equal(r.error,undefined,'必须真实退出，不以timeout代替验收');assert.equal(r.status,0,r.stderr);
 assert.equal(r.state.shareAttempts,2,'本次新鲜seed详情的首idle失败后，立即单次toggle-dump-toggle，不重复同策略三次');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 85$/.test(s)).length,2,'85必须成对，不能把暂停视频永久改成播放');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,0);
 assert.equal(r.state.play,'paused');assert.equal(r.state.page,'results');
 assert.match(r.stderr,/hierarchy captured via toggle-dump-toggle fallback/);
 assert.match(r.stdout,new RegExp('video_id='+vid));
 const keys=r.calls.split('\n').filter(s=>/input keyevent (85|126|127)$/.test(s));assert.deepEqual(keys.slice(-2).map(s=>s.split(' ').at(-1)),['85','85']);
});

test('nonce内部typed归位未知值在随机数/ADB前拒绝',()=>{
 const seed=readFileSync(controller,'utf8').match(/^seed_clipboard_nonce\(\) \{[\s\S]*?^\}/m)[0];
 const r=spawnSync('zsh',['-c',`set -eu; die(){ print -u2 -- "$1"; exit 2; }; ADB=/usr/bin/false; PYTHON_BIN=/usr/bin/false; ${seed}\nseed_clipboard_nonce fixture unsupported`],{encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/CLIPBOARD_NONCE_RETURN_MODE_INVALID/);
});

test('默认无keyword取链含真实nonce，归位后仍恢复PLAY供后续录音',()=>{
 const r=phone({mode:'standard',command:'link'});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,new RegExp('video_id='+vid));assert.equal(r.state.play,'playing');assert.equal(r.state.page,'detail');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,2,'默认nonce及最终归位两处PLAY保持');
 assert.match(r.calls,/input keyevent 278/);assert.match(r.calls,/input keyevent 279/);
});

test('真实13节点复制成功guide仅追加一次BACK，独立新鲜详情通过才恢复PLAY与输出ID',()=>{
 const r=phone({copyGuide:true,controlledWait:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 assert.equal(r.state.guideDismisses,1);assert.equal(r.calls.split('\n').filter(s=>/input keyevent 4$/.test(s)).length,9,'原两段各4次BACK，仅增加一次guide BACK');assert.equal(r.state.detailStarts,1,'识别准确guide不应先等三波后重新deep link');
 assert.equal(r.state.play,'playing');assert.match(r.stdout,/IDENTITY/);assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,1);
 assert.match(r.dumps,/guide:paused\ndetail:paused/,'额外BACK后必须重新PAUSE并独立抓树');
});
test('guide缺精确标记不dismiss；dismiss后新树仍非详情不能输出ID或PLAY',()=>{
 for(const options of [{guideWrongMarker:true},{guideDismissFails:true},{guideDismissStuck:true}]){
  const r=phone({copyGuide:true,controlledWait:true,finalSkeleton:true,...options});
  assert.equal(r.error,undefined);assert.equal(r.status,4,r.stderr);assert.doesNotMatch(r.stdout,/IDENTITY/);
  assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,0);
  assert.equal(r.state.guideDismisses||0,options.guideWrongMarker?0:1);
 }
});
test('复制成功guide纯树精确识别必须拒绝错误包、缺标记、混入分享及不完整XML',()=>{
 const source=readFileSync(controller,'utf8');const fn=source.match(/^_is_copy_success_guide_xml\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(fn,'需要显式纯树识别器');
 const guide=readFileSync(join(fixtures,'real-copy-success-guide-13.xml'),'utf8');
 const d=mkdtempSync(join(tmpdir(),'guide-recognition-'));
 try{for(const [label,xml,expected] of [['actual',guide,0],['wrong-package',guide.replaceAll('com.ss.android.ugc.aweme','evil.package'),1],['missing-marker',guide.replace('可以通过分享的链接找到我',''),1],['unknown-modal',guide.replace('链接已复制成功，去粘贴分享：','其他弹窗'),1],['share-present',guide.replace('</hierarchy>','<node package="com.ss.android.ugc.aweme" content-desc="分享2，按钮" clickable="true"/></hierarchy>'),1],['partial',guide.slice(0,-20),1]]){
  const xmlPath=join(d,label+'.xml');writeFileSync(xmlPath,xml);
  const r=spawnSync('zsh',['-c',`PYTHON_BIN=/usr/bin/python3;DOUYIN_PACKAGE=com.ss.android.ugc.aweme;${fn}\n_is_copy_success_guide_xml "$1"`,'zsh',xmlPath],{encoding:'utf8'});assert.equal(r.status,expected,label+': '+r.stderr);
 }}finally{rmSync(d,{recursive:true,force:true});}
});

// 运行真实取树函数与文件删除/拉取协议；仅ADB设备响应和等待为测试替身。
function shareWave({policy='verified-seed-share',error='idle',freshFirst=false,fallback='detail',stale=false,waves=false}={}){
 const d=mkdtempSync(join(tmpdir(),'share-idle-wave-'));
 try{
  const source=readFileSync(controller,'utf8');
  const functions=['_is_fresh_share_detail_xml','_ui_evidence_wave','ui_evidence'].map(name=>source.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}', 'm'))?.[0]);
  assert.ok(functions.every(Boolean));
  const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
  writeFileSync(join(d,'detail'),detail);
  writeFileSync(join(d,'wrong'),detail.replaceAll('com.ss.android.ugc.aweme','other.package'));
  writeFileSync(join(d,'partial'),'<hierarchy><node package="com.ss.android.ugc.aweme"');
  writeFileSync(join(d,'state'),JSON.stringify({dumps:0,keys:[]}));
  if(stale){writeFileSync(join(d,'remote'),detail);writeFileSync(join(d,'case.xml'),detail);}
  const adb=join(d,'adb');
  writeFileSync(adb,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),d=${JSON.stringify(d)},a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(p.join(d,'state')));let code=0;
if(a[2]==='pull'){if(fs.existsSync(p.join(d,'remote')))fs.copyFileSync(p.join(d,'remote'),a[4]);else code=1;}
else if(a[3]==='rm')fs.rmSync(p.join(d,'remote'),{force:true});
else if(a[3]==='stat')console.log(fs.existsSync(p.join(d,'remote'))?fs.statSync(p.join(d,'remote')).size:0);
else if(a[3]==='input'){s.keys.push(Number(a.at(-1)));}
else if(a[3]==='uiautomator'){
 s.dumps++;
 if(${freshFirst} || (s.keys.length%2===1 && ${JSON.stringify(fallback)}!=='none')){
  const kind=${freshFirst}?'detail':${JSON.stringify(fallback)};fs.copyFileSync(p.join(d,kind),p.join(d,'remote'));
 } else {console.error(${JSON.stringify(error==='idle'?'ERROR: could not get idle state.':'ERROR: permission denied.')});code=1;}
}
fs.writeFileSync(p.join(d,'state'),JSON.stringify(s));process.exit(code);
`,{mode:0o755});
  const script=`set -eu\nADB=${JSON.stringify(adb)}; SERIAL=fake; EVIDENCE_ROOT=${JSON.stringify(d)}; REMOTE_UI=/fake; DOUYIN_PACKAGE=com.ss.android.ugc.aweme; PYTHON_BIN=/usr/bin/python3\nSCREEN_W=1200\nSCREEN_H=2664\nrequire_evidence_id(){ [[ "$1" == case ]]; }; wait_ms(){ :; }; wait_seconds(){ :; }; die(){ print -u2 -- "$1"; exit 4; };\n${functions.join('\n')}\n${waves?'ui_evidence':'_ui_evidence_wave'} case ${policy}`;
  const r=spawnSync('zsh',['-c',script],{encoding:'utf8',timeout:10000});
  return {...r,state:JSON.parse(readFileSync(join(d,'state'),'utf8')),xml:existsSync(join(d,'case.xml'))?readFileSync(join(d,'case.xml'),'utf8'):''};
 }finally{rmSync(d,{recursive:true,force:true});}
}

test('share typed闲置失败只读两次，标准场景仍三次失败后兜底；85必须成对',()=>{
 for(const [policy,count] of [['verified-seed-share',2],['standard',4]]){
  const r=shareWave({policy});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  assert.equal(r.state.dumps,count);assert.deepEqual(r.state.keys,[85,85]);
 }
 const fresh=shareWave({freshFirst:true});assert.equal(fresh.status,0);assert.equal(fresh.state.dumps,1);assert.deepEqual(fresh.state.keys,[]);
});
test('share typed非idle错误保留三波，旧XML与失败fallback不能通过',()=>{
 const r=shareWave({error:'permission',stale:true,waves:true});assert.equal(r.error,undefined);assert.equal(r.status,4);
 assert.equal(r.state.dumps,9);assert.deepEqual(r.state.keys,[]);assert.equal(r.xml,'');
 const failed=shareWave({fallback:'none',stale:true,waves:true});assert.equal(failed.error,undefined);assert.equal(failed.status,4);
 assert.equal(failed.state.dumps,10,'首波2次，后两波各原4次');assert.deepEqual(failed.state.keys,[85,85,85,85,85,85]);assert.equal(failed.xml,'');
});
test('share typed fallback错包或截断新XML拒绝，未知策略在ADB前拒绝',()=>{
 for(const fallback of ['wrong','partial']){
  const r=shareWave({fallback,waves:true});assert.equal(r.error,undefined);assert.equal(r.status,4,r.stderr);
  assert.equal(r.state.dumps,10);assert.deepEqual(r.state.keys,[85,85,85,85,85,85]);
 }
 const invalid=shareWave({policy:'unsupported'});assert.equal(invalid.status,2);assert.equal(invalid.state.dumps,0);assert.deepEqual(invalid.state.keys,[]);
});
test('fresh seed witness严格解析package与详情，nonce字串或旧图不是凭证',()=>{
 const source=readFileSync(controller,'utf8'),fn=source.match(/^_is_fresh_share_detail_xml\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(fn);
 const d=mkdtempSync(join(tmpdir(),'share-witness-'));
 try{
  const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
  for(const [name,xml,code] of [['valid',detail,0],['package',detail.replaceAll('com.ss.android.ugc.aweme','wrong'),1],['scratch',detail.replace('搜你想看的','clipnonce123'),1],['partial',detail.slice(0,-20),1],['guide',readFileSync(join(fixtures,'real-copy-success-guide-13.xml'),'utf8'),1]]){
   const path=join(d,name);writeFileSync(path,xml);
   const r=spawnSync('zsh',['-c',`PYTHON_BIN=/usr/bin/python3; DOUYIN_PACKAGE=com.ss.android.ugc.aweme; ${fn}\n_is_fresh_share_detail_xml ${JSON.stringify(path)}`],{encoding:'utf8'});assert.equal(r.status,code,name);
  }
  const once=source.match(/^_current_video_link_once\(\) \{[\s\S]*?^\}/m)[0];
  assert.ok(once.indexOf('/bin/rm -f "$seed_witness"')<once.indexOf('nonce_proof="$(seed_clipboard_nonce'));
  assert.match(once,/if _is_fresh_share_detail_xml "\$seed_witness"; then share_policy=verified-seed-share/);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('真实once策略边界：先清旧witness，无证据或错包保标准，只有本次新鲜详情可提速',()=>{
 const source=readFileSync(controller,'utf8');
 const fns=['_is_fresh_share_detail_xml','_current_video_link_once'].map(name=>source.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}','m'))?.[0]);assert.ok(fns.every(Boolean));
 const d=mkdtempSync(join(tmpdir(),'once-share-policy-'));
 try{
  const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
  writeFileSync(join(d,'valid'),detail);writeFileSync(join(d,'wrong'),detail.replaceAll('com.ss.android.ugc.aweme','wrong.package'));writeFileSync(join(d,'oldclip'),'old');
  for(const [kind,expected] of [['none','standard'],['wrong','standard'],['valid','verified-seed-share']]){
   writeFileSync(join(d,'case-seed-detail-verified.xml'),detail);
   const seed=kind==='none'?':':`/bin/cp ${JSON.stringify(join(d,kind))} "$EVIDENCE_ROOT/$1-seed-detail-verified.xml"`;
   const r=spawnSync('zsh',['-c',`set -eu; EVIDENCE_ROOT=${JSON.stringify(d)}; DOUYIN_PACKAGE=com.ss.android.ugc.aweme; PYTHON_BIN=/usr/bin/python3; ADB=/usr/bin/true; SERIAL=fake\nrequire_evidence_id(){ :; }; foreground_package(){ print "mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}"; }; clip_state_file(){ print ${JSON.stringify(join(d,'oldclip'))}; }; wait_ms(){ :; }; die(){ exit 4; }; seed_clipboard_nonce(){ ${seed}; print clipnonceProof; }; ui_evidence(){ print -u2 -- "strategy=$2"; exit 8; };\n${fns.join('\n')}\n_current_video_link_once case 人工智能`],{encoding:'utf8',timeout:10000});
   assert.equal(r.error,undefined);assert.equal(r.status,8);assert.match(r.stderr,new RegExp('strategy='+expected+'(?:\\n|$)'),kind);
   if(kind==='none')assert.equal(existsSync(join(d,'case-seed-detail-verified.xml')),false,'旧witness必须真实删除');
  }
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('Python优化模式不能关闭fresh witness的package和完整详情拒绝守卫',()=>{
 const source=readFileSync(controller,'utf8'),fn=source.match(/^_is_fresh_share_detail_xml\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(fn);
 const d=mkdtempSync(join(tmpdir(),'share-optimized-witness-'));
 try{
  const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
  for(const [name,xml,code] of [['valid',detail,0],['package',detail.replaceAll('com.ss.android.ugc.aweme','wrong'),1],['scratch',detail.replace('搜你想看的','clipnonce123'),1],['partial',detail.slice(0,-20),1],['guide',readFileSync(join(fixtures,'real-copy-success-guide-13.xml'),'utf8'),1]]){
   const path=join(d,name);writeFileSync(path,xml);
   const r=spawnSync('zsh',['-c',`PYTHON_BIN=/usr/bin/python3; DOUYIN_PACKAGE=com.ss.android.ugc.aweme; ${fn}\n_is_fresh_share_detail_xml ${JSON.stringify(path)}`],{encoding:'utf8',env:{...process.env,PYTHONOPTIMIZE:'1'}});assert.equal(r.status,code,name);
  }
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('精确复制guide受限BACK后本次PAUSE首idle即成对85，新详情仍实际nonce和VID核验',()=>{
 const r=phone({copyGuide:true,guideDismissIdle:true,controlledWait:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,new RegExp('IDENTITY\\t'+vid+'\\tverified'));assert.equal(r.state.guideDismisses,1);assert.equal(r.state.guideIdleAttempts,2);assert.equal(r.state.media85,2);assert.equal(r.state.play,'playing');
});

// 真实record_start函数边界：调速已完成且可能暂停，ADB126退出0不代表播放。
function recordBoundary({session='playing',playFails=false,mediaTarget='com.ss.android.ugc.aweme/FeedPlayerSession/8101',targetChanges=false,native='started',nativeSequence=[],uidMode='unique',playControl=true,nativeAfterTap='started',nativeAfterTapSequence=[],probeMode='record',foregroundChanges=false,recoveryAfterVolume='started',activeRecording=false,initialWrong=false,volumeReadAfterUp='normal',volumeUpSaturated=false,sdk='36',scrcpyOptOut=false,sdkRace='',captureMode='ready',captureOwner='normal',sdk31Runtime=false,sdk33Runtime=true,sdk31Codec='pcm_s16le',workflowRemainingSeconds=null}={}){
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
trap 'print stopped > "$FIXTURE/capture-stopped"; exit 0' INT TERM
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
  const script=`setopt NO_UNSET\nADB=$FIXTURE/adb\nSCRCPY=$FIXTURE/scrcpy\nFFPROBE=$FIXTURE/ffprobe\nFFMPEG=$FIXTURE/ffmpeg\nSERIAL=test\nLOCK_OWNER=fixture-sdk31-owner\nDOUYIN_PACKAGE=com.ss.android.ugc.aweme\nEVIDENCE_ROOT=$FIXTURE\nRECORD_MEDIA_VOLUME=1\nPYTHON_BIN=/usr/bin/python3\nREMOTE_UI=/fake/ui\nSCREEN_W=1200\nSCREEN_H=2664\nrequire_evidence_id(){ return 0; }\nrequire_uint(){ return 0; }\ndie(){ print -u2 -- "$*"; exit 2; }\nwait_ms(){ if [[ "$1" == (500|2000) ]]; then /bin/sleep 0.02; fi; if [[ "$1" == 1500 ]]; then for i in {1..20}; do [[ ! -f "$FIXTURE/scrcpy-started" ]] || return 0; /bin/sleep 0.01; done; fi; return 0; }\n${volumeHelpers}\nforeground_package(){ if [[ -f "$FIXTURE/fg-switched" ]]; then print "mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.search.activity.SearchResultActivity}"; else print "mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}"; fi; }\n_foreground_is_exact_douyin(){ return 0; }\n_on_video_detail(){ return 0; }\nforeground_gate(){ return 0; }\n${helpers}\n${extra}\n${runtimeStub}\n${fn}\n${stopFn}\n${activeRecording?'print $$ > $FIXTURE/other.rec.pid':''}\n${initialWrong?'touch $FIXTURE/fg-switched':''}\n${sdkRace?`print ORIGINAL > $FIXTURE/sdk-protected\nTRAPDEBUG(){ if [[ \"$ZSH_DEBUG_CMD\" == *'capture-sdk.txt'* && \"$ZSH_DEBUG_CMD\" == *'$sdk'* && \"$ZSH_DEBUG_CMD\" != '[['* && ! -e $FIXTURE/sdk-race-injected ]]; then touch $FIXTURE/sdk-race-injected; ${sdkRace==='symlink'?'ln -s $FIXTURE/sdk-protected $FIXTURE/probe.capture-sdk.txt':'print PREEXISTING > $FIXTURE/probe.capture-sdk.txt'}; fi; }`:''}\n${probeMode==='session'?'record_playback_state probe':probeMode==='stop'?'record_start probe 25; record_stop probe':'record_start probe 25'}\n`;
  const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,FIXTURE:d,PHONE_CONTROLLER_DIR:new URL('../',import.meta.url).pathname,SESSION:session,MEDIA_TARGET:mediaTarget,TARGET_CHANGES:targetChanges?'1':'0',NATIVE:native,UID_MODE:uidMode,AFTER_TAP:nativeAfterTap,FG_CHANGES:foregroundChanges?'1':'0',AFTER_VOLUME:recoveryAfterVolume,READ_AFTER_UP:volumeReadAfterUp,UP_SATURATED:volumeUpSaturated?'1':'0',SDK:sdk,SDK31_RUNTIME:sdk31Runtime?'1':'0',SDK31_CODEC:sdk31Codec,SCRCPY_OPTOUT:scrcpyOptOut?'1':'0',CAPTURE_MODE:captureMode,CAPTURE_OWNER:captureOwner,...(workflowRemainingSeconds===null?{}:{WF_RUN_START_TS:String(Date.now()/1000),WF_RUN_MAX_SECONDS:String(workflowRemainingSeconds)})},timeout:20000});
  const readyPath=join(d,sdk31Runtime?'probe.rec.wav':'probe.rec.mkv');const captureReadyAtReturn=existsSync(readyPath)&&statSync(readyPath).size>0;const stoppedBeforeHarnessCleanup=existsSync(join(d,'capture-stopped'));

  const rawEvidence=Object.fromEntries(['media-session.txt','foreground.txt'].map(kind=>{const f=join(d,'probe-playback-start.'+kind);return [kind,existsSync(f)?{sha256:createHash('sha256').update(readFileSync(f)).digest('hex'),mode:statSync(f).mode&0o777}:null];}));
  return {...r,captureStartup:existsSync(join(d,'probe.capture-startup.json'))?JSON.parse(readFileSync(join(d,'probe.capture-startup.json'),'utf8')):null,captureReadyAtReturn,stoppedBeforeHarnessCleanup,sdkRaceInjected:existsSync(join(d,'sdk-race-injected')),sdkProtected:existsSync(join(d,'sdk-protected'))?readFileSync(join(d,'sdk-protected'),'utf8').trim():null,sdkOriginal:existsSync(join(d,'probe.capture-sdk.txt'))?readFileSync(join(d,'probe.capture-sdk.txt'),'utf8').trim():null,scrcpyArgs:existsSync(join(d,'scrcpy-args'))?readFileSync(join(d,'scrcpy-args'),'utf8').trim().split('\n'):[],finalVolume:existsSync(join(d,'volume'))?readFileSync(join(d,'volume'),'utf8').trim():'1',restoredEvidence:existsSync(join(d,'probe-playback-restored.native-audio.json')),rawEvidence,started:existsSync(join(d,'scrcpy-started')),calls:existsSync(join(d,'calls'))?readFileSync(join(d,'calls'),'utf8'):''};
 }finally{
  // Stop and observe this isolated fixture before deleting files its TERM trap can write.
  // Never retry rmSync while a live writer is still using the directory.
  const pidFile=existsSync(join(d,'fixture-recorder.pid'))?join(d,'fixture-recorder.pid'):join(d,'probe.rec.pid');
  if(existsSync(pidFile)){
   const pid=Number(readFileSync(pidFile,'utf8').trim());assert.ok(Number.isSafeInteger(pid)&&pid>1);
   const inspect=()=>{
    const result=spawnSync('/bin/ps',['-ww','-p',String(pid),'-o','stat=,command='],{encoding:'utf8'});
    if(result.status===1&&!result.stdout.trim())return null;
    assert.equal(result.status,0,result.stderr);
    const [state,...command]=result.stdout.trim().split(/\s+/);
    if(state.startsWith('Z'))return null;
    assert.ok(command.includes(join(d,'scrcpy')),'fixture PID identity changed; do not signal or delete evidence');
    return state;
   };
   if(inspect()){
    try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
    const deadline=Date.now()+2000;
    while(inspect()&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    assert.equal(inspect(),null,'fixture recorder exit unknown; preserve directory');
   }
  }
  rmSync(d,{recursive:true,force:true});
 }
}
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

test('视频tab机会性策略只做一次dump，失败不发送全局媒体toggle',()=>{
 const r=shareWave({policy:'opportunistic-search-tab',fallback:'none'});
 assert.equal(r.status,1,r.stderr);assert.equal(r.state.dumps,1);assert.deepEqual(r.state.keys,[]);
});
test('视频tab机会性策略接受完整新鲜树，不额外dump或toggle',()=>{
 const r=shareWave({policy:'opportunistic-search-tab',freshFirst:true});
 assert.equal(r.status,0,r.stderr);assert.equal(r.state.dumps,1);assert.deepEqual(r.state.keys,[]);assert.match(r.xml,/<hierarchy/);
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
 const r=recordBoundary({captureMode});
 assert.notEqual(r.status,0,r.stdout);
 assert.doesNotMatch(r.stdout,/record_started/);
 assert.match(r.stderr,/RECORD_AUDIO_CAPTURE_UNAVAILABLE|RECORD_CAPTURE_EXIT_UNVERIFIED/);
 if(captureMode!=='early_exit')assert.equal(r.stoppedBeforeHarnessCleanup,true,'controller must confirm its recorder stopped before returning failure');
});
test('capture readiness waits for delayed exact-path log and nonempty file',()=>{
 const r=recordBoundary({captureMode:'delayed'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.captureReadyAtReturn,true,'PID alive before recording ready is not success');
 assert.match(r.stdout,/record_started/);
});

for(const captureOwner of ['foreign','unknown'])test('capture readiness never signals a '+captureOwner+' recorder identity',()=>{
 const r=recordBoundary({captureMode:'no_ready',captureOwner});
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
 const r=recordBoundary({captureMode:'completed_alive'});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.equal(r.stoppedBeforeHarnessCleanup,true);
 assert.ok(r.captureStartup.observations.some(o=>o.media_size>0&&o.log_started===true&&o.log_completed===true));
});
test('capture growth still reserves workflow cleanup time before delayed media arrives',()=>{
 const started=Date.now(),r=recordBoundary({captureMode:'delayed_growth',workflowRemainingSeconds:5});
 assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/record_started/);
 assert.equal(r.stoppedBeforeHarnessCleanup,true);assert.equal(r.captureStartup.execution_stopped,true,JSON.stringify(r.captureStartup));
 assert.equal(r.captureStartup.reason,'readiness_timeout');assert.ok(Date.now()-started<7000,'workflow remaining 5s must not wait for 9s growth');
 assert.ok(r.captureStartup.observations.some(o=>o.media_size===0&&o.media_regular===true&&o.capture_container==='matroska'&&o.artifact_reason==='media_empty'&&o.log_started===true&&o.log_completed===false));
});
