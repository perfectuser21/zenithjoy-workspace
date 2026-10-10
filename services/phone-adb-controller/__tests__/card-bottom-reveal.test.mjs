import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
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
async function run({hinted=true,wrongAuthor=false,failScroll=false,wrongKeyword=false,duplicates=false,expire=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'bottom-handler-')),events=[];let reads=0,revealed=false,deadline=Date.now()+60000;
 const row=(x,y,a='作者')=>[x,y,'00:20','完整候选视频标题',a].join('\t');
 const phone=async(cmd,...args)=>{events.push([cmd,...args]);if(cmd==='search-video-cards'){reads++;return (reads===1?row(100,200)+(duplicates?'\n'+row(300,200):''):revealed?row(450,1700,wrongAuthor?'错误作者':'作者'):'')+'\nvideo_tab=1\nevidence=/fresh/grid.xml\nend_of_results=1';}if(cmd==='search-kw-matches')return 'kw_matches='+(wrongKeyword&&reads>1?'0':'1');if(cmd==='card-bottom-hint-from-xml')return 'clipped='+(hinted?'1':'0');if(cmd==='search-grid-scroll'){assert.equal(args[1],'reveal-up');if(failScroll)throw Error('scroll failed');revealed=true;if(expire)deadline=Date.now()-1;return 'scrolled=reveal-up';}if(cmd==='current-video-link')return 'content_type=video\nvideo_id=7685662999797258401\nshort_url=https://v.douyin.com/Actual/\nreturn_mode=results';return '';};
 try{const h=createDiscoveryHandlers({phone,execute:async()=>({code:0}),queue:async()=>({status:'pending',inserted:true}),profile:'p',run:'bottom-test',root:base,sources:['AI'],limit:1,budgetDeadline:()=>deadline,env:{WFR_RUN_DIR:dir}});return {out:await h.collect_videos(),events};}finally{rmSync(dir,{recursive:true,force:true});}
}
const taps=r=>r.events.filter(e=>e[0]==='tap-evidence'),scrolls=r=>r.events.filter(e=>e[0]==='search-grid-scroll');
test('裁切恢复只短滑一次，三读内按完整身份点新坐标',async()=>{const r=await run();assert.equal(r.out.stop_reason,'limit_reached');assert.equal(scrolls(r).length,1);assert.deepEqual(taps(r).map(e=>e.slice(1,3)),[['450','1700']]);assert.equal(r.out.videos.length,1);});
for(const opts of [{hinted:false},{wrongAuthor:true},{duplicates:true}])test('不能以hint或歧义标题替代完整身份 '+JSON.stringify(opts),async()=>{const r=await run(opts);assert.equal(taps(r).length,0);if(opts.hinted===false||opts.duplicates)assert.equal(scrolls(r).length,0);assert.equal(r.out.status,'partial');});
for(const opts of [{failScroll:true},{wrongKeyword:true},{expire:true}])test('错误与截止不转成功 '+JSON.stringify(opts),async()=>{const r=await run(opts);assert.equal(taps(r).length,0);assert.equal(r.out.status,'partial');if(opts.expire)assert.equal(r.out.stop_reason,'budget_exhausted');});
