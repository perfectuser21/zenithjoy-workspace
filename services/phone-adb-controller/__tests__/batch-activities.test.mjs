import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../batch-activity.js', import.meta.url));
const id1 = '1234567890123456789', id2 = '2234567890123456789', id3 = '3234567890123456789';
const input = () => ({ run_tag: 'batch-fixture', line_key: 'jinuo', device: {
  profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'batch-fixture' },
  account: { profile: 'jinoshengyuan-work', sender_id: 'fixture-account' },
  keywords: [{ word: '人工智能', max_videos: 4 }, { word: '训练师', max_videos: 4 }],
  budget: { max_duration_s: 30, heartbeat_s: 1 } });

function fixture(config = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'batch-phone-fixture-'));
  const bin = path.join(home, 'bin'); mkdirSync(bin);
  mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  const state = path.join(home, 'state.json'), log = path.join(home, 'commands.jsonl');
  writeFileSync(state, JSON.stringify({ owner: null, foreground: 'com.launcher', keyword: '', tapped: 0,
    ids: { 人工智能: [id1, id2], 训练师: [id2, id3] }, ...config }));
  const preamble = `#!${process.execPath}\nconst fs=require('node:fs');const f=process.env.FIXTURE_STATE;const s=JSON.parse(fs.readFileSync(f));const a=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(a)+'\\n');const save=()=>fs.writeFileSync(f,JSON.stringify(s));\n`;
  writeFileSync(path.join(home, '.local/bin/douyin-phone-adb'), preamble + `
const c=a[2]; const emit=x=>process.stdout.write(x+'\\n');
async function main(){
if(s.delay_command===c){fs.writeFileSync(process.env.FIXTURE_MARKER,'started');await new Promise(r=>setTimeout(r,s.delay_ms||400));}
if(s.fail_command===c){console.error('fixture command failed');process.exitCode=1;return;}
switch(c){
case 'preflight':emit('profile='+a[1]+'\\nserial='+(s.serial||'fixture-serial')+'\\nstate='+(s.device_state||'device')+'\\ncall_state='+(s.call_state??'0'));break;
case 'lock-status':emit(s.owner?'lock=held owner='+s.owner+' stale=false':'lock=free');break;
case 'lock-acquire':if(s.owner&&s.owner!==a[3]){process.exitCode=1;break;}const held=!!s.owner;s.owner=a[3];save();emit(s.acquire_receipt_bad?'lock=garbled':'lock='+(held?'held':'acquired')+' owner='+s.owner);break;
case 'lock-refresh':if(s.owner!==a[3]){process.exitCode=1;break;}emit('lock=refreshed owner='+s.owner);break;
case 'lock-release':if(s.release_fails){emit('lock=released');break;}if(s.owner&&s.owner!==a[3]){process.exitCode=1;break;}s.owner=null;save();emit('lock=released');break;
case 'wake':case 'unlock':emit(c+'=1');break;
case 'close-app':s.foreground='com.launcher';save();emit('foreground='+s.foreground);break;
case 'open-app':s.foreground='com.ss.android.ugc.aweme';save();emit('foreground='+s.foreground);break;
case 'account-current':emit('douyin_id='+(s.account||'fixture-account'));break;
case 'foreground':emit('foreground='+s.foreground);break;
case 'return-safe-desktop':s.foreground=s.unsafe_desktop?'com.other':'com.launcher';save();emit('launcher=com.launcher\\nforeground='+s.foreground);break;
case 'open-search':s.search_attempts=(s.search_attempts||0)+1;save();if(s.search_attempts<=(s.search_fail_count||0)){console.error('fixture search unavailable');process.exitCode=1;break;}s.keyword=decodeURIComponent(a[3]);save();emit('search_opened=1');break;
case 'search-video-tab':emit('ok=1');break;
case 'search-time-layer':s.filter_attempts=(s.filter_attempts||0)+1;save();if(s.filter_first_fails&&s.filter_attempts===1){process.exitCode=1;break;}emit('ok=1');break;
case 'search-video-cards':for(let i=0;i<(s.ids[s.keyword]||[]).length;i++)emit((100+i)+'\\t200\\t01:30\\t'+(s.entity_title?'AT&amp;T &quot;课程&quot;'+i:s.keyword+'标题'+i));break;
case 'tap-evidence':s.tapped=Number(a[3])-100;save();emit('tap=1');break;
case 'tap-search-video-target':s.target_attempts=(s.target_attempts||0)+1;save();if(s.target_always_missing||s.target_attempts<=(s.target_fail_count||0)){console.error('DISCOVERY_TARGET_UNCONFIRMED');process.exitCode=2;break;}const title=Buffer.from(a[4],'base64').toString();s.target_titles=(s.target_titles||[]).concat(title);s.tapped=Number(title.at(-1));if(s.foreign_on_target===s.target_attempts)s.owner='foreign-run';save();emit('tap=1');break;
case 'current-video-link':if(s.link_context_error){console.error('NOT_ON_VIDEO_DETAIL: current-video-link requires an opened video detail page');process.exitCode=2;break;}if(s.link_bad_exit){console.log('video_id=1234567890123456789\\nshort_url=https://www.douyin.com/video/1234567890123456789');process.exitCode=2;break;}const id=s.invalid_vid?'not-a-video':(s.ids[s.keyword]||[])[s.tapped];emit('video_id='+id+'\\nshort_url=https://www.douyin.com/video/'+id);break;
case 'back-to-results':emit('back_to_results=1');break;
default:console.error('unknown fixture command '+c);process.exitCode=99;
}}
main();`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'ssh'), preamble + `
if(s.execute_gateway){if(a.at(-2)!=='fixture-gateway'){console.error('nonfixture gateway rejected');process.exitCode=99;}else{const r=require('node:child_process').spawnSync('/bin/sh',['-c',a.at(-1)],{env:process.env,stdio:'inherit'});process.exitCode=r.status??99;}}
else if(a.at(-1).includes('fetch-seen-videos.js')){if(s.seen_fails){console.error('seen unavailable');process.exitCode=1;}else for(const id of s.seen||[])console.log(id);}
else if(a.at(-1).includes('qualify-video.js discover')){const id=a.at(-1).match(/--video-id'? '([0-9]+)'/)[1];if(s.persist_empty){console.log('no persistence receipt');}else if(s.persist_fails===id){console.log('QUAL_DISCOVER '+JSON.stringify({status:'error',error:'write failed'}));}else{console.log('QUAL_DISCOVER '+JSON.stringify({status:s.cached_status||'pending',video_id:id,process_status:s.process_status||'待判定'}));if(s.stop_after_persist)fs.writeFileSync(process.env.WF_STOP_FILE,'');}}
else{console.error('nonfixture transport rejected');process.exitCode=99;}`, { mode: 0o755 });
  const gatewayCwd=path.join(home,"isolated source's"), credentials=path.join(home,'.credentials');
  mkdirSync(gatewayCwd);mkdirSync(credentials);
  const envFile=path.join(credentials,'gateway.env');writeFileSync(envFile,"GATEWAY_MARKER='fixture-isolated-source'\n",{mode:0o600});
  writeFileSync(path.join(gatewayCwd,'fetch-seen-videos.js'), `const fs=require('node:fs');const s=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE));for(const id of s.seen||[])console.log(id);`);
  writeFileSync(path.join(gatewayCwd,'qualify-video.js'), `const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2);if(a[0]!=='discover')throw Error('unexpected gateway activity');const value=k=>a[a.indexOf('--'+k)+1];const row={id:value('video-id'),word:Buffer.from(value('keyword-b64'),'base64').toString(),marker:process.env.GATEWAY_MARKER};fs.appendFileSync(path.join(process.env.HOME,'gateway-records.jsonl'),JSON.stringify(row)+'\\n');console.log('QUAL_DISCOVER '+JSON.stringify({status:'pending',process_status:'待判定'}));`);
  writeFileSync(path.join(gatewayCwd,'workflow-probe.js'), `const fs=require('node:fs'),path=require('node:path');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{const r=JSON.parse(text);let rows=[];try{rows=fs.readFileSync(path.join(process.env.HOME,'gateway-records.jsonl'),'utf8').trim().split('\\n').map(JSON.parse);}catch{}console.log(JSON.stringify({checks_sha256:r.checks_sha256,probes:[{key:'disc_candidates_persisted',observed:rows.filter(x=>x.word===r.word).length,probed_at:new Date().toISOString()}]}));});`);
  writeFileSync(path.join(bin, 'adb'), '#!/bin/sh\necho "fixture rejects adb" >&2\nexit 99\n', { mode: 0o755 });
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, FIXTURE_STATE: state, FIXTURE_LOG: log,
    FIXTURE_MARKER: path.join(home, 'marker'), WF_STOP_FILE: path.join(home, 'stop'), HARVEST_KEYWORD_TESTING: '1' };
  function run(action, value = input(), extra = {}, onStart, executable = entry) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [executable, action], { env: { ...env, ...extra } });
      let stdout = '', stderr = '';child.stdout.on('data', c => stdout += c);child.stderr.on('data', c => stderr += c);
      child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr,
        result: stdout.trim() ? JSON.parse(stdout) : null }));
      child.stdin.end(JSON.stringify(value));onStart?.(child);
    });
  }
  return { run, home, env, gateway:{host:'fixture-gateway',cwd:gatewayCwd,node:process.execPath,env_file:envFile}, state: () => JSON.parse(readFileSync(state)),
    commands: () => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } },
    dispose: () => rmSync(home, { recursive: true, force: true }) };
}
const actions = f => f.commands().filter(a=>a[0]==='--profile').map(a=>a[2]);

test('explicit gateway executes isolated discovery modules and safely quotes its source path', async () => {
  const f=fixture({owner:'batch-fixture',execute_gateway:true,seen:[id1]});try{
    const v=input();v.execution={gateway:f.gateway};const r=await f.run('discovery',v);assert.equal(r.code,0,r.stdout);
    assert.deepEqual(r.result.outputs.videos.map(v=>v.video_id),[id2,id3]);
    const remote=f.commands().filter(a=>a[0]!=='--profile');assert.ok(remote.every(a=>a.at(-2)==='fixture-gateway'));
    const records=readFileSync(path.join(f.home,'gateway-records.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length,2);assert.ok(records.every(row=>row.marker==='fixture-isolated-source'));
    assert.ok(remote.every(a=>!a.at(-1).includes('.openclaw/leadgen-scripts')));
  }finally{f.dispose();}
});

test('native workflow discovery retains execution gateway through its real CLI boundary', async () => {
  const f=fixture({owner:'batch-fixture',execute_gateway:true,seen:[id1]});try{
    const v=input();v.execution={gateway:f.gateway};const wrapper=fileURLToPath(new URL('../keyword-workflow-activity.js',import.meta.url));
    const r=await f.run('discovery',v,{},undefined,wrapper);assert.equal(r.code,0,r.stdout);
    assert.deepEqual(r.result.outputs.videos.map(v=>v.video_id),[id2,id3]);
    assert.equal(r.result.outputs.workflow_artifacts.discovery.status,'completed');
  }finally{f.dispose();}
});

test('invalid gateway host, source, node or credential mirror rejects before transport', async () => {
  for(const change of [g=>g.host='-bad',g=>g.cwd='relative',g=>g.node='node; echo injected',g=>g.env_file='/tmp/tool-private.env']){
    const f=fixture({owner:'batch-fixture'});try{const v=input();v.execution={gateway:{...f.gateway}};change(v.execution.gateway);
      const r=await f.run('discovery',v);assert.equal(r.code,1);assert.equal(r.result.reason_code,'invalid_input');assert.deepEqual(f.commands(),[]);
    }finally{f.dispose();}
  }
});

test('preflight CLI verifies explicit device/account and holds the batch lock', async () => {
  const f=fixture();try{const r=await f.run('preflight');assert.equal(r.code,0,r.stderr);assert.equal(r.result.status,'completed');
    assert.deepEqual(r.result.metrics,{device_verified:1,account_verified:1,call_state_idle:1,lock_acquired:1});
    assert.equal(f.state().owner,'batch-fixture');assert.equal(r.result.outputs.device.lock_holder,'batch-fixture');
    assert.equal(r.result.outputs.account.observed_sender_id,'fixture-account');assert.equal(r.result.outputs.comments,undefined);
    assert.ok(actions(f).indexOf('lock-acquire')<actions(f).indexOf('wake'));assert.ok(!actions(f).includes('lock-release'));
  }finally{f.dispose();}
});

test('preflight accepts the real controller idle protocol and rejects active or unknown calls', async () => {
  const f=fixture({call_state:'idle'});
  try {
    const r=await f.run('preflight');
    assert.equal(r.code,0,r.stdout);
    assert.equal(r.result.metrics.call_state_idle,1);
    assert.equal(f.state().owner,'batch-fixture');
  } finally { f.dispose(); }
  for (const call_state of ['ringing','offhook','unknown']) {
    const f=fixture({call_state});
    try {
      const r=await f.run('preflight');
      assert.equal(r.code,1);
      assert.equal(r.result.reason_code,call_state==='unknown'?'call_state_unknown':'call_busy');
      assert.ok(!actions(f).includes('lock-acquire'));
    } finally { f.dispose(); }
  }
});

test('invalid route, lock owner, sender, keywords, and budget reject before transport', async () => {
  for(const change of [v=>v.device.profile='yueshengyun-work',v=>v.device.lock_holder='other-run',v=>delete v.account.sender_id,
    v=>v.keywords=[{word:''}],v=>v.budget.max_duration_s=-1]){
    const f=fixture();try{const v=input();change(v);const r=await f.run('preflight',v);assert.equal(r.code,1);assert.equal(r.result.reason_code,'invalid_input');assert.deepEqual(f.commands(),[]);}finally{f.dispose();}
  }
});

test('wrong device, unknown/busy call and foreign lock never clear the phone', async () => {
  for(const cfg of [{serial:'other'},{device_state:'offline'},{call_state:'unknown'},{call_state:'2'},{owner:'foreign-run'}]){
    const f=fixture(cfg);try{const r=await f.run('preflight');assert.equal(r.code,1);assert.ok(!actions(f).includes('wake'));assert.ok(!actions(f).includes('close-app'));assert.ok(!actions(f).includes('lock-release'));}finally{f.dispose();}
  }
});

test('failed account keeps acquired lock for finally cleanup with truthful metrics', async () => {
  const f=fixture({account:'wrong-account'});try{
    const r=await f.run('preflight');assert.equal(r.code,1);assert.equal(r.result.reason_code,'account_mismatch');assert.equal(r.result.metrics.account_verified,0);
    assert.equal(r.result.outputs.device.lock_holder,'batch-fixture');assert.equal(f.state().owner,'batch-fixture');
    const c=await f.run('cleanup', {...input(), ...r.result.outputs});assert.equal(c.code,0);assert.equal(f.state().owner,null);
    assert.deepEqual(c.result.metrics,{app_closed:1,lock_released:1,safe_desktop_visible:1,close_app_attempts:1});
  }finally{f.dispose();}
});

test('uncertain acquire receipt preserves a genuinely acquired lock for cleanup', async () => {
  const f=fixture({acquire_receipt_bad:true});try{const r=await f.run('preflight');assert.equal(r.code,1);
    assert.equal(r.result.reason_code,'lock_acquire_unconfirmed');assert.equal(r.result.outputs.device.lock_holder,'batch-fixture');
    assert.equal(r.result.metrics.lock_acquired,1);assert.ok(!actions(f).includes('wake'));
  }finally{f.dispose();}
});

test('cleanup releases owned lock even when close-app fails', async () => {
  const f=fixture({owner:'batch-fixture',fail_command:'close-app'});try{const r=await f.run('cleanup');assert.equal(r.code,1);
    assert.equal(r.result.metrics.app_closed,0);assert.equal(r.result.metrics.lock_released,1);assert.equal(f.state().owner,null);
    assert.equal(r.result.metrics.close_app_attempts,1);assert.equal(actions(f).filter(c=>c==='close-app').length,1);
  }finally{f.dispose();}
});

test('cleanup reports zero close-app attempts for a free or foreign lock', async () => {
  for(const owner of [null,'foreign-run']) {
    const f=fixture({owner});try{const r=await f.run('cleanup');assert.equal(r.result.metrics.close_app_attempts,0);
      assert.ok(!actions(f).includes('close-app'));
    }finally{f.dispose();}
  }
});

test('two keywords expose persisted real video IDs with history and batch deduplication', async () => {
  const f=fixture({owner:'batch-fixture',seen:[id1],cached_status:'matched'});try{
    const r=await f.run('discovery');assert.equal(r.code,0,r.stderr);assert.deepEqual(r.result.outputs.videos.map(v=>v.video_id),[id2,id3]);
    assert.equal(r.result.metrics.keywords_processed,2);assert.equal(r.result.metrics.screens_scanned,2);assert.equal(r.result.metrics.persisted,2);
    assert.equal(r.result.metrics.seen_skipped,1);assert.equal(r.result.metrics.duplicates_skipped,1);
    assert.equal(r.result.outputs.videos[0].judgment_status,'matched');assert.equal(r.result.outputs.videos[1].keyword,'训练师');
    assert.equal(r.result.outputs.videos[0].harvest_batch,'batch-fixture');assert.equal(f.state().owner,'batch-fixture');
    assert.ok(!f.commands().some(a=>a.at(-1).includes('qualify-video.js judge')));assert.ok(!actions(f).includes('lock-release'));
  }finally{f.dispose();}
});

test('candidate write failure stays outside output chain and reports partial evidence', async () => {
  const f=fixture({owner:'batch-fixture',persist_fails:id1});try{
    const r=await f.run('discovery');assert.equal(r.code,2);assert.equal(r.result.status,'partial');assert.ok(!r.result.outputs.videos.some(v=>v.video_id===id1));
    assert.ok(r.result.evidence.some(e=>e.reason_code==='candidate_persist_failed'));
  }finally{f.dispose();}
});

test('missing persistence receipt reports partial rather than silently successful empty discovery', async () => {
  const f=fixture({owner:'batch-fixture',persist_empty:true});try{
    const r=await f.run('discovery');assert.equal(r.code,2);assert.equal(r.result.reason_code,'candidate_persist_failed');assert.deepEqual(r.result.outputs.videos,[]);
  }finally{f.dispose();}
});

test('PG collected state skips cached matched historical video', async () => {
  const f=fixture({owner:'batch-fixture',cached_status:'matched',process_status:'评论已采'});try{
    const r=await f.run('discovery');assert.equal(r.code,0);assert.deepEqual(r.result.outputs.videos,[]);assert.equal(r.result.metrics.seen_skipped,4);
  }finally{f.dispose();}
});

test('filter failure reopens the same search and retries once', async () => {
  const f=fixture({owner:'batch-fixture',filter_first_fails:true});try{
    const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,0);
    assert.equal(actions(f).filter(c=>c==='open-search').length,2);assert.equal(actions(f).filter(c=>c==='search-time-layer').length,2);
  }finally{f.dispose();}
});

test('first open-search failure reopens the same keyword once before filtering', async () => {
  const f=fixture({owner:'batch-fixture',search_fail_count:1});try{
    const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,0);
    assert.equal(r.result.metrics.keywords_processed,1);assert.equal(r.result.outputs.videos.length,2);
    const searches=f.commands().filter(a=>a[2]==='open-search');assert.equal(searches.length,2);
    assert.ok(searches.every(a=>decodeURIComponent(a[3])==='人工智能'));
    assert.equal(actions(f).filter(c=>c==='search-time-layer').length,1);
  }finally{f.dispose();}
});

test('two open-search failures stop the word before filtering or card scanning', async () => {
  const f=fixture({owner:'batch-fixture',search_fail_count:2});try{
    const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,2);
    assert.equal(r.result.reason_code,'search_open_failed');assert.deepEqual(r.result.outputs.videos,[]);
    assert.equal(actions(f).filter(c=>c==='open-search').length,2);
    assert.ok(!actions(f).includes('search-time-layer'));assert.ok(!actions(f).includes('search-video-cards'));
  }finally{f.dispose();}
});

test('history fetch failure stops conservatively before search instead of using empty seen', async () => {
  const f=fixture({owner:'batch-fixture',seen_fails:true});try{const r=await f.run('discovery');assert.equal(r.code,2);
    assert.equal(r.result.reason_code,'seen_fetch_failed');assert.deepEqual(r.result.outputs.videos,[]);assert.ok(!actions(f).includes('open-search'));
  }finally{f.dispose();}
});

test('known historical missing-ID placeholders keep valid dedup IDs; unrelated malformed history rejects', async () => {
  const f=fixture({owner:'batch-fixture',seen:[id1,'id未取到','id未取到']});
  try {
    const r=await f.run('discovery');
    assert.equal(r.code,0,r.stdout);
    assert.deepEqual(r.result.outputs.videos.map(v=>v.video_id),[id2,id3]);
    assert.equal(r.result.metrics.history_placeholders_skipped,2);
    assert.ok(r.result.metrics.seen_skipped>=1);
  } finally { f.dispose(); }
  const bad=fixture({owner:'batch-fixture',seen:[id1,'unexpected-history']});
  try {
    const r=await bad.run('discovery');
    assert.equal(r.code,2);
    assert.equal(r.result.reason_code,'seen_fetch_invalid');
    assert.ok(!actions(bad).includes('open-search'));
  } finally { bad.dispose(); }
});

test('deadline and stop retain candidates and start no new card', async () => {
  const f=fixture({owner:'batch-fixture',stop_after_persist:true});try{const r=await f.run('discovery');assert.equal(r.code,2);
    assert.equal(r.result.reason_code,'commander_stop');assert.equal(r.result.outputs.videos.length,1);assert.equal(actions(f).filter(c=>c==='tap-search-video-target').length,1);
  }finally{f.dispose();}
  const d=fixture({owner:'batch-fixture'});try{const r=await d.run('discovery',input(),{WF_RUN_START_TS:'1',WF_RUN_MAX_SECONDS:'1'});
    assert.equal(r.code,2);assert.equal(r.result.reason_code,'deadline');assert.deepEqual(d.commands(),[]);
  }finally{d.dispose();}
});

test('own TERM waits for in-flight phone action and ends at safe boundary', async () => {
  const f=fixture({owner:'batch-fixture',delay_command:'tap-search-video-target',delay_ms:450});try{
    const r=await f.run('discovery',input(),{},child=>{
      const timer=setInterval(()=>{try{readFileSync(f.env.FIXTURE_MARKER);clearInterval(timer);child.kill('SIGTERM');}catch{}},10);
      child.on('close',()=>clearInterval(timer));
    });assert.equal(r.code,2,r.stderr);assert.equal(r.result.reason_code,'interrupted');assert.equal(f.state().tapped,0);
    assert.ok(!actions(f).includes('current-video-link'));assert.equal(f.state().owner,'batch-fixture');
  }finally{f.dispose();}
});

test('activity budget ends at completed phone-action boundary', async () => {
  const f=fixture({owner:'batch-fixture',delay_command:'tap-search-video-target',delay_ms:3500});try{
    const v=input();v.budget.max_duration_s=3;const r=await f.run('discovery',v);assert.equal(r.code,2);
    assert.equal(r.result.reason_code,'budget_exceeded');assert.equal(readFileSync(f.env.FIXTURE_MARKER,'utf8'),'started');assert.ok(!actions(f).includes('current-video-link'));
  }finally{f.dispose();}
});

test('cleanup ignores stop, verifies release, and refuses foreign phone scene', async () => {
  const f=fixture({owner:'foreign-run'});try{const r=await f.run('cleanup');assert.equal(r.code,1);assert.equal(r.result.reason_code,'foreign_lock');
    assert.deepEqual(actions(f),['preflight','lock-status']);assert.equal(f.state().owner,'foreign-run');
  }finally{f.dispose();}
  const own=fixture({owner:'batch-fixture',release_fails:true});try{
    writeFileSync(own.env.WF_STOP_FILE,'');const r=await own.run('cleanup');assert.equal(r.code,1);assert.equal(r.result.metrics.lock_released,0);
    assert.equal(actions(own).filter(c=>c==='lock-release').length,3);assert.equal(r.result.reason_code,'lock_release_unconfirmed');
  }finally{own.dispose();}
  const free=fixture();try{const r=await free.run('cleanup');assert.equal(r.code,0);assert.equal(r.result.metrics.app_closed,0);
    assert.equal(r.result.metrics.safe_desktop_visible,0);assert.ok(!actions(free).includes('close-app'));
  }finally{free.dispose();}
});

test('unsafe desktop remains a cleanup failure even when lock release succeeds', async () => {
  const f=fixture({owner:'batch-fixture',unsafe_desktop:true});try{const r=await f.run('cleanup');assert.equal(r.code,1);
    assert.equal(r.result.metrics.safe_desktop_visible,0);assert.equal(r.result.metrics.lock_released,1);assert.equal(f.state().owner,null);
  }finally{f.dispose();}
});


test('discovery uses fresh identity command and preserves original target queue after recovery', async () => {
 const f=fixture({owner:'batch-fixture',target_fail_count:1});try{const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,0,r.stdout);
 assert.deepEqual(f.state().target_titles,['人工智能标题0','人工智能标题1']);assert.ok(!actions(f).includes('tap-evidence'));
 const targets=f.commands().filter(a=>a[2]==='tap-search-video-target');assert.equal(targets.length,3);assert.deepEqual(targets.map(a=>Buffer.from(a[4],'base64').toString()),['人工智能标题0','人工智能标题0','人工智能标题1']);
 }finally{f.dispose();}
});
test('missing target is bounded to three same-keyword recovery cycles, never swaps target', async()=>{
 const f=fixture({owner:'batch-fixture',target_always_missing:true});try{const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,2,r.stdout);assert.equal(r.result.reason_code,'discovery_context_unconfirmed');assert.equal(f.state().target_attempts,4);assert.ok(!actions(f).includes('current-video-link'));assert.equal(r.result.outputs.videos.length,0);
 }finally{f.dispose();}
});
test('NOT_ON_VIDEO_DETAIL is a local Discovery context failure, transport and invalid VID never persist',async()=>{
 for(const cfg of [{link_context_error:true},{invalid_vid:true},{link_bad_exit:true}]){
  const f=fixture({owner:'batch-fixture',...cfg});try{const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,2,r.stdout);assert.equal(r.result.metrics.persisted,0);assert.ok(!f.commands().some(a=>a.at(-1).includes('qualify-video.js discover')));if(cfg.link_context_error)assert.equal(r.result.reason_code,'discovery_context_unconfirmed');if(cfg.link_bad_exit)assert.equal(r.result.reason_code,'phone_transport_unavailable');
  }finally{f.dispose();}
 }
});

test('lock changes after target operation retain earlier output and prevent further link or persist', async()=>{
 const f=fixture({owner:'batch-fixture',foreign_on_target:2});try{const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,2,r.stdout);assert.equal(r.result.reason_code,'foreign_lock');assert.equal(r.result.outputs.videos.length,1);assert.equal(actions(f).filter(c=>c==='current-video-link').length,1);assert.equal(r.result.metrics.persisted,1);
 }finally{f.dispose();}
});

test('scan raw XML title entities are decoded once for immutable target identity and persisted title',async()=>{
 const f=fixture({owner:'batch-fixture',entity_title:true});try{const v=input();v.keywords=[v.keywords[0]];const r=await f.run('discovery',v);assert.equal(r.code,0,r.stdout);assert.deepEqual(f.state().target_titles,['AT&T "课程"0','AT&T "课程"1']);assert.equal(r.result.outputs.videos[0].title,'AT&T "课程"0');
 }finally{f.dispose();}
});
