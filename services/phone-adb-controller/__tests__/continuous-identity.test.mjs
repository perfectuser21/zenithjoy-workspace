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
function phone({mode='continuous_identity',command='queued',wrongId=false,skeleton=false}={}){
 const d=mkdtempSync(join(tmpdir(),'continuous-identity-'));
 const detail=readFileSync(join(fixtures,'video-detail-from-search.xml'),'utf8');
 const head='<hierarchy><node package="com.ss.android.ugc.aweme" bounds="[0,0][1200,2664]">';
 const field=value=>head+`<node text="${value}" resource-id="com.ss.android.ugc.aweme:id/et_search_kw" hint="人工智能" clickable="true" bounds="[0,0][200,200]"/></node></hierarchy>`;
 const panel=head+'<node text="分享给"/><node text="分享链接" clickable="true" bounds="[40,2300][300,2360]"/></node></hierarchy>';
 writeFileSync(join(d,'registry'),'legacy\tSER1\tANY-MODEL\t1200\t2664\n');
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
else if(has('dumpsys'))out('mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.'+(s.page==='scratch'?'search.activity.SearchResultActivity':'detail.ui.DetailActivity')+'}');
else if(has('am start')&&has('aweme/detail')){s.page='detail';s.play='playing';}
else if(has('am start')&&has('search/tabs')){s.page='scratch';s.field='';s.backs=0;}
else if(has('input keyevent 127'))s.play='paused';
else if(has('input keyevent 126'))s.play='playing';
else if(has('input keyevent 85'))s.play=s.play==='playing'?'paused':'playing';
else if(has('input text '))s.field=a.at(-1);
else if(has('input keyevent 278'))s.clip=s.field;
else if(has('input keyevent 279'))s.field=s.clip;
else if(has('input keyevent 67'))s.field='';
else if(has('input keyevent 4')){if(s.page==='scratch'&&++s.backs>=4)s.page='detail';else if(s.page==='panel')s.page='detail';}
else if(has('input tap')&&s.page==='detail')s.page='panel';
else if(has('input tap')&&s.page==='panel'){s.clip='https://v.douyin.com/Fresh/';s.page='detail';}
else if(has('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(has('uiautomator dump')){
 const xml=s.page==='scratch'?(${field.toString()})(s.field||'人工智能'):fs.readFileSync(p.join(d,s.page==='panel'?'panel.xml':process.env.SKELETON==='1'?'skeleton.xml':'detail.xml'),'utf8');
 fs.writeFileSync(p.join(d,'remote.xml'),xml);fs.appendFileSync(p.join(d,'dumps'),s.page+':'+s.play+'\\n');
}else if(has('stat -c %s'))out(fs.existsSync(p.join(d,'remote.xml'))?fs.statSync(p.join(d,'remote.xml')).size:0);
else if(a.includes('pull')){const i=a.indexOf('pull');if(a[i+1].endsWith('.xml'))fs.copyFileSync(p.join(d,'remote.xml'),a[i+2]);else fs.writeFileSync(a[i+2],'png');}
fs.writeFileSync(sfile,JSON.stringify(s));
`,{mode:0o755});
 // field 的闭包变量替换为字面XML前缀，不涉及生产parser。
 const adbText=readFileSync(adb,'utf8').replace('head+`',JSON.stringify(head)+'+`');writeFileSync(adb,adbText,{mode:0o755});
 const curl=join(d,'curl');writeFileSync(curl,`#!/bin/sh\nprintf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/${wrongId?'7646309328911907196':vid}\\r\\n\\r\\n'\n`,{mode:0o755});
 const wrapper=join(d,'ctl');writeFileSync(wrapper,`#!/bin/zsh\nif [[ "$3" == lock-refresh ]];then print lock=refreshed;exit 0;fi\nexec zsh '${controller}' "$@"\n`,{mode:0o755});
 const tmp=join(d,'tmp'),cache=join(d,'.config/openclaw/locate-cache');mkdirSync(cache,{recursive:true});
 // 同目标旧短链使本次必须走nonce；不得关闭COPY_STALE。
 writeFileSync(join(cache,'legacy-last-clip.txt'),'https://v.douyin.com/Fresh/\n');
 const env={...process.env,HOME:d,FAKE_PHONE_DIR:d,DOUYIN_PHONE_REGISTRY:join(d,'registry'),DOUYIN_ADB_BIN:adb,
  DOUYIN_CURL_BIN:curl,DOUYIN_SIPS_BIN:'/usr/bin/true',DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_PHONE_TMP_ROOT:tmp,
  DOUYIN_PHONE_ADB:wrapper,WFR_RUN_DIR:join(d,'run'),DOUYIN_DETAIL_PLAYBACK:mode,SKELETON:skeleton?'1':'0',HARVEST_KEYWORD_TESTING:'1'};
 const args=command==='queued'?[queued,'identity','legacy',vid,`https://www.douyin.com/video/${vid}`,'','','continuous-run','jinuo']:
  [controller,'--profile','legacy',...(command==='results'?['current-video-link','continuous-link','人工智能']:command==='wrong-command'?['preflight']:['open-video',vid,'continuous-open'])];
 const r=spawnSync('zsh',args,{env,encoding:'utf8',timeout:30000});
 const calls=existsSync(join(d,'calls'))?readFileSync(join(d,'calls'),'utf8'):'';
 const result={...r,calls,state:JSON.parse(readFileSync(join(d,'state.json'),'utf8')),dumps:existsSync(join(d,'dumps'))?readFileSync(join(d,'dumps'),'utf8'):''};
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
