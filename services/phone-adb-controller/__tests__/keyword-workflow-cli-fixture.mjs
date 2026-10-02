import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fixture, cli, ids, route, service, repo } from './workflow-cli-fixture.mjs';

const require = createRequire(import.meta.url);
const { doc } = require('../checks/probes-lib.js').loadChecks(join(service, 'checks/social-keyword-leadgen.yaml'), join(service, 'checks/schema.json'));
const runtime = process.env.CECELIA_ACTIVITY_RUNTIME;
export const words = ['AI 考证', 'AI 报名'];
const header = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');\nconst home=process.env.HOME;\nconst read=name=>JSON.parse(fs.readFileSync(path.join(home,name),'utf8'));\nconst write=(name,value)=>fs.writeFileSync(path.join(home,name),JSON.stringify(value));\nconst log=value=>fs.appendFileSync(path.join(home,'calls'),value+'\\n');\nconst emit=value=>process.stdout.write(value+'\\n');\n`;

const controller = header + `
(async()=>{
 const args=process.argv.slice(2); const profile=args[1];const action=args[2];const argv=args.slice(3);
 if(profile!=='jinoshengyuan-work')throw Error('fixture profile');
 log('adb '+action+' '+argv.join(' '));
 const state=read('phone-state.json');
 const locked=()=>{if(state.owner!=='cecelia-cli-smoke')throw Error('action without root owner');};
 const save=()=>write('phone-state.json',state);
 switch(action){
 case 'preflight': emit('serial=fixture-serial\\nstate=device\\ncall_state=0\\nprofile='+profile);break;
 case 'lock-status':emit(state.owner?'lock=held owner='+state.owner:'lock=free');break;
 case 'lock-acquire':
   if(state.owner&&state.owner!==argv[0])throw Error('foreign lock');
   emit('lock='+(state.owner?'held':'acquired')+' owner='+argv[0]);
   if(!state.owner){state.owner=argv[0];state.owners.push(argv[0]);save();}break;
 case 'lock-refresh':if(state.owner!==argv[0])throw Error('wrong refresh owner');emit('lock=refreshed owner='+state.owner);break;
 case 'lock-release':
   if(state.owner!==argv[0])throw Error('wrong release owner');state.owner=null;state.owners.push(null);save();emit('lock=released owner='+argv[0]);break;
 case 'wake':case 'unlock':case 'search-video-tab':case 'search-time-layer':locked();break;
 case 'close-app':locked();state.foreground='com.fixture.launcher/.Home';save();break;
 case 'open-app':locked();state.foreground='com.ss.android.ugc.aweme/.Main';save();break;
 case 'foreground':emit('foreground='+state.foreground);break;
 case 'return-safe-desktop':locked();state.foreground='com.fixture.launcher/.Home';save();emit('launcher=com.fixture.launcher\\nforeground='+state.foreground);break;
 case 'account-current':locked();emit('douyin_id=fixture-account');break;
 case 'open-search':locked();state.word=decodeURIComponent(argv[0]);save();break;
 case 'search-video-cards':
   locked();emit(state.word===${JSON.stringify(words[0])}?'10\\t100\\t00:30\\tAI课程1\\n20\\t200\\t00:30\\t历史课程':'10\\t100\\t00:30\\t批内重复\\n30\\t300\\t00:30\\tAI课程2');break;
 case 'tap-evidence':
   locked();if(argv[2]?.includes('-w')){state.video=argv[0]==='10'?${JSON.stringify(ids[0])}:argv[0]==='20'?${JSON.stringify(ids[2])}:${JSON.stringify(ids[1])};save();}break;
 case 'open-video':
   locked();state.video=argv[0];save();
   fs.appendFileSync(path.join(home,'phone-events.jsonl'),JSON.stringify(read('receipt.json').last_event)+'\\n');
   emit('video_opened=1');break;
 case 'current-video-link':locked();emit('video_id='+state.video+'\\nshort_url=https://v.douyin.com/'+state.video+'/');break;
 case 'open-comments':locked();emit('comments_opened=1\\ncomment_count=1');break;
 case 'collect-comments':{
   locked();let n=state.video===${JSON.stringify(ids[0])}?1:2;
   emit('客户'+n+'\\t如何报名'+n+'\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA');
   if(process.env.FIXTURE_STOP_MODE==='cancel')emit('未采客户\\t不该结算\\t今天\\t北京\\tpersonal\\ttap=30 40\\tb64=BBB');
   emit('exhausted=1');break;}
 case 'commenter-identity':{
   locked();let n=state.video===${JSON.stringify(ids[0])}?1:2;
   emit('nickname=客户'+n+'\\ndouyin_id=10'+n+'\\naccount_type=personal');break;}
 case 'commenter-card-link':
   locked();if(process.env.FIXTURE_STOP_MODE==='cancel'){
     fs.writeFileSync(path.join(home,'cancel-ready'),'');await new Promise(r=>setTimeout(r,700));log('native-action-completed commenter-card-link');
   }
   emit('profile_url=https://www.douyin.com/user/'+state.video);break;
 case 'back-to-results':
   locked();let research=argv[2]?.endsWith('-return')&&read('fixture-config.json').rescanWords.includes(argv[1]);
   emit('back_to_results=1'+(research?' recovered_via=research':''));break;
 default:throw Error('unexpected fixture controller '+action);
 }
})().catch(e=>{process.stderr.write(e.message);process.exitCode=97;});
`;

const ssh = header + `
const args=process.argv.slice(2),command=args.at(-1);log('ssh '+command);
const event=read('receipt.json').last_event;
if(event.event_type!=='ACTIVITY_STARTED')throw Error('SSH before persisted start');
fs.appendFileSync(path.join(home,'ssh-events.jsonl'),JSON.stringify({command,event})+'\\n');
if(command.includes('fetch-seen-videos.js')){emit(${JSON.stringify(ids[2])});}
else if(command.includes('qualify-video.js')){
 const value=name=>{const match=command.match(new RegExp('--'+name+"'? +(?:'([^']*)'|([^ ]+))"));return match?.[1]??match?.[2];};
 const action=command.match(/qualify-video.js'? +'?(discover|judge|collected)'?(?: |$)/)?.[1];
 const id=value('video-id'),db=read('pg.json'),config=read('fixture-config.json');
 if(!${JSON.stringify(ids)}.includes(id))throw Error('unknown fixture video');
 if(action==='discover'){
   db.videos[id]||={video_id:id,harvest_batch:value('batch'),keyword:Buffer.from(value('keyword-b64'),'base64').toString(),
     video_url:value('video-url'),line_key:value('line'),judgment_status:'pending',judgment_reason:null,transcript:'fixture录音转写',process_status:'待判定'};
   write('pg.json',db);const row=db.videos[id];
   emit('QUAL_DISCOVER '+JSON.stringify({status:row.judgment_status,process_status:row.process_status,has_transcript:true}));
 }else if(action==='judge'){
   const row=db.videos[id];if(!row)throw Error('judge absent candidate');
   row.judgment_status=config.statuses[${JSON.stringify(ids)}.indexOf(id)];row.judgment_reason=row.judgment_status==='pending'?null:'fixture真实资格理由';
   write('pg.json',db);emit('QUAL_RESULT '+JSON.stringify({verdict:row.judgment_status,kind:'judged'}));
 }else if(action==='collected'){
   const row=db.videos[id];if(row?.judgment_status!=='matched')throw Error('collected nonmatched');
   row.process_status='评论已采';write('pg.json',db);emit('QUAL_COLLECTED {"updated":1}');
 }else throw Error('unknown qualify command');
}else if(command.startsWith('exec ')||command.startsWith('cd ')){
 if(!command.includes(${JSON.stringify(service)}))throw Error('blocked non-fixture source');
 const child=require('node:child_process').spawn('/bin/zsh',['-c',command],{env:process.env,stdio:'inherit'});
 child.on('exit',(code,signal)=>{process.exitCode=code??1;});
}else throw Error('blocked non-fixture SSH');
`;

function depsSource() {
  const allowed = doc.probes.filter(p => p.probe.type === 'sql').map(p => ({ key: p.key, query: p.probe.query }));
  return `import assert from 'node:assert/strict';
import{readFileSync,appendFileSync}from'node:fs';import{join}from'node:path';
import{parametrize}from${JSON.stringify(join(service, 'verify-step.mjs'))};
const specs=${JSON.stringify(allowed)};const home=process.env.HOME;
export default {fetch:globalThis.fetch,feishuCreds:()=>({appId:'fixture-app',appSecret:'fixture-secret'}),
pool:{async query(text,values){
 const event=JSON.parse(readFileSync(join(home,'receipt.json'),'utf8')).last_event;
 assert.equal(event.event_type,'ACTIVITY_STARTED');
 const runTag='cecelia-cli-smoke';let found;
 for(const spec of specs){const p=parametrize(spec.query,{runTag,lineKey:'jinuo',word:values[1]||''});
 if(p.text===text){assert.deepEqual(p.values,values);found=spec;break;}}
 assert.ok(found,'unknown SSOT SQL');
 const db=JSON.parse(readFileSync(join(home,'pg.json'),'utf8'));
 const rows=Object.values(db.videos).filter(r=>r.harvest_batch===values[0]);let answer;
 switch(found.key){
 case'disc_candidates_persisted':answer=rows.filter(r=>r.keyword===values[1]).length;break;
 case'qual_none_pending':answer=rows.filter(r=>r.judgment_status==='pending').length;break;
 case'qual_reason_present':answer=rows.filter(r=>r.judgment_status!=='pending').map(r=>r.judgment_reason);break;
 case'coll_only_matched':answer=rows.filter(r=>r.judgment_status!=='matched'&&r.process_status==='评论已采').length;break;
 case'coll_video_binding_consistent':answer=db.comments.filter(c=>c.harvest_batch===values[0]&&c.source_video_url!==''&&!rows.some(v=>v.video_url===c.source_video_url)).length;break;
 case'videos_readback':answer=rows.length;break;
 case'line_key_not_null':answer=rows.map(r=>r.line_key);break;
 default:throw Error('unsupported fixture SQL '+found.key);}
 appendFileSync(join(home,'sql-events.jsonl'),JSON.stringify({key:found.key,values,answer,event})+'\\n');
 const list=Array.isArray(answer)?answer:[String(answer)];
 return {rows:list.map(value=>({observed:value})),fields:[{name:'observed'}]};
}}};`;
}

export async function keywordFixture(t, statuses = ['matched', 'matched'], options = {}) {
  assert.ok(runtime, '必须显式提供 CECELIA_ACTIVITY_RUNTIME，不可跳过验收');
  const f = await fixture(t, statuses, options.mode || '');
  writeFileSync(join(f.home, 'phone-state.json'), JSON.stringify({ owner: null, owners: [null], word: '', video: null, foreground: 'com.fixture.launcher/.Home' }));
  writeFileSync(join(f.home, 'pg.json'), JSON.stringify({ videos: {}, comments: [] }));
  writeFileSync(join(f.home, 'fixture-config.json'), JSON.stringify({ statuses, rescanWords: options.rescanWords || [] }));
  for (const [name, code] of [['douyin-phone-adb', controller], ['ssh', ssh], ['date', '#!/bin/sh\nexec /bin/date "$@"']]) {
    const file = join(f.home, '.local/bin', name); writeFileSync(file, code); chmodSync(file, 0o755);
  }
  const depsPath = join(f.home, 'probe-deps.mjs'); writeFileSync(depsPath, depsSource());
  f.env.WF_PROBE_DEPS = depsPath; f.env.CECELIA_ACTIVITY_RUNTIME = runtime;
  if (options.modelDelayMs) {
    // 模型HTTP先真实到达本地服务，再模拟响应延迟；abort仍遵守fetch运输协议。
    appendFileSync(join(f.home, 'http-fixture.cjs'), `
const fixtureFetch=globalThis.fetch;
globalThis.fetch=async(value,options)=>{
 const response=await fixtureFetch(value,options);
 if(String(value).startsWith('https://openrouter.ai/')){
  require('node:fs').writeFileSync(require('node:path').join(process.env.HOME,'model-ready'),'');
  await new Promise((resolve,reject)=>{
   const signal=options?.signal;
   const aborted=()=>{clearTimeout(timer);reject(new DOMException('fixture model aborted','AbortError'));};
   const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},${options.modelDelayMs});
   if(signal?.aborted)aborted();else signal?.addEventListener('abort',aborted,{once:true});
  });
 }
 return response;
};`);
  }

  f.input = { run_tag: 'cecelia-cli-smoke', line_key: route.key,
    device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'cecelia-cli-smoke' },
    account: { sender_id: 'fixture-account' },
    keywords: words.map(word => ({ word, max_videos: 4 })),
    execution: { gateway: { host: 'fixture-gateway', cwd: service, node: process.execPath } },
  };
  if (options.singleWord) f.input.keywords = [f.input.keywords[0]];
  if (options.withoutScore) {
    const bindings = JSON.parse(readFileSync(join(service, 'plans/keyword_workflow.bindings.json'), 'utf8'));
    bindings.select = bindings.select.filter(stage => stage !== 'scoring');delete bindings.activities.scoring;
    bindings.activities.delivery.outputs = bindings.activities.delivery.outputs.filter(row => row.type !== 'Lead');
    f.bindingsPath = join(f.home, 'unscored.bindings.json');writeFileSync(f.bindingsPath, JSON.stringify(bindings));
  }
  f.run = async extra => {
    const args = ['--runtime', runtime, '--receipt', f.receiptPath];
    if (f.bindingsPath) args.push('--bindings', f.bindingsPath);
    const output = await cli(join(service, 'keyword-workflow.js'), args, { cwd: repo, env: f.env, input: f.input, ...extra });
    assert.equal(f.errors.length, 0, f.errors.map(e => e.stack).join('\n'));
    assert.equal(output.signal, null, output.stderr);
    const receipt = JSON.parse(output.stdout);
    assert.deepEqual(JSON.parse(readFileSync(f.receiptPath, 'utf8')), receipt, 'stdout应等于显式rootreceipt');
    return { output, receipt };
  };
  f.read = name => JSON.parse(readFileSync(join(f.home, name), 'utf8'));
  f.log = () => readFileSync(join(f.home, 'calls'), 'utf8');
  f.events = name => readFileSync(join(f.home, name), 'utf8').trim().split('\n').map(JSON.parse);
  return f;
}
export { ids, route, controller, ssh, depsSource };
