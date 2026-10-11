import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
const base=join(import.meta.dirname,'..'),script=readFileSync(join(base,'douyin-phone-adb'),'utf8'),fixtures=join(import.meta.dirname,'fixtures/viewport-restore');
const cases=[{name:'14',old:'candidate10-loc-retry1-grid',fresh:'candidate12-link-t1-returned-grid',title:'AI到底是什么？它的学习方式和人类是一样吗？ #智能制造 #科普 #AI #千万IP创科普 #你好崇小科',author:'崇州市科学技术协会',duration:'01:33',offset:698,anchors:3},{name:'23',old:'src0-screen4-wait0-grid',fresh:'candidate20-link-t1-returned-grid',title:'AI：你的生活搭档！ #ai #人工智能 #科技改变生活 #有ai就有无限可能 #一键开启ai世界',author:'AI知识小助手',duration:'01:14',offset:852,anchors:1},{name:'24',old:'src0-screen4-wait0-grid',fresh:'candidate20-link-t1-returned-grid',title:'什么是AI#人工智能 #什么是AI #AI #科技 #可控核聚变',author:'C&Z 游戏日记🎮',duration:'01:36',offset:852,anchors:1},{name:'27',old:'src0-screen5-wait0-grid',fresh:'candidate25-link-t1-returned-grid',title:'AI到底是什么？别把AI想成机器人了#AI #大模型',author:'鹏总All in AI（AI绝活大会）',duration:'00:57',offset:532,anchors:1},{name:'28',old:'src0-screen5-wait0-grid',fresh:'candidate25-link-t1-returned-grid',title:'AI到底是什么？纯大白话讲透 #AI科普#人工智能#涨知识#AI干货#科技常识',author:'没事儿',duration:'00:32',offset:532,anchors:1}];
function helper(old,fresh,c,run){const fn=script.match(/^card_viewport_hint_from_xml\(\) \{[\s\S]*?^\}/m)?.[0];if(!fn)return 'restore=0';const r=spawnSync('zsh',['-c',`${fn}\ncard_viewport_hint_from_xml "$1" "$2" "$3" "$4" "$5" "$6" "$7"`,'test',old,fresh,encodeURIComponent(c.title),encodeURIComponent(c.author),c.duration,'AI',run],{encoding:'utf8',env:{...process.env,SCREEN_H:'2664',PYTHON_BIN:'python3'}});assert.equal(r.status,0,r.stderr);return r.stdout;}
function actualRows(file){
 const fns=['_video_card_optional_nodes','video_cards_from_xml'].map(n=>script.match(new RegExp('^'+n+'\\(\\) \\{[\\s\\S]*?^\\}','m'))?.[0]);assert.ok(fns.every(Boolean));
 const r=spawnSync('zsh',['-c',fns.join('\n')+'\nvideo_cards_from_xml "$1"','test',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
async function runCase(c,{wrongKeyword=false,wrongTab=false,failedGesture=false,expire=false,missingAfter=false,duplicateFresh=false,expireBeforeGesture=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'viewport-real-')),run='viewport-test',old=join(dir,run+'-src1-cards-grid.xml'),fresh=join(dir,run+'-candidate1-loc-grid.xml'),events=[];let reads=0,restored=false,deadline=Date.now()+60000;
 copyFileSync(join(fixtures,c.old+'.xml'),old);const original=readFileSync(old,'utf8');const displaced=readFileSync(join(fixtures,c.fresh+'.xml'),'utf8');const initial=actualRows(old).split('\n').find(l=>l.split('\t')[3]===c.title);assert.ok(initial,'fixture应有真实原候选');
 const phone=async(cmd,...args)=>{events.push([cmd,...args]);if(cmd==='search-video-cards'){reads++;writeFileSync(fresh,restored&&!missingAfter?original:displaced);let rows=reads===1?initial:actualRows(fresh);if(duplicateFresh&&restored)rows+='\n'+initial;return rows+'\nvideo_tab='+(wrongTab&&reads>1?'0':'1')+'\nloading=0\nevidence='+(reads===1?old:fresh)+'\nend_of_results=1';}if(cmd==='search-kw-matches')return 'kw_matches='+(wrongKeyword&&reads>1?'0':'1');if(cmd==='card-bottom-hint-from-xml')return 'clipped=0';if(cmd==='card-viewport-hint-from-xml'){const out=helper(...args.slice(0,2),c,run);if(expireBeforeGesture)deadline=Date.now()-1;return out;}if(cmd==='search-grid-scroll'){assert.equal(args[1],'restore-offset');assert.equal(Number(args[2]),c.offset);if(failedGesture)throw Error('gesture failed');restored=true;if(expire)deadline=Date.now()-1;return 'scrolled=restore-offset';}if(cmd==='current-video-link')return 'content_type=video\nvideo_id=7685662999797258401\nshort_url=https://v.douyin.com/Actual/\nreturn_mode=results';return '';};
 try{const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async()=>({status:'pending',inserted:true}),profile:'p',run,root:base,sources:['AI'],limit:1,budgetDeadline:()=>deadline,env:{WFR_RUN_DIR:dir}});return {out:await h.collect_videos(),events,initial};}finally{rmSync(dir,{recursive:true,force:true});}
}
for(const c of cases)test('真实离屏candidate'+c.name+'一次有界hint后必须新树完整唯一匹配',async()=>{const r=await runCase(c);assert.equal(r.out.captures.length,1,'真实已知离屏卡不能三读同视口后永久跳过');const scrolls=r.events.filter(e=>e[0]==='search-grid-scroll');assert.equal(scrolls.length,1);assert.equal(r.out.relocation_reveals[0].anchor_count,c.anchors);assert.equal(r.out.relocation_reveals[0].navigation_only,true);assert.equal(r.events.filter(e=>e[0]==='tap-evidence').length,1);});
for(const opts of [{wrongKeyword:true},{wrongTab:true},{failedGesture:true},{expire:true},{expireBeforeGesture:true},{missingAfter:true},{duplicateFresh:true}])test('离屏恢复失败必须无点击 '+JSON.stringify(opts),async()=>{const r=await runCase(cases[0],opts);const coords=r.initial.split('\t').slice(0,2);assert.equal(r.events.filter(e=>e[0]==='tap-evidence'&&e[1]===coords[0]&&e[2]===coords[1]).length,0);assert.equal(r.out.status,'partial');if(opts.missingAfter||opts.duplicateFresh)assert.equal(r.out.known_gaps[0].kind,'candidate_viewport_unrestored');if(opts.expireBeforeGesture)assert.equal(r.events.filter(e=>e[0]==='search-grid-scroll').length,0);});
function mutateXml(xml,mode){const r=spawnSync('python3',['-c',`import sys,copy,re,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.read());mode=sys.argv[1]
if mode=='duplicate':
 p=next(n for n in root.iter('node') if n.get('resource-id')=='com.ss.android.ugc.aweme:id/dlr' and any(x.get('text','').startswith('什么是AI？ 科普') for x in n.iter('node')));root.append(copy.deepcopy(p))
for n in root.iter('node'):
 rid=n.get('resource-id','')
 if mode=='wrong-package':n.set('package','wrong.package')
 if mode=='wrong-query' and rid.endswith('/et_search_kw'):n.set('text','其他关键词')
 if mode=='wrong-tab' and n.get('text')=='视频':n.set('selected','false')
 if mode=='missing-like' and rid.endswith('/pc7'):n.set('resource-id','other')
 if mode=='missing-date' and rid.endswith('/3+q'):n.set('resource-id','other')
 if mode=='like-change' and rid.endswith('/pc7'):n.set('content-desc','未点赞，喜欢99999，按钮')
 if mode=='date-change' and rid.endswith('/3+q'):n.set('text','2024.01.01')
 if mode=='related' and rid.endswith('/desc'):n.set('content-desc','相关搜索')
 if mode in ('overshift','inconsistent') and 'bounds' in n.attrib and (mode=='overshift' or rid.endswith('/+b')):
  b=list(map(int,re.findall(r'\\d+',n.get('bounds'))));b[1]+=1000 if mode=='overshift' else 20;b[3]+=1000 if mode=='overshift' else 20;n.set('bounds',f'[{b[0]},{b[1]}][{b[2]},{b[3]}]')
print(E.tostring(root,encoding='unicode'))
`,mode],{input:xml,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
for(const mode of ['wrong-package','wrong-query','wrong-tab','missing-like','missing-date','like-change','date-change','related','overshift','inconsistent','duplicate','incomplete','wrong-run','symlink'])test('真实一锚导航拒绝 '+mode,()=>{
 const d=mkdtempSync(join(tmpdir(),'viewport-negative-')),run='viewport-test',c=cases[3],old=join(d,run+'-src1-cards-grid.xml'),fresh=join(d,run+'-candidate1-loc-grid.xml');
 try{copyFileSync(join(fixtures,c.old+'.xml'),old);const xml=readFileSync(join(fixtures,c.fresh+'.xml'),'utf8');writeFileSync(fresh,mode==='incomplete'?xml.slice(0,-50):['wrong-run','symlink'].includes(mode)?xml:mutateXml(xml,mode));let path=fresh;if(mode==='symlink'){path=join(d,run+'-candidate2-loc-grid.xml');const r=spawnSync('ln',['-s',fresh,path]);assert.equal(r.status,0);}assert.equal(helper(old,path,c,mode==='wrong-run'?'different-run':run).trim(),'restore=0');}finally{rmSync(d,{recursive:true,force:true});}
});
test('restore-offset真实命令只允许80..40%H向上有界距离、非零ADB不能假成功',()=>{
 const start=script.indexOf('  search-grid-scroll)'),end=script.indexOf('  results-controls-from-xml)',start),part=script.slice(start,end),body=part.slice(part.indexOf('    [[ '),part.lastIndexOf('    ;;')),d=mkdtempSync(join(tmpdir(),'viewport-gesture-')),fake=join(d,'adb');
 try{writeFileSync(fake,'#!/bin/sh\nprintf "%s\\n" "$*"\nexit "${TEST_ADB_EXIT:-0}"\n',{mode:0o755});
  for(const [offset,ok] of [['80',true],['532',true],['1065',true],['0',false],['-1',false],['79',false],['1066',false],['oops',false]]){
   const r=spawnSync('zsh',['-c',`die(){ exit 1; };check_target(){ :; };wait_ms(){ :; };${body}`,'test','search-grid-scroll','eid','restore-offset',offset],{encoding:'utf8',env:{...process.env,ADB:fake,SERIAL:'FAKE',SCREEN_W:'1200',SCREEN_H:'2664'}});assert.equal(r.status===0,ok,offset);if(ok)assert.ok(r.stdout.includes(`swipe 600 2264 600 ${2264-Number(offset)} 500`));else assert.equal(r.stdout.includes('swipe'),false);
  }
  const r=spawnSync('zsh',['-c',`die(){ exit 1; };check_target(){ :; };wait_ms(){ :; };${body}`,'test','search-grid-scroll','eid','restore-offset','532'],{encoding:'utf8',env:{...process.env,ADB:fake,SERIAL:'FAKE',SCREEN_W:'1200',SCREEN_H:'2664',TEST_ADB_EXIT:'1'}});assert.notEqual(r.status,0);assert.equal(r.stdout.includes('scrolled='),false);
 }finally{rmSync(d,{recursive:true,force:true});}
});
