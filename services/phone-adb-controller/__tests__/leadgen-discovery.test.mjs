import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
const exec=promisify(execFile),root=resolve('services/phone-adb-controller');
function rig({rejectWrite=false,copyFails=false,benchmark=false,multi=false,wrongSearch=false,expireAfterWrite=false,limit=0}={}){
 const dir=mkdtempSync(join(tmpdir(),'stream-cli-discovery-')),log=join(dir,'calls'),ctl=join(dir,'ctl');
 writeFileSync(ctl,`#!/bin/zsh
print -r -- "$3 $4 $5" >> "$CALLS"
case "$3" in
 open-search) print -r -- "$4" > "$FAKE_TMP/keyword";;
 search-kw-matches) python3 -c 'import sys,xml.etree.ElementTree as ET
ok=any(n.get("resource-id","").endswith("et_search_kw") and n.get("text")==sys.argv[1] for n in ET.parse(sys.argv[2]).iter("node"))
print("kw_matches="+str(int(ok)))
sys.exit(0 if ok else 1)' "$4" "$5";;
 search-video-cards)
  python3 -c 'import sys,os,urllib.parse,xml.sax.saxutils
word="错误关键词" if os.getenv("WRONG_SEARCH") else urllib.parse.unquote(open(sys.argv[1]).read().strip())
open(sys.argv[2],"w").write("<hierarchy><node resource-id=\\"com.ss.android.ugc.aweme:id/et_search_kw\\" text=\\""+xml.sax.saxutils.escape(word)+"\\"/></hierarchy>")' "$FAKE_TMP/keyword" "$FAKE_TMP/grid.xml"
  print '320\\t520\\t00:20\\t历史同标题\\t别人';print '330\\t530\\t00:20\\t自家视频\\t自己';print '340\\t540\\t00:20\\t目标同标题\\t甲';print '350\\t550\\t00:20\\t目标同标题\\t甲'
  print 'video_tab=1';print 'loading=0';print 'end_of_results=1';print "evidence=$FAKE_TMP/grid.xml";;
 tap-evidence) print -r -- "$4" > "$FAKE_TMP/tapped";;
 current-video-link)
  [[ -z "$COPY_FAILS" ]] || {print -u2 'COPY_STALE: stale previous target';exit 1;}
  local px=$(cat "$FAKE_TMP/tapped")
  print "video_id=7685662999797258$px";print 'short_url=https://v.douyin.com/newTarget/';print 'content_type=video';print 'return_mode=results';;
 *) ;;
esac
`,{mode:0o755});
 const env={...process.env,CALLS:log,COPY_FAILS:copyFails?'1':'',FAKE_TMP:dir,WFR_RUN_DIR:join(dir,'run'),WRONG_SEARCH:wrongSearch?'1':''};
 async function execute(command,args,opts={}){if(command==='/bin/sleep')return {code:0,stdout:'',stderr:''};try{return {code:0,...await exec(command,args,{env:{...env,...opts.env},timeout:5000})};}catch(e){return {code:typeof e.code==='number'?e.code:1,stdout:e.stdout||'',stderr:e.stderr||e.message};}}
 const phone=async(command,...args)=>{const r=await execute('zsh',[ctl,'--profile','jinoshengyuan-work',command,...args]);if(r.code){const e=new Error(r.stderr);e.stderr=r.stderr;throw e;}return r.stdout;};
 const writes=[];const queue=async(op,fields)=>{assert.equal(op,'discover','101不得查询历史或按标题筛视频');if(rejectWrite)throw Error('PG failed');writes.push(fields.video);if(expireAfterWrite){env.WF_RUN_START_TS=String(Math.floor(Date.now()/1000)-100);env.WF_RUN_MAX_SECONDS='1';}return {status:'pending',inserted:true};};
 const h=createDiscoveryHandlers({phone,execute,queue,profile:'jinoshengyuan-work',run:'stream-cli',root,limit,sourceKind:benchmark?'benchmark':'keyword',sources:multi?['人工智能训练师','AI训练师']:['人工智能训练师'],env});
 return {h,writes,calls:()=>readFileSync(log,'utf8'),receipt:()=>JSON.parse(readFileSync(join(dir,'run','stream-cli-source-1-readback.json'),'utf8')),progress:()=>JSON.parse(readFileSync(join(dir,'run','discovery-progress.json'),'utf8')),clean:()=>rmSync(dir,{recursive:true,force:true})};
}
test('101原子取链前重读坐标，不按历史、自家或同标题跳过真实视频',async()=>{const r=rig();try{await r.h.source();const out=await r.h.write_videos();assert.equal(r.writes.length,4);assert.equal(new Set(r.writes.map(v=>v.videoId)).size,4);assert.match(r.calls(),/tap-evidence 340 540/);assert.equal(r.receipt().verified,true);assert.equal(out.all_results_scanned,true);}finally{r.clean();}});
test('真实搜索框关键词错必须停止，不能继续取链',async()=>{const r=rig({wrongSearch:true});try{await assert.rejects(r.h.source(),/关键词不一致/);assert.equal(r.writes.length,0);assert.equal(r.h.state.counts.sources_succeeded,0);assert.ok(r.h.state.failures.some(f=>f.reason==='source_identity_unconfirmed'));}finally{r.clean();}});
test('跨来源同标题仍逐个取真实链接，重复VID只幂等保存一个对象',async()=>{const r=rig({multi:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(r.writes.length,8);assert.equal(out.videos.length,4);assert.equal(out.counts.duplicate,4);assert.equal(out.counts.sources_succeeded,2);}finally{r.clean();}});
test('成功目标已达到，预算到期不应执行下一候选或误报预算耗尽',async()=>{const r=rig({limit:1,expireAfterWrite:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(out.counts.persisted,1);assert.equal(out.counts.attempted,1);assert.equal(out.stop_reason,'limit_reached');assert.deepEqual(out.failures,[]);}finally{r.clean();}});
test('对标身份缺口保留明确gap，无旧坐标取链回退',async()=>{const r=rig({benchmark:true});try{await assert.rejects(r.h.source(),/稳定标题作者/);assert.equal(r.writes.length,0);assert.equal(r.h.state.known_gaps[0].kind,'benchmark_identity_unavailable');}finally{r.clean();}});
test('PG失败停止而不是计成功，保留真实失败交接证据',async()=>{const r=rig({rejectWrite:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(out.counts.persisted,0);assert.equal(out.status,'partial');assert.equal(out.counts.failed,1);assert.match(JSON.stringify(r.progress()),/PG failed/);}finally{r.clean();}});
test('复制失败保留控制器原因，没有任何PG discover写入',async()=>{const r=rig({copyFails:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(r.writes.length,0);assert.match(JSON.stringify(out.failures),/COPY_STALE/);assert.equal(r.progress().counts.persisted,0);}finally{r.clean();}});
test('101无需读取自家号配置，作者筛选由102执行',()=>{const r=rig();r.clean();});
