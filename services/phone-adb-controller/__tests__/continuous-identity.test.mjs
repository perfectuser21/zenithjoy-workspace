import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const controller=new URL('../douyin-phone-adb',import.meta.url).pathname;
const queued=new URL('../process-queued-video.sh',import.meta.url).pathname;
const fixtures=new URL('./fixtures/',import.meta.url).pathname;
const vid='7646309328911907195';
// 明示模拟设备：真实控制器+队列shell执行；只有ADB、curl和账号锁回执为假。
function phone({mode='continuous_identity',command='queued',wrongId=false,skeleton=false,finalSkeleton=false,recover=false,playFails=false,controlledWait=false,shareIdleFallback=false,copyGuide=false,guideWrongMarker=false,guideDismissFails=false,guideDismissStuck=false}={}){
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
  runner=join(d,'controller-controlled-wait');writeFileSync(runner,patched);
 }
 const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
 const head='<hierarchy><node package="com.ss.android.ugc.aweme" bounds="[0,0][1200,2664]">';
 const field=value=>head+`<node text="${value}" resource-id="com.ss.android.ugc.aweme:id/et_search_kw" hint="人工智能" clickable="true" bounds="[0,0][200,200]"/></node></hierarchy>`;
 const panel=head+'<node text="分享给"/><node text="分享链接" clickable="true" bounds="[40,2300][300,2360]"/></node></hierarchy>';
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
else if(has('input keyevent 85'))s.play=s.play==='playing'?'paused':'playing';
else if(has('input text '))s.field=a.at(-1);
else if(has('input keyevent 278'))s.clip=s.field;
else if(has('input keyevent 279'))s.field=s.clip;
else if(has('input keyevent 67'))s.field='';
else if(has('input keyevent 4')){if(s.page==='scratch'&&++s.backs>=4){s.scratchReturns=(s.scratchReturns||0)+1;s.page=process.env.COPY_GUIDE==='1'&&s.scratchReturns===2?'guide':'detail';}else if(s.page==='guide'){s.guideDismisses=(s.guideDismisses||0)+1;s.page=process.env.GUIDE_DISMISS_STUCK==='1'?'guide':process.env.GUIDE_DISMISS_FAILS==='1'?'partial':'detail';}else if(s.page==='panel')s.page='detail';else if(process.env.KEYWORD_RESULTS==='1'&&s.page==='detail'&&s.scratchReturns>=2)s.page='results';}
else if(has('input tap')&&s.page==='detail')s.page='panel';
else if(has('input tap')&&s.page==='panel'){s.clip='https://v.douyin.com/Fresh/';s.page='detail';}
else if(has('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(has('uiautomator dump')){
 if(process.env.SHARE_IDLE_FALLBACK==='1'&&s.page==='detail'&&s.scratchReturns===1&&s.pauseCount>=3){
  s.shareAttempts=(s.shareAttempts||0)+1;
  if(s.shareAttempts<=3){fs.writeFileSync(sfile,JSON.stringify(s));console.error('ERROR: could not get idle state.');process.exit(1);}
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
 print -r -- "$3:\${DOUYIN_DETAIL_PLAYBACK:-standard}" >> "$FAKE_PHONE_DIR/command-env"
 case "$3" in
  lock-refresh) print lock=refreshed;exit 0;;
  set-playback-speed) exit 0;;
  record-start) node -e 'const f=require("fs"),p=require("path"),d=process.env.FAKE_PHONE_DIR;process.exit(JSON.parse(f.readFileSync(p.join(d,"state.json"))).play==="playing"?0:1)';exit $?;;
  record-stop) print 'record_stopped duration_seconds=25.1 mean_volume_db=-35';exit 0;;
  record-extract-audio) exit 0;;
 esac
 exec zsh '${runner}' "$@"
`,{mode:0o755});
 const qualify=join(d,'qualify');writeFileSync(qualify,"#!/bin/sh\nprintf 'QUAL_RESULT {\"verdict\":\"matched\"}\\n'\n",{mode:0o755});
 const tmp=join(d,'tmp'),cache=join(d,'.config/openclaw/locate-cache');mkdirSync(cache,{recursive:true});
 // 同目标旧短链使本次必须走nonce；不得关闭COPY_STALE。
 writeFileSync(join(cache,'legacy-last-clip.txt'),'https://v.douyin.com/Fresh/\n');
 const env={...process.env,HOME:d,FAKE_PHONE_DIR:d,DOUYIN_PHONE_REGISTRY:join(d,'registry'),DOUYIN_ADB_BIN:adb,
  DOUYIN_CURL_BIN:curl,DOUYIN_SIPS_BIN:'/usr/bin/true',DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_PHONE_TMP_ROOT:tmp,
  DOUYIN_PHONE_ADB:wrapper,WFR_RUN_DIR:join(d,'run'),DOUYIN_DETAIL_PLAYBACK:mode,QUEUED_VIDEO_QUALIFY_CMD:qualify,SKELETON:skeleton?'1':'0',FINAL_SKELETON:finalSkeleton?'1':'0',
  COPY_GUIDE:copyGuide?'1':'0',GUIDE_DISMISS_FAILS:guideDismissFails?'1':'0',GUIDE_DISMISS_STUCK:guideDismissStuck?'1':'0',KEYWORD_RESULTS:command==='results'?'1':'0',SHARE_IDLE_FALLBACK:shareIdleFallback?'1':'0',RECOVER:recover?'1':'0',PLAY_FAILS:playFails?'1':'0',HARVEST_KEYWORD_TESTING:'1'};
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
 assert.equal(r.state.shareAttempts,4,'先真实三次读树失败，再执行原单次兜底');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 85$/.test(s)).length,2,'85必须成对，不能把暂停视频永久改成播放');
 assert.equal(r.calls.split('\n').filter(s=>/input keyevent 126$/.test(s)).length,0);
 assert.equal(r.state.play,'paused');assert.equal(r.state.page,'results');
 assert.match(r.stderr,/hierarchy captured via pause-dump-resume fallback/);
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
