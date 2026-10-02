import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, ids, route } from './workflow-cli-fixture.mjs';
import { controller, ssh, depsSource, words } from './keyword-workflow-cli-fixture.mjs';

const archive = new URL('./fixtures/frozen-legacy/cdf718dc.tar.gz', import.meta.url);
export const manifest = JSON.parse(readFileSync(new URL('./fixtures/frozen-legacy/manifest.json', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ledgerPath = home => join(home, 'wfr/ledger/social-keyword-leadgen-crontab-cecelia-cli-smoke/ledger.json');
const header = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');\nconst home=process.env.HOME;\nconst read=name=>JSON.parse(fs.readFileSync(path.join(home,name),'utf8'));\nconst write=(name,value)=>fs.writeFileSync(path.join(home,name),JSON.stringify(value));\nconst log=value=>fs.appendFileSync(path.join(home,'calls'),value+'\\n');\nconst emit=value=>process.stdout.write(value+'\\n');\n`;

export async function legacyFixture(t, statuses = ['matched', 'matched'], options = {}) {
  const f = await fixture(t, statuses, options.mode || '', { modelPattern:options.mode==='cancel' ? /如何报名|不该结算/ : /如何报名/, snapshot(home) {
    const ledger = JSON.parse(readFileSync(ledgerPath(home), 'utf8'));
    assert.equal(ledger.run_id, 'social-keyword-leadgen-crontab-cecelia-cli-smoke');
    assert.ok(Object.values(ledger.stages).some(row => row.status !== 'pending'), '旧HTTP必须拥有真实旧账本');
    return { last_event: { event_type: 'LEGACY_LEDGER_READ', run_id: ledger.run_id, stages: ledger.stages } };
  }});
  const frozen = join(f.home, 'frozen'); mkdirSync(frozen);
  assert.equal(sha(readFileSync(archive)), manifest.archive_sha256);
  const extract = spawnSync('/usr/bin/tar', ['-xzf', archive.pathname, '-C', frozen], { encoding: 'utf8' });
  assert.equal(extract.status, 0, extract.stderr);
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(sha(readFileSync(join(frozen, name))), digest, name);
  writeFileSync(join(f.home, 'phone-state.json'), JSON.stringify({ owner: null, owners: [null], word: '', video: null, foreground: 'com.fixture.launcher/.Home' }));
  writeFileSync(join(f.home, 'pg.json'), JSON.stringify({ videos: {}, comments: [] }));
  writeFileSync(join(f.home, 'fixture-config.json'), JSON.stringify({ statuses, rescanWords: options.rescanWords || [] }));
  let oldController = controller.replace("argv[2]?.includes('-w')", "/-v[0-9]+$/.test(argv[2]||'')")
    .replace("state.owner!=='cecelia-cli-smoke'", "!state.owner?.startsWith('cecelia-cli-smoke')")
    .replace("if(state.owner&&state.owner!==argv[0])throw Error('foreign lock');", "if(state.owner&&state.owner!==argv[0]&&!argv[0].startsWith(state.owner+'-'))throw Error('foreign lock');")
    .replace("if(state.owner!==argv[0])throw Error('wrong refresh owner');", "if(state.owner!==argv[0]&&!argv[0].startsWith(state.owner+'-'))throw Error('wrong refresh owner');")
    .replace("if(state.owner!==argv[0])throw Error('wrong release owner');", "if(state.owner&&state.owner!==argv[0]&&!argv[0].startsWith(state.owner+'-'))throw Error('wrong release owner');");
  // 老采集使用点击卡片进入视频；新open-video独有的receipt记录不会出现在旧路径。
  oldController = oldController.replace("fs.appendFileSync(path.join(home,'phone-events.jsonl'),JSON.stringify(read('receipt.json').last_event)+'\\n');", "");
  if(options.mode==='budget') oldController=oldController.replace("emit('profile_url=https://www.douyin.com/user/'+state.video);break;", "emit('profile_url=https://www.douyin.com/user/'+state.video);fs.writeFileSync(path.join(home,'now'),'1006');break;");
  const legacyRemote = ssh
    .replace("line_key:value('line')", "line_key:require(path.join(home,'frozen/line-routes.js')).routeOf(value('line')).key")
    .replace("const event=read('receipt.json').last_event;\nif(event.event_type!=='ACTIVITY_STARTED')throw Error('SSH before persisted start');", `if(command.includes('kpi-gate.js')){emit('{"verdict":"go","reason":"fixture缺口","words":2}');process.exit(0);}
if(command.includes('next-keywords.js')){emit(fs.readFileSync(path.join(home,'words'),'utf8'));process.exit(0);}
if(command.includes('openclaw cron list')){const host=require('node:child_process').execFileSync('/bin/hostname',['-s'],{encoding:'utf8'}).trim().toLowerCase();emit(JSON.stringify({jobs:[{id:'fixture-escort',name:'escort-'+host+'-cecelia-cli-smoke'}]}));process.exit(0);}
if(command.includes('openclaw cron rm')||command.includes('update-keyword-stats.js')){process.exit(0);}
const event={event_type:'LEGACY_LEDGER_READ',ledger:JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath(f.home))},'utf8'))};`)
    .replace("}else if(command.startsWith('exec ')", `}else if(command.includes('push-videos.js')&&command.includes('push-raw-comments.js')){
 const cp=require('node:child_process');
 for(const name of ['push-videos.js','push-raw-comments.js']){
  const r=cp.spawnSync(process.execPath,[path.join(home,'frozen',name),path.join(home,'remote.tsv'),'cecelia-cli-smoke','jinuo'],{env:process.env,encoding:'utf8'});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.status!==0){process.exit(r.status||1);}
 }
}else if(command.includes('sort-comments.js')){
 {const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,[path.join(home,'frozen/sort-comments.js'),'jinuo'],{env:process.env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status||0;}
}else if(command.includes('verify-step.mjs')){
 let args=command.slice(command.indexOf(' --stage '));
 const r=require('node:child_process').spawnSync('/bin/zsh',['-c', JSON.stringify(process.execPath)+' '+JSON.stringify(fs.realpathSync(path.join(home,'frozen/verify-step.mjs')))+args+' --deps '+JSON.stringify(path.join(home,'old-probe-deps.mjs'))],{env:process.env,encoding:'utf8'});
 fs.appendFileSync(path.join(home,'probe-events.jsonl'),JSON.stringify({command,result:JSON.parse(r.stdout.trim())})+'\\n');
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status||0;
}else if(command.startsWith('exec ')`);
  const scp = header + `const args=process.argv.slice(2);log('scp '+args.join(' '));if(args.at(-1)!=='mmv:/tmp/cecelia-cli-smoke.tsv')throw Error('blocked SCP');const src=args.at(-2);if(!src.startsWith(home+'/'))throw Error('unsafe source');fs.copyFileSync(src,path.join(home,'remote.tsv'));`;
  const blocked = '#!/bin/sh\necho blocked-external-boundary >&2\nexit 97\n';
  const scripts = { 'douyin-phone-adb': oldController, ssh: legacyRemote, scp,
    adb: '#!/bin/sh\nprintf "bare-adb %s\\n" "$*" >> "$HOME/calls"\ncase "$*" in *get-state*) echo device;; *"dumpsys power"*) echo mWakefulness=Awake;; *"dumpsys telephony.registry"*) echo mCallState=0;; esac\nexit 0\n',
    find: '#!/bin/sh\nprintf "blocked-find %s\\n" "$*" >> "$HOME/calls"\nexit 0\n',
    curl: blocked, sleep: '#!/bin/sh\nexit 0\n',
    date: '#!/bin/sh\n[ "$1" = +%H ] && { echo 23; exit; }\n[ "$1" = +%s ] && { cat "$HOME/now"; exit; }\nexec /bin/date "$@"\n' };
  for (const [name, code] of Object.entries(scripts)) { const file = join(f.home, '.local/bin', name); writeFileSync(file, code); chmodSync(file, 0o755); }
  // 冻结archive使用BSD mktemp -t prefix；仅转换该运输参数，文件仍由真实系统工具创建。
  const mktemp = join(f.home, '.local/bin/mktemp');
  writeFileSync(mktemp, `#!${process.execPath}
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const backend=${JSON.stringify(options.mktempBackend || '/usr/bin/mktemp')};
const requested=process.argv.slice(2),args=[...requested];
for(let i=0;i<args.length;i++)if(args[i]==='-t'&&i+1<args.length){
 if(!args[i+1].includes('XXXXXX'))args[i+1]+='.XXXXXXXX';i++;
}
const result=cp.spawnSync(backend,args,{encoding:'utf8'});
fs.appendFileSync(path.join(process.env.HOME,'mktemp-events.jsonl'),JSON.stringify({backend,requested,args,status:result.status,stdout:result.stdout})+'\\n');
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
if(result.error)process.stderr.write(result.error.message+'\\n');
process.exitCode=result.status??1;
if(result.signal)process.kill(process.pid,result.signal);
`, { mode:0o700 });
  const preloadPath = join(f.home, 'http-fixture.cjs');
  writeFileSync(preloadPath, readFileSync(preloadPath, 'utf8') + `
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const originalRead=fs.readFileSync;
fs.readFileSync=function(file,...args){
 if(String(file)==='/Users/administrator/.openclaw/clawdbot.json')return JSON.stringify({channels:{feishu:{accounts:{[process.env.FEISHU_ACCOUNT]:{appId:'fixture-app',appSecret:'fixture-secret'}}}}});
 return originalRead.call(this,file,...args);
};
const originalLoad=Module._load;
Module._load=function(name,parent,...args){
 if(name==='./leadgen-db-connect.js'&&parent?.filename.endsWith('/frozen/push-videos.js'))return {getPool:()=>({
  async query(sql,values){
   if(!sql.includes('INSERT INTO zenithjoy.leadgen_videos')||!sql.includes('DO NOTHING'))throw Error('unexpected old PG SQL');
   const db=JSON.parse(originalRead(path.join(process.env.HOME,'pg.json'),'utf8'));
   if(!db.videos[values[1]])throw Error('push must follow discovered fixture video');
   fs.appendFileSync(path.join(process.env.HOME,'pg-writes.jsonl'),JSON.stringify({sql,values})+'\\n');return {rows:[]};
  },async end(){}
 })};
 return originalLoad.call(this,name,parent,...args);
};
Date.now=()=>1790937600000;
`);
  let probes = depsSource()
    .replaceAll(JSON.stringify(join(new URL('../', import.meta.url).pathname, 'verify-step.mjs')), JSON.stringify(join(frozen, 'verify-step.mjs')))
    .replace("const event=JSON.parse(readFileSync(join(home,'receipt.json'),'utf8')).last_event;\n assert.equal(event.event_type,'ACTIVITY_STARTED');", `const event={event_type:'LEGACY_LEDGER_READ',ledger:JSON.parse(readFileSync(${JSON.stringify(ledgerPath(f.home))},'utf8'))};`);
  const frozenRequire=createRequire(join(frozen,'checks/probes-lib.js'));
  const {doc}=frozenRequire(join(frozen,'checks/probes-lib.js')).loadChecks(join(frozen,'checks/social-keyword-leadgen.yaml'),join(frozen,'checks/schema.json'));
  const oldSpecs=doc.probes.filter(row=>row.probe.type==='sql').map(row=>({key:row.key,query:row.probe.query}));
  const stepSpecs=JSON.parse(readFileSync(join(frozen,'step-dod.json'),'utf8')).steps.filter(row=>row.readback?.type==='sql').map(row=>({key:'step:'+row.key,query:row.readback.query}));
  probes=probes.replace(/const specs=(\[[^\n]+\]);const home=/, ()=> 'const specs='+JSON.stringify([...oldSpecs,...stepSpecs])+';const home=');
  probes=probes.replace("default:throw Error('unsupported fixture SQL '+found.key);", `default:
 if(found.key==='step:keyword_acquisition.discovery.persist_candidates')answer=rows.filter(r=>r.keyword===values[1]).length;
 else if(found.key==='step:keyword_acquisition.qualification.transcribe')answer=rows.filter(r=>r.keyword===values[1]&&r.judgment_status!=='pending'&&!r.transcript&&!/^(转写为空|V2便宜闸)/.test(r.judgment_reason||'')).length;
 else if(found.key==='step:keyword_acquisition.qualification.judge_content')answer=rows.filter(r=>r.keyword===values[1]&&r.judgment_status!=='pending'&&!r.judgment_reason).length;
 else if(found.key==='step:keyword_acquisition.collection.mark_video_collected')answer=rows.filter(r=>r.keyword===values[1]&&r.process_status==='评论已采').length;
 else if(found.key==='step:keyword_acquisition.delivery.readback_videos')answer=rows.length;
 else if(found.key==='step:keyword_acquisition.delivery.readback_line_key')answer=rows.map(r=>r.line_key);
 else throw Error('unsupported fixture SQL '+found.key);`);
  writeFileSync(join(f.home, 'old-probe-deps.mjs'), probes);
  writeFileSync(join(f.home, 'words'), words.join('\n')+'\n');
  mkdirSync(join(f.home,'.config/openclaw'),{recursive:true});
  writeFileSync(join(f.home,'.config/openclaw/douyin-account-routes.tsv'),'jinoshengyuan-work\tfixture-account\n');
  f.env = { ...f.env, WF_PLAN_DIR:join(frozen,'plans'), BATCH2:join(frozen,'batch2.sh'), WALL_REPORT:join(f.home,'absent-wall'), WF_TESTING: '1', BATCH_SLEEP: '0', BATCH2_NOW_HOUR: '23',
    WFR: join(frozen,'workflow-result.sh'), HARVEST_KEYWORD: join(frozen,'harvest-keyword.sh'),
    WFR_HOME: join(f.home,'wfr'), WFR_NODE: process.execPath, WFR_JQ: spawnSync('/bin/zsh',['-c','command -v jq'],{encoding:'utf8'}).stdout.trim(),
    WFR_LEDGER_MJS: join(frozen,'ledger.mjs'), WFR_SCP_TARGET: '', WFR_BRAIN_ENV: join(f.home,'absent-brain.env'),
    BRAIN_URL: '', BRAIN_INTERNAL_TOKEN: '', WFR_CHECKS_YAML: join(frozen,'checks/social-keyword-leadgen.yaml'),
    WFR_EVIDENCE_ROOT:join(f.home,'evidence'), WFR_STEP_JUDGE: join(frozen,'step-judge.mjs'), WFR_STEP_SPEC: join(frozen,'step-dod.json') };
  if(options.mode==='budget')f.env.WF_RUN_MAX_SECONDS='5';
  f.run = async () => {
    const output = await new Promise((done,reject) => {
      const args=[join(frozen,'wf-run.sh'),'keyword_acquisition','jinoshengyuan-work','fixture-serial','jinuo','2','1','--commander','fixture-escort','--tag','cecelia-cli-smoke'];
      const child=spawn('/bin/zsh',args,{env:f.env,detached:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
      const cancel=options.mode==='cancel'&&setInterval(()=>{const tsv=join(f.home,'night-cecelia-cli-smoke.tsv');if(existsSync(tsv)&&/^LEAD\t/m.test(readFileSync(tsv,'utf8'))){clearInterval(cancel);const delivered=child.kill('SIGTERM');writeFileSync(join(f.home,'term-issued'),delivered?'SIGTERM':'SIGTERM_NOT_DELIVERED');}},5);
      const timer=setTimeout(()=>{process.kill(-child.pid,'SIGKILL');clearInterval(cancel);reject(Error('old chain timeout')); },90000);
      child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
      child.on('error',error=>{clearTimeout(timer);clearInterval(cancel);reject(error);});child.on('close',(code,signal)=>{clearTimeout(timer);clearInterval(cancel);done({code,signal,stdout,stderr});});
    });
    assert.equal(f.errors.length,0,f.errors.map(e=>e.stack).join('\n'));
    const log=readFileSync(join(f.home,'night-cecelia-cli-smoke.log'),'utf8');
    const ledger=JSON.parse(readFileSync(ledgerPath(f.home),'utf8'));
    const artifacts=readdirSync(join(f.home,'wfr/workflow-runs')).filter(n=>n.endsWith('.worker-result.json')).map(n=>JSON.parse(readFileSync(join(f.home,'wfr/workflow-runs',n),'utf8')));
    return {output,log,ledger,artifacts,final:output.stdout.match(/WFR_FINALIZE_FINAL=(\w+)/)?.[1]||readFileSync(join(f.home,'harvest-cron.log'),'utf8').match(/账本finalize:.*final=(\w+)/)?.[1]};
  };
  f.read=name=>JSON.parse(readFileSync(join(f.home,name),'utf8'));
  f.businessRows=store=>[...store.values()].map(row=>({record_id:row.record_id,fields:row.fields}));
  return f;
}
