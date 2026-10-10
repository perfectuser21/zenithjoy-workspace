import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
const base=join(import.meta.dirname,'..'),script=readFileSync(join(base,'douyin-phone-adb'),'utf8'),fixtures=join(import.meta.dirname,'fixtures/card-bottom');
function hint(xml,title,author){const fn=script.match(/^card_bottom_hint_from_xml\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(fn,'真实控制器应提供纯裁切诊断');return spawnSync('zsh',['-c',`${fn}\ncard_bottom_hint_from_xml "$1" "$2" "$3"`, 'test',xml,encodeURIComponent(title),encodeURIComponent(author)],{encoding:'utf8',env:{...process.env,SCREEN_H:'2664',PYTHON_BIN:'python3'}});}
for(const [n,screen] of [[9,2],[12,3],[16,4]])test(`真实candidate${n}仅底部裁切允许导航hint，原完整卡不可`,()=>{
 const original=join(fixtures,`src0-screen${screen}-wait0.xml`),clipped=join(fixtures,`candidate${n}-loc.xml`),xml=readFileSync(original,'utf8');
 const title=n===9?'&#129323; 偷偷扒了小胖的AI数字人Skill｜附教程 「小胖」的 Vlog 数字人博主提示词工程Skill，完整拆解给你&#128071; #小云雀Seedance25  #小云雀Seedance25全能专业制作  #小云雀AI #AI演员的自我修养  #人工智能会取代人类吗':n===12?'不会用AI？4句指令让AI自己写提示词 #AI新星计划  #ai教程 #提示词 #ai技巧 #ai提示词':'如何让豆包自行撰写提示词？只需要一条指令！#豆包 #ai #ai工具 #提示词 #ai指令';
 const author=n===9?'AIGC自修室':n===12?'赛博紫紫AIGC':'会点AI的琪琪';assert.ok(xml.includes(title));assert.equal(hint(clipped,title,author).stdout.trim(),'clipped=1');assert.equal(hint(original,title,author).stdout.trim(),'clipped=0');
});
async function run({hinted=true,wrongAuthor=false,failScroll=false,wrongKeyword=false,duplicates=false,expire=false,durationChanged=false,noHitB=false,loadingReveal=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'bottom-handler-')),events=[];let reads=0,revealed=false,deadline=Date.now()+60000;
 const row=(x,y,a='作者')=>[x,y,durationChanged?(reads===1?'':'00:47'):'00:20','完整候选视频标题',a].join('\t');
 const phone=async(cmd,...args)=>{events.push([cmd,...args]);if(cmd==='search-video-cards'){reads++;return (reads===1?row(100,200)+(duplicates?'\n'+row(300,200):''):(revealed||durationChanged)?row(450,1700,wrongAuthor?'错误作者':'作者').replace('完整候选视频标题',noHitB?'新完整候选B标题':'完整候选视频标题'):'')+'\nvideo_tab=1\nloading='+(loadingReveal&&reads===3?'1':'0')+'\nevidence=/fresh/grid.xml\nend_of_results=1';}if(cmd==='search-kw-matches')return 'kw_matches='+(wrongKeyword&&reads>1?'0':'1');if(cmd==='card-bottom-hint-from-xml')return 'clipped='+(hinted?'1':'0');if(cmd==='search-grid-scroll'){assert.equal(args[1],'reveal-up');if(failScroll)throw Error('scroll failed');revealed=true;if(expire)deadline=Date.now()-1;return 'scrolled=reveal-up';}if(cmd==='current-video-link')return 'content_type=video\nvideo_id=7685662999797258401\nshort_url=https://v.douyin.com/Actual/\nreturn_mode=results';return '';};
 try{const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async()=>({status:'pending',inserted:true}),profile:'p',run:'bottom-test',root:base,sources:['AI'],limit:noHitB?0:1,budgetDeadline:()=>deadline,env:{WFR_RUN_DIR:dir}});return {out:await h.collect_videos(),events};}finally{rmSync(dir,{recursive:true,force:true});}
}
const taps=r=>r.events.filter(e=>e[0]==='tap-evidence'),scrolls=r=>r.events.filter(e=>e[0]==='search-grid-scroll');
test('裁切恢复只短滑一次，三读内按完整身份点新坐标',async()=>{const r=await run();assert.equal(r.out.stop_reason,'limit_reached');assert.equal(scrolls(r).length,1);assert.deepEqual(taps(r).map(e=>e.slice(1,3)),[['450','1700']]);assert.equal(r.out.videos.length,1);assert.equal(r.out.relocation_reveals.length,1);assert.equal(r.out.relocation_reveals[0].verified,true);assert.ok(r.out.relocation_reveals[0].before_evidence_path);assert.ok(r.out.relocation_reveals[0].after_evidence_path);assert.equal(r.events.filter(e=>e[0]==='search-video-cards').length,3);});
for(const opts of [{hinted:false},{wrongAuthor:true},{duplicates:true}])test('不能以hint或歧义标题替代完整身份 '+JSON.stringify(opts),async()=>{const r=await run(opts);assert.equal(taps(r).length,0);if(opts.hinted===false||opts.duplicates)assert.equal(scrolls(r).length,0);assert.equal(r.out.status,'partial');});
for(const opts of [{failScroll:true},{wrongKeyword:true},{expire:true}])test('错误与截止不转成功 '+JSON.stringify(opts),async()=>{const r=await run(opts);assert.equal(taps(r).length,0);assert.equal(r.out.status,'partial');if(opts.expire)assert.equal(r.out.stop_reason,'budget_exhausted');});

test('真实裁切树的错包/标题不在/顶部/重复标题/相关搜索伪卡/不完整XML均不给导航许可',()=>{
 const original=readFileSync(join(fixtures,'candidate12-loc.xml'),'utf8'),title='不会用AI？4句指令让AI自己写提示词 #AI新星计划  #ai教程 #提示词 #ai技巧 #ai提示词',author='赛博紫紫AIGC';
 const d=mkdtempSync(join(tmpdir(),'bottom-negative-'));
 try{
  const mutants=[original.replaceAll('package="com.ss.android.ugc.aweme"','package="wrong.package"'),original.replace(title,'其他视频完整标题'),original.replace('[39,2590][567,2664]','[39,0][567,74]'),original.replaceAll('com.ss.android.ugc.aweme:id/desc','com.ss.android.ugc.aweme:id/related_search'),original.replace('</hierarchy>',`<node package="com.ss.android.ugc.aweme" text="${title}" bounds="[39,2500][567,2560]"/></hierarchy>`),original.slice(0,-100)];
  for(let i=0;i<mutants.length;i++){const f=join(d,i+'.xml');writeFileSync(f,mutants[i]);const r=hint(f,title,author);assert.notEqual(r.stdout.trim(),'clipped=1');}
  // 全页其它位置的相关搜索可共存，不能错当视频或阻止正常卡片导航。
  const f=join(d,'related-in-card.xml');writeFileSync(f,original.replace(`text="${title}"`,`text="${title}" content-desc="相关搜索"`));assert.notEqual(hint(f,title,author).stdout.trim(),'clipped=1');
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('短滑真实case只允许受限20%距离，不修改整屏up/down',()=>{
 const part=script.slice(script.indexOf('  search-grid-scroll)'),script.indexOf('  results-controls-from-xml)'));
 const d=mkdtempSync(join(tmpdir(),'bottom-scroll-')),fake=join(d,'adb');
 try{writeFileSync(fake,'#!/bin/sh\nprintf "%s\n" "$*"\n',{mode:0o755});
 const body=part.slice(part.indexOf('    [[ '),part.lastIndexOf('    ;;'));
 for(const [mode,end,duration] of [['reveal-up','1731','500'],['up','399','1000'],['down','2264','1000']]){
  const r=spawnSync('zsh',['-c',`die(){ exit 1; }; check_target(){ :; }; wait_ms(){ :; }; ${body}`,'test','search-grid-scroll','eid',mode],{encoding:'utf8',env:{...process.env,ADB:fake,SERIAL:'FAKE',SCREEN_W:'1200',SCREEN_H:'2664'}});
  assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes(mode==='down'?`swipe 600 399 600 ${end} ${duration}`:`swipe 600 2264 600 ${end} ${duration}`),r.stdout);
 }
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('实际candidate22完整卡时长新露并非屏底裁切，不放宽空时长身份/不短滑/不点旧坐标',async()=>{
 const title='用AI做商业广告大片，原来这么简单 #ai制作视频 #创作者中心 #创作灵感 #ai视频 #ai广告';
 const actual=hint(join(fixtures,'candidate22-loc-retry2.xml'),title,'Neo小海');assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout.trim(),'clipped=0');
 const r=await run({durationChanged:true,hinted:false});assert.equal(scrolls(r).length,0);assert.equal(taps(r).length,0);assert.equal(r.out.status,'partial');assert.equal(r.out.known_gaps[0].kind,'candidate_disappeared');
});

test('短reveal露出新的完整B槽位必须先取链，不能整屏滑掉后自报已全扫；双同标题槽都保留',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reveal-new-slots-')),events=[],saved=[];let reads=0,revealed=false,fullScroll=false,tapped='';
 const row=(x,title)=>[x,1800,'00:20',title,'作者'].join('\t');
 const phone=async(cmd,...args)=>{events.push([cmd,...args]);
  if(cmd==='search-video-cards'){reads++;return (fullScroll?'':reads===1?row(100,'原完整候选A标题'):revealed?[row(450,'原完整候选A标题'),row(600,'新完整候选B标题'),row(800,'新完整候选B标题')].join('\n'):'')+'\nvideo_tab=1\nevidence=/fresh/'+(revealed?'revealed':'initial')+'.xml\nend_of_results='+(fullScroll?'1':'0');}
  if(cmd==='search-kw-matches')return 'kw_matches=1';
  if(cmd==='card-bottom-hint-from-xml')return 'clipped=1';
  if(cmd==='search-grid-scroll'){if(args[1]==='reveal-up')revealed=true;else fullScroll=true;return 'scrolled='+args[1];}
  if(cmd==='tap-evidence'){assert.equal(fullScroll,false,'新B应在整屏up前采集');tapped=args[0];return '';}
  if(cmd==='current-video-link')return 'content_type=video\nvideo_id=7685662999797258'+({'450':'401','600':'402','800':'403'}[tapped])+'\nshort_url=https://v.douyin.com/Actual'+tapped+'/\nreturn_mode=results';return '';
 };
 try{const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async(op,{video})=>{saved.push(video);return {status:'pending',inserted:true};},profile:'p',run:'slots-test',root:base,sources:['AI'],limit:0,env:{WFR_RUN_DIR:dir}});const out=await h.collect_videos();assert.equal(saved.length,3);assert.equal(out.all_results_scanned,true);assert.equal(out.stop_reason,'exhausted');assert.deepEqual(events.filter(e=>e[0]==='tap-evidence').map(e=>e[1]),['450','600','800']);assert.equal(events.filter(e=>e[0]==='search-grid-scroll'&&e[2]==='reveal-up').length,1);}finally{rmSync(dir,{recursive:true,force:true});}
});

function durationProof(oldXml,newXml,{wrongRun=false}={}){
 const fn=script.match(/^card_unknown_duration_from_xml\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(fn,'实际未知时长证据判定必须存在');
 const d=mkdtempSync(join(tmpdir(),'duration-proof-')),run='codex10110519_ai30h_101',old=join(d,run+'-src0-screen6-wait0-grid.xml'),fresh=join(d,run+'-candidate22-loc-retry2-grid.xml');
 try{writeFileSync(old,oldXml);writeFileSync(fresh,newXml);return spawnSync('zsh',['-c',`${fn}\ncard_unknown_duration_from_xml "$1" "$2" "$3" "$4" "$5"`,'test',old,fresh,encodeURIComponent('用AI做商业广告大片，原来这么简单 #ai制作视频 #创作者中心 #创作灵感 #ai视频 #ai广告'),encodeURIComponent('Neo小海'),wrongRun?'other_run':run],{encoding:'utf8',env:{...process.env,PYTHON_BIN:'python3'}});}finally{rmSync(d,{recursive:true,force:true});}
}
test('实际22两树未知时长补齐仅在点赞精确文案/日期/唯一完整卡结构同列均核验',()=>{
 const old=readFileSync(join(fixtures,'candidate22-original.xml'),'utf8'),fresh=readFileSync(join(fixtures,'candidate22-loc-retry2.xml'),'utf8');const r=durationProof(old,fresh);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/augmented=1/);assert.match(r.stdout,/duration=00:47/);
 for(const changed of [fresh.replaceAll('喜欢2.4万','喜欢2.5万'),fresh.replaceAll('text="03.13"','text="03.14"'),fresh.replaceAll('package="com.ss.android.ugc.aweme"','package="wrong"'),fresh.replaceAll('com.ss.android.ugc.aweme:id/pc7','other'),fresh.replaceAll('com.ss.android.ugc.aweme:id/dlr','other'),fresh.slice(0,-100),fresh.replace('[1014,1145][1161,1233]','[0,1145][100,1233]')]){assert.notEqual(durationProof(old,changed).stdout.includes('augmented=1'),true);}
 assert.notEqual(durationProof(old,fresh,{wrongRun:true}).stdout.includes('augmented=1'),true);
 // 原证据已有时长时，不得用未知时长例外改写它。
 assert.notEqual(durationProof(fresh,fresh).stdout.includes('augmented=1'),true);
});


test('新视口同字段新VID不能被旧ordinal吞掉',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reveal-ordinal-permanent-'));try{
let stage='initial',x='',events=[];
const row=(x,y,t)=>[x,y,'00:20',t,'作者'].join('\t');const A='重复完整候选A标题',B='原完整候选B标题';const initial=row(100,500,A)+'\n'+row(300,2600,B);const revealed=row(450,2000,B)+'\n'+row(800,2450,A);const page=rows=>rows+'\nvideo_tab=1\nevidence=/fresh/'+stage+'.xml\nend_of_results='+(stage==='end'?'1':'0');
const phone=async(cmd,...args)=>{events.push([cmd,...args]);if(cmd==='search-video-cards')return page(stage==='initial'?initial:stage==='revealed'?revealed:'');if(cmd==='search-kw-matches')return 'kw_matches=1';if(cmd==='card-bottom-hint-from-xml')return 'clipped=1';if(cmd==='search-grid-scroll'){stage=args[1]==='reveal-up'?'revealed':'end';return 'scrolled='+args[1];}if(cmd==='tap-evidence'){x=args[0];return '';}if(cmd==='current-video-link'){if(x==='100')stage='A-left-viewport';return 'content_type=video\nvideo_id=7685662999797258'+({'100':'401','450':'402','800':'403'}[x])+'\nshort_url=https://v.douyin.com/Actual'+x+'/\nreturn_mode=results';}return '';};
const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async()=>({status:'pending',inserted:true}),profile:'fake',run:'ordinal-review',root:base,sources:['AI'],limit:0,env:{WFR_RUN_DIR:dir}});const out=await h.collect_videos();console.log(JSON.stringify({expected_captures:3,actual_captures:out.captures.length,all_results_scanned:out.all_results_scanned,stop_reason:out.stop_reason,videos:out.videos.map(v=>v.videoId),events},null,2));assert.equal(out.captures.length,3,'短滑改变视口，同identity新视频ordinal0不能被旧视口slot0静默丢弃后仍报告全采');
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('短滑首次空完整页不能锁死后续第三读新候选枚举',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reveal-empty-permanent-'));try{
let stage='initial',reads=0,revealReads=0,lastY='',events=[];const row=(t,y)=>[450,y,'00:20',t,'作者'].join('\t');const page=(rows,end=false)=>rows+'\nvideo_tab=1\nevidence=/fresh/'+stage+'.xml\nend_of_results='+(end?'1':'0');
const phone=async(cmd,...args)=>{events.push([cmd,...args]);if(cmd==='search-video-cards'){reads++;if(reads===1)return page(row('原完整候选A标题',2600));if(stage==='initial')return page('');if(stage==='revealed'){if(++revealReads===1)return page('');return page(row('原完整候选A标题',2000)+'\n'+row('短滑新露出候选B标题',2450));}return page('',true);}if(cmd==='search-kw-matches')return 'kw_matches=1';if(cmd==='card-bottom-hint-from-xml')return 'clipped=1';if(cmd==='search-grid-scroll'){stage=args[1]==='reveal-up'?'revealed':'after-full-scroll';return 'scrolled='+args[1];}if(cmd==='tap-evidence'){lastY=args[1];return '';}if(cmd==='current-video-link')return 'content_type=video\nvideo_id='+(lastY==='2450'?'7685662999797258402':'7685662999797258401')+'\nshort_url=https://v.douyin.com/Actual'+lastY+'/\nreturn_mode=results';return '';};
const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async()=>({status:'pending',inserted:true}),profile:'fake',run:'review',root:base,sources:['AI'],limit:0,env:{WFR_RUN_DIR:dir}});const out=await h.collect_videos();console.log(JSON.stringify({expected_captures:2,actual_captures:out.captures.length,all_results_scanned:out.all_results_scanned,stop_reason:out.stop_reason,events},null,2));assert.equal(out.captures.length,2,'短滑后的新完整候选必须在离开当前viewport前枚举，不能漏采却报告全扫完');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('目标仍未恢复但新B完整必须取链，同时原裁切gap使全量partial',async()=>{const r=await run({noHitB:true});assert.equal(r.out.captures.length,1);assert.equal(r.out.captures[0].title,'新完整候选B标题');assert.equal(r.out.known_gaps[0].kind,'candidate_clipped');assert.equal(r.out.all_results_scanned,false);assert.equal(r.out.status,'partial');assert.equal(scrolls(r).length,1);});
test('短reveal首个loading页不能枚举或点击，第三次完整读树才恢复',async()=>{const r=await run({loadingReveal:true});assert.equal(r.out.videos.length,1);assert.equal(r.events.filter(e=>e[0]==='search-video-cards').length,4);assert.equal(scrolls(r).length,1);assert.equal(taps(r).length,1);assert.equal(r.out.relocation_reveals[0].enumerated_fingerprints.length,1);});
