import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
const exec=promisify(execFile),root=resolve('services/phone-adb-controller');
const vid='7646309328911907195';
function rig({rejectWrite=false,copyFails=false,emptyHistory=false,benchmark=false,multi=false,wrongSearch=false,extraCard=false,expireAfterWrite=false,limit=2}={}){
 const dir=mkdtempSync(join(tmpdir(),'new-discovery-'));const log=join(dir,'calls');const ctl=join(dir,'ctl');
 writeFileSync(ctl,`#!/bin/zsh
print -r -- "$3 $4 $5" >> "$CALLS"
case "$3" in
 open-search) print -r -- "$4" > "$FAKE_TMP/keyword";;
 search-video-tab) python3 -c 'import sys,os,urllib.parse,xml.sax.saxutils
word="错误关键词" if os.getenv("WRONG_SEARCH") else urllib.parse.unquote(open(sys.argv[1]).read().strip())
os.makedirs(os.path.dirname(sys.argv[2]),exist_ok=True)
open(sys.argv[2],"w").write("<hierarchy><node resource-id=\\"com.ss.android.ugc.aweme:id/et_search_kw\\" text=\\""+xml.sax.saxutils.escape(word)+"\\"/></hierarchy>")' "$FAKE_TMP/keyword" "$DOUYIN_PHONE_TMP_ROOT/evidence/jinoshengyuan-work/$4-aftertab.xml";;
 search-kw-matches) python3 -c 'import sys,xml.etree.ElementTree as ET
ok=any(n.get("resource-id","").endswith("et_search_kw") and n.get("text")==sys.argv[1] for n in ET.parse(sys.argv[2]).iter("node"))
print("kw_matches="+str(int(ok)))
sys.exit(0 if ok else 1)' "$4" "$5";;
 open-user-profile) print 'works_count=20';print 'nickname=对标作者';;
 profile-video-cards) print '100\\t200\\t\\t';print '300\\t200\\t\\t';;
 search-video-cards)
  if [[ "$4" == *'-cards'* ]];then
   print '100\\t200\\t00:20\\t已见视频\\t别人';print '110\\t210\\t00:20\\t自家视频\\t自己';print '120\\t220\\t00:20\\t目标视频\\t甲';print '130\\t230\\t00:20\\t目标视频\\t甲';
   [[ -z "$EXTRA_CARD" ]] || print '140\\t240\\t00:20\\t剩余视频\\t乙';
  elif [[ "$4" == *'-loc0' ]]; then print '120\\t220\\t00:20\\t无关视频\\t别人';
  else print '320\\t520\\t00:20\\t目标视频\\t甲';fi;;
 current-video-link) [[ -z "$COPY_FAILS" ]] || {print -u2 'COPY_STALE: stale previous target';exit 1;};print 'video_id=${vid}';print 'short_url=https://v.douyin.com/newTarget/';print 'content_type=video';;
 *) ;;
esac
`,{mode:0o755});
 const env={...process.env,CALLS:log,DOUYIN_PHONE_ADB:ctl,HARVEST_KEYWORD_TESTING:'1',COPY_FAILS:copyFails?'1':'',DOUYIN_PHONE_TMP_ROOT:dir,FAKE_TMP:dir,WFR_RUN_DIR:join(dir,'run'),WRONG_SEARCH:wrongSearch?'1':'',EXTRA_CARD:extraCard?'1':''};
 async function execute(command,args,opts={}){
  if(command==='/bin/sleep') return {code:0,stdout:'',stderr:''};
  try {const r=await exec(command,args,{env:{...env,...opts.env},timeout:5000});return {code:0,...r};}
  catch(e){return {code:typeof e.code==='number'?e.code:1,stdout:e.stdout||'',stderr:e.stderr||e.message};}
 }
 const phone=async(command,...args)=>{const r=await execute('zsh',[ctl,'--profile','jinoshengyuan-work',command,...args]);if(r.code){const e=new Error(r.stderr);e.stderr=r.stderr;throw e;}return r.stdout;};
 const writes=[];
 const queue=async(op,fields)=>{
  if(op==='history'){if(emptyHistory)throw new Error('PG unavailable');return {videos:[{title:'已见视频',video_id:'7646309328911907000'}]};}
  assert.equal(op,'discover');writes.push(fields);
  if(expireAfterWrite){env.WF_RUN_START_TS=String(Math.floor(Date.now()/1000)-100);env.WF_RUN_MAX_SECONDS='1';}
  return rejectWrite?{status:'error',error:'PG failed'}:{status:'pending',video_id:fields.video.videoId};
 };
 const h=createDiscoveryHandlers({phone,execute,queue,profile:'jinoshengyuan-work',run:'cmd100822-new',root,limit,sourceKind:benchmark?'benchmark':'keyword',sources:multi?['人工智能训练师','AI训练师']:['人工智能训练师'],ownAccounts:{nicknames:['自己'],ids:[]},env});
 return {h,writes,calls:()=>readFileSync(log,'utf8'),receipt:()=>JSON.parse(readFileSync(join(dir,'run','cmd100822-new-source-1-readback.json'),'utf8')),
  progress:()=>JSON.parse(readFileSync(join(dir,'run','discovery-progress.json'),'utf8')),clean:()=>rmSync(dir,{recursive:true,force:true})};
}
test('new discovery invokes atomic primitive, filters before tapping, and relocates shifted cards',async()=>{
 const r=rig();try {await r.h.source();await r.h.dedup();await r.h.write_videos();
  assert.equal(r.writes.length,1);assert.equal(r.writes[0].video.videoId,vid);
  assert.match(r.calls(),/tap-evidence 320 520/);assert.doesNotMatch(r.calls(),/tap-evidence 120 220/);
  assert.equal(r.h.state.counts.historical,1);assert.equal(r.h.state.counts.own,1);assert.equal(r.h.state.counts.duplicate,0);
 assert.equal(r.h.state.counts.persisted,1);
  assert.equal(r.h.state.counts.sources_succeeded,1);assert.equal(r.receipt().verified,true);
 }finally{r.clean();}
});
test('wrong actual search text fails source and writes a false independent receipt',async()=>{
 const r=rig({wrongSearch:true});try{await assert.rejects(r.h.source(),/全部发现来源执行失败/);assert.equal(r.h.state.counts.sources_succeeded,0);assert.equal(r.receipt().verified,false);assert.equal(r.writes.length,0);assert.ok(r.h.state.failures.some(f=>f.reason==='source_identity_unconfirmed'));}finally{r.clean();}
});
test('duplicate title and author across sources is removed before taking links',async()=>{
 const r=rig({multi:true});try{await r.h.source();await r.h.dedup();await r.h.write_videos();assert.equal(r.h.state.counts.duplicate,1);assert.equal(r.writes.length,1);}finally{r.clean();}
});
test('优先消费最近核验来源的候选，仍先核验所有来源及历史、自家、重复过滤',async()=>{
 const r=rig({multi:true});try{
  await r.h.source();await r.h.dedup();await r.h.write_videos();
  assert.equal(r.h.state.counts.sources_succeeded,2);assert.equal(r.h.state.counts.historical,2);assert.equal(r.h.state.counts.own,2);
  assert.equal(r.writes.length,1);assert.equal(r.writes[0].video.keyword,'AI训练师');
  assert.equal(r.h.state.counts.duplicate,1);
 }finally{r.clean();}
});
test('已达到成功目标后直接收尾，预算到期不应触发下一候选或把成功误报耗尽',async()=>{
 const r=rig({limit:1,extraCard:true,expireAfterWrite:true});try{
  await r.h.source();await r.h.dedup();const result=await r.h.write_videos();
  assert.equal(result.counts.persisted,1);assert.equal(result.counts.attempted,1);assert.equal(result.counts.limit_skipped,1);
  assert.equal(r.writes.length,1);assert.equal(r.calls().split('\n').filter(x=>x.startsWith('current-video-link ')).length,1);
  assert.deepEqual(result.failures,[]);
 }finally{r.clean();}
});
test('benchmark identity gap is explicit and cannot fall back to old coordinates',async()=>{
 const r=rig({benchmark:true});try{await r.h.source();await r.h.dedup();await r.h.write_videos();assert.equal(r.writes.length,0);assert.equal(r.h.state.counts.missing_identity,2);assert.equal(r.h.state.known_gaps[0].kind,'benchmark_identity_unavailable');assert.doesNotMatch(r.calls(),/tap-evidence/);}finally{r.clean();}
});
test('failed PG persistence is reported and never counted as a successful candidate',async()=>{
 const r=rig({rejectWrite:true});try{await r.h.source();await r.h.dedup();await r.h.write_videos();assert.equal(r.h.state.counts.persisted,0);assert.equal(r.h.state.counts.failed,1);assert.ok(r.h.state.failures.some(f=>f.reason==='persistence_failed'));}finally{r.clean();}
});
test('copy failure preserves controller cause and never reaches PG discover',async()=>{
 const r=rig({copyFails:true});try{await r.h.source();await r.h.dedup();await r.h.write_videos();assert.equal(r.writes.length,0);assert.match(JSON.stringify(r.h.state.failures),/COPY_STALE/);
  const progress=r.progress();
  assert.equal(progress.counts.persisted,0);assert.equal(progress.counts.failed,1);assert.match(JSON.stringify(progress.failures),/COPY_STALE/);
 }finally{r.clean();}
});
test('history unavailable aborts instead of treating the database as empty',async()=>{
 const r=rig({emptyHistory:true});try{await r.h.source();await assert.rejects(r.h.dedup(),/PG unavailable/);assert.equal(r.writes.length,0);}finally{r.clean();}
});
test('missing own account configuration fails closed',()=>{
 assert.throws(()=>createDiscoveryHandlers({phone(){},execute(){},queue(){},profile:'p',run:'r',root,sources:['x']}),/自家账号/);
});
