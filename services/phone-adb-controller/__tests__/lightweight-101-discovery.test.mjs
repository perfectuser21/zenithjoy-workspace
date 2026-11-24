import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {metricPhoneReceipt} from './helpers/discovery-metrics-fixture.mjs';
import {runLightweightDiscovery101} from '../leadgen-foundation/lightweight-101-discovery.mjs';
import {generateLightweight101Profile} from '../leadgen-foundation/lightweight-101-release.mjs';

test('轻量 101 生成单独候选配置并固定 Code worker 的依赖闭包',()=>{
  const profile=generateLightweight101Profile();
  assert.equal(profile.profile.leadgen.discovery_variant,'lightweight-host-script-v1');
  assert.deepEqual(profile.contract.activities.map(activity=>activity.runtime.executor_kind),['agent','agent','agent']);
  assert.ok(profile.profile.skill_runtime.host_tools.kinds.includes('light101-discover'));
  for(const name of ['leadgen-discovery.mjs','discovery-metrics.js','leadgen-foundation/lightweight-101-worker.mjs']){
    assert.match(profile.profile.files['services/phone-adb-controller/'+name],/^[a-f0-9]{64}$/);
  }
  assert.ok(Object.keys(profile.profile.files).length<=200);
});

for(const mode of ['capture','complete','missing'])test('101 复用现场取链并独立读回，证据模式 '+mode, async t => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'lightweight-101-')));
  t.after(() => rmSync(workDir, {recursive: true, force: true}));
  const runTag = 'cfc6365c-81ed-4c38-b33d-c1eb2b21ab3a';
  const identity = {run_id: runTag, run_tag: runTag, task_id: 'brain-task'};
  const context = {
    assigned_workflow: '101', tasks: {'101': identity}, run_tag: runTag,
    profile: 'device-profile', serial: 'physical-id', adb_serial: '127.0.0.1:15555',
    source_commit: 'a'.repeat(40), line: 'jinuo', native_root: join(workDir,'remote'),
    business_deadline_ms: Date.now() + 60000,
    keyword: 'AI', max_candidates: 1,
    search_filters: {sort: 'latest',time_layer: 'six_months',duration: 'under_one_minute',scope: 'unlimited',location: 'same_city'},
  };
  const hostRoot=mode==='capture'?undefined:workDir;
  for(const dir of ['native','remote','receipts'])mkdirSync(join(workDir,dir));
  const nativeFile=(suffix)=>{
    const file=join(context.native_root,runTag+'-'+suffix);
    writeFileSync(file,'fixture');
    return file;
  };
  const videoId = '7685662999797258401', events = [];
  let persisted;
  const invoke = async (kind, name, args) => {
    assert.match(name, /^light101-/);
    const result = {exit_code: 0, stdout: ''};
    if (kind === 'phone') {
      const [command, evidenceId] = args;
      events.push(command);
      if (command === 'search-time-layer') {
        assert.equal(args[4], 'under_one_minute');
        result.stdout = 'sort=latest\ntime_layer=six_months\nduration=under_one_minute\nscope=unlimited\nlocation=same_city\n';
        result.stdout += 'selected_evidence='+nativeFile('selected.png')+'\n';
        if(mode!=='missing')result.stdout += 'results_evidence='+nativeFile('results.png')+'\n';
      }
      if (command === 'search-video-tab') result.stdout = 'evidence='+nativeFile('video-tab.xml')+'\n';
      if (command === 'search-video-cards') result.stdout = '100\t200\t00:20\t视频标题\t视频作者\nvideo_tab=1\nevidence='+nativeFile('cards.xml')+'\n';
      if (command === 'search-kw-matches') result.stdout = 'kw_matches=1\n';
      if (command === 'current-video-link') result.stdout = metricPhoneReceipt(
        `content_type=video\nvideo_id=${videoId}\nshort_url=https://v.douyin.com/demo/\nreturn_mode=results\n`, evidenceId, context.native_root);
    } else if (kind === 'business') {
      const {op,video} = JSON.parse(args[0]);
      events.push(op);
      if (op === 'discover') persisted = video;
      if(op==='discover_readback'){
        assert.equal(op, 'discover_readback');
        assert.deepEqual(video, persisted);
      }
      result.stdout = JSON.stringify({ok:true,result:op==='inspect_videos'?[]:{status:'pending',inserted:true,
        metrics_verified:true,metrics_digest:video.metrics.digest,
        ...(op==='discover_readback'?{handoff:{video_id:video.videoId,video_url:video.videoUrl,
          title:video.title,keyword:video.keyword,line_key:context.line,comment_count:4,harvest_batch:runTag,
          discovery_metrics:video.metrics}}:{})}});
    } else if(kind==='fetch-native'){
      const [file]=args,path=join(hostRoot,'native',file);
      copyFileSync(join(context.native_root,file),path);
      result.data={path,remote_name:file,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
    } else assert.fail(kind);
    const receipt={state:'terminal',binding:{identity,activity:'collect_videos',kind,args},result};
    writeFileSync(join(workDir,'receipts',name+'.json'),JSON.stringify(receipt));
    return receipt;
  };
  const result = await runLightweightDiscovery101({context,workDir,invoke,hostRoot,pause:async () => {}});
  assert.deepEqual(result.videos.map(video => video.videoId), [videoId], JSON.stringify(result.failures));
  if(mode==='missing'){
    assert.equal(result.evidence_error,'LIGHT101_EVIDENCE_SCOPE');
    assert.equal(result.delivery_evidence,undefined);
    assert.equal(events.filter(event=>event==='discover').length,1);
  }else{
    assert.equal(result.handoffs[0].author,'视频作者');
    if(mode==='capture')assert.deepEqual(events.slice(-3), ['current-video-link','discover','discover_readback']);
    else{
      assert.deepEqual(events.slice(-4),['inspect_videos','discover','discover_readback','inspect_videos']);
      assert.ok(result.delivery_evidence.run.selected_page.endsWith('-selected.png'));
      assert.ok(result.delivery_evidence[videoId].share_xml.endsWith('-share.xml'));
      assert.match(result.delivery_evidence[videoId].prior_state,/^receipts\//);
      const contract=generateLightweight101Profile().contract.activities.find(activity=>activity.key==='collect_videos');
      const validate=new Ajv({strict:true}).compile(contract.acceptance.document.delivery.schema);
      assert.ok(validate({outputs:{Video:result.handoffs,Run:{status:result.status,
        stop_reason:result.stop_reason,all_results_scanned:result.all_results_scanned}},evidence:result.delivery_evidence}),
      JSON.stringify(validate.errors));
    }
  }
});

for(const mode of ['worker','tool'])test('101 使用冻结上下文启动 typed host 工具 '+mode, t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lightweight-worker-')));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const host = join(root,'host');
  mkdirSync(host);
  const runTag = 'cfc6365c-81ed-4c38-b33d-c1eb2b21ab3a';
  const identity = {run_id:runTag,run_tag:runTag,task_id:'brain-task'};
  const context = {
    assigned_workflow:'101',tasks:{'101':identity},run_tag:runTag,
    profile:'fixture-device',serial:'hardware-id',adb_serial:'127.0.0.1:15555',
    source_commit:'a'.repeat(40),line:'jinuo',native_root:host,
    business_deadline_ms:Date.now()+60000,keyword:'AI',max_candidates:1,
    search_filters:{sort:'latest',time_layer:'six_months',duration:'unlimited',scope:'unlimited',location:'same_city'},
  };
  writeFileSync(join(host,'context.json'),JSON.stringify(context));
  writeFileSync(join(host,'invoke.mjs'),`
    import fs from 'node:fs';
    const [kind,name,...args]=process.argv.slice(2);
    const {identity,activity_key:activity}=JSON.parse(fs.readFileSync(process.env.COMMANDER_ACTIVITY_INPUT_FILE));
    if(kind!=='phone'||activity!=='collect_videos'||args[0]!=='open-search'||identity.task_id!=='brain-task')process.exit(2);
    console.log(JSON.stringify({state:'terminal',binding:{identity,activity,kind,args},result:{exit_code:1,stdout:''}}));
    process.exitCode=1;
  `);
  const worker = new URL('../leadgen-foundation/lightweight-101-worker.mjs',import.meta.url);
  const action_id='b'.repeat(64);
  const agentInput=join(root,'agent-input.json');
  const activity='collect_videos';
  writeFileSync(agentInput,JSON.stringify({activity_key:activity,identity:{...identity,action_id,activity_key:activity}}));
  const options={encoding:'utf8',input:JSON.stringify({run_tag:runTag,task_id:identity.task_id,action_id}),
    env:{...process.env,COMMANDER_ACTIVITY_KEY:activity,COMMANDER_ACTIVITY_INPUT_FILE:agentInput}};
  const args=mode==='worker'?[fileURLToPath(worker),host]:[
    '--input-type=module','-e',
    `import {runLightweight101HostTool} from ${JSON.stringify(worker.href)};
    console.log(JSON.stringify(await runLightweight101HostTool(process.argv[1],['light101'])));`,host,
  ];
  const result = spawnSync(process.execPath,args,options);
  assert.equal(result.status,0,result.stderr);
  const wire=JSON.parse(result.stdout);
  const data=mode==='worker'?wire:wire.result.data;
  if(mode==='tool'){
    assert.equal(wire.result.exit_code,2);
    const second=spawnSync(process.execPath,args,options);
    assert.notEqual(second.status,0);
    assert.match(second.stderr,/EEXIST/);
  }
  assert.deepEqual(data.outputs.Run,{status:'failed',stop_reason:'source_failed',all_results_scanned:false});
});
