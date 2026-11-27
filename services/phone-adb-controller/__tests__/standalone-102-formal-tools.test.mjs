import test from 'node:test';
import assert from 'node:assert/strict';

const run = '102-direct';
const origin = '101-receipt';
const line = 'yuesheng';
const videoId = '1234567890123456789';
const video = {
  video_id:videoId, video_url:'https://www.douyin.com/video/'+videoId, title:'实际视频',
  judgment_status:'pending', process_status:'处理中:'+run, harvest_batch:run,
};
const scope = {
  workflow_key:'douyin_video_processing', run_tag:run, source_run:origin, line, limit:1,
  company:{company_id:'bf6a2801-dc22-4610-919a-f46f976cf116',tenant_id:'5eaa5795-3c90-48dc-a11e-4d50b763ceb2',version:34,policy_id:'current'},
};

test('正式 102 五个 Activity 契约要求的工具可通过同一轻盈 IPC 连接访问',async t=>{
  const {mkdtempSync,readFileSync,realpathSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const {callStandaloneSkillTool,serveStandaloneSkillTools}=await import('../standalone-skill-ipc.mjs');
  const frozen=JSON.parse(readFileSync(new URL('../leadgen-foundation/profiles/102.json',import.meta.url)));
  const activities=frozen.contract.activities;
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'standalone-102-qualification-ipc-'));
  const tools=createStandaloneCollectionTools({
    scope,activityPlaybook:{},runDirectory:directory,
    runIdentity:{task_id:"fixture-task",run_id:"fixture-run",run_tag:run,workflow:"102"},
    verifyQualificationProof:()=>assert.fail("读取工具清单不能执行证明"),
    readCentralLease:()=>assert.fail("读取工具清单不能查询租约"),readDeviceContext:()=>assert.fail("读取工具清单不能碰设备"),
    commentObserver:{},assertAuthority:async()=>{},
    phone:()=>assert.fail('检查工具清单不能碰设备'),
    rpc:()=>assert.fail('检查工具清单不能碰数据库'),
  });
  const ipc=await serveStandaloneSkillTools({directory,call:tools.call});
  t.after(async()=>{await ipc.close();rmSync(directory,{force:true,recursive:true});});
  const {result}=await callStandaloneSkillTool(ipc.connectionPath,'inspect',{});
  const available=new Set(['phone','business',...(result.activity_tools??[])]);
  const missing=activities.flatMap(a=>a.acceptance.document.required_host_tools.filter(tool=>!available.has(tool)).map(tool=>a.key+':'+tool));
  assert.deepEqual(missing,[],`正式 102 缺工具 ${missing.join(', ')}`);
});

test('轻盈 102 在同一个真实 IPC 连接读取本次手机原件',async t=>{
  const {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,utimesSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const {callStandaloneSkillTool,serveStandaloneSkillTools}=await import('../standalone-skill-ipc.mjs');
  const root=mkdtempSync(join(realpathSync(tmpdir()),'standalone-102-native-e2e-'));
  const evidenceRoot=join(root,'evidence'),runDirectory=join(root,'run'),directory=join(root,'ipc');
  for(const path of [evidenceRoot,runDirectory,directory])mkdirSync(path,{mode:0o700});
  const eid=run+'-account',source=join(evidenceRoot,eid+'.xml');
  const xml='<hierarchy><node text="fixture" /></hierarchy>';
  const account='bound-account';
  const tools=createStandaloneCollectionTools({
    scope:{...scope,expected_account:account,run_start_ts:Math.floor(Date.now()/1000)},
    activityPlaybook:{},assertAuthority:async()=>{},evidenceRoot,runDirectory,
    phone:async({command,args})=>{
      if(command!=='account-current')return {stdout:'open_app=app_foreground'};
      assert.deepEqual(args,[eid]);
      writeFileSync(source,xml,{mode:0o600,flag:'wx'});
      return {stdout:'douyin_id='+account};
    },
  });
  const ipc=await serveStandaloneSkillTools({directory,call:tools.call});
  t.after(async()=>{await ipc.close();rmSync(root,{force:true,recursive:true});});
  const call=(name,body)=>callStandaloneSkillTool(ipc.connectionPath,name,body);
  await call('phone',{command:'open-app',args:[]});
  await call('phone',{command:'account-current',args:[eid]});
  const file=eid+'.xml',stale=eid+'-stale.xml';
  writeFileSync(join(evidenceRoot,stale),xml,{mode:0o600});
  utimesSync(join(evidenceRoot,stale),1,1);
  const {result}=await call('fetch-native',{args:[file]});
  assert.equal(result.path,'native/'+file);
  assert.equal(readFileSync(join(runDirectory,result.path),'utf8'),xml);
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await call('fetch-native',{args:[file]})).result.sha256,result.sha256);
  symlinkSync(source,join(evidenceRoot,eid+'-linked.xml'));
  for(const invalid of ['../'+file,run+'-never-issued.xml',eid+'-linked.xml',stale]){
    await assert.rejects(call('fetch-native',{args:[invalid]}),{code:'STANDALONE_COLLECTION_NATIVE_FILE_SCOPE'});
  }
  writeFileSync(source,'<changed/>');
  await assert.rejects(call('fetch-native',{args:[file]}),{code:'STANDALONE_COLLECTION_NATIVE_FILE_SCOPE'});
  assert.equal(readFileSync(join(runDirectory,result.path),'utf8'),xml);
});

test('正式 102 资格保留同轮原生链接、录制和提取的真实 IPC 回执并交付 proof',async t=>{
  const {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createHash}=await import('node:crypto');
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const {callStandaloneSkillTool,serveStandaloneSkillTools}=await import('../standalone-skill-ipc.mjs');
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'standalone-102-receipts-'));
  const profile='fixture-phone',serial='physical-phone',account='fixture-account';
  const toolScope={...scope,comment_limit:1,profile,serial,expected_account:account,run_start_ts:Math.floor(Date.now()/1000)};
  const issued=[],references={},writes=[],evidenceRoot=join(directory,'originals'),eid=run+'-record';
  mkdirSync(evidenceRoot,{mode:0o700});
  const runIdentity={task_id:'fixture-task',run_id:'fixture-run',run_tag:run,workflow:'102'};
  let persisted,commentWritten=false,deviceReads=0;
  const commentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const comment={nickname:'测试昵称',douyinId:'fixture-id',commentBody:'样本评论',profileUrl:'https://v.douyin.com/fixture/'};

  const tools=createStandaloneCollectionTools({
    scope:toolScope,activityPlaybook:{},evidenceRoot,runIdentity,runDirectory:directory,assertAuthority:async()=>{},
    readCentralLease:async()=>({device_name:serial,locked_by:runIdentity.task_id,lease_version:3}),
    readDeviceContext:async()=>{deviceReads++;return {device:'state=device\ncall_state=idle\n',local_owner:run};},
    commentObserver:{reset(){},scan:async()=>({comments:[{index:0,nickname:comment.nickname,body:comment.commentBody}]}),
      identify:async index=>{assert.equal(index,0);return {comment,originals:{receipt:'test-native'}};}},
    verifyQualificationProof:async()=>({audio_sha256:'b'.repeat(64),duration_seconds:20,
      visual:{sha256:'c'.repeat(64),frames:[{label:'A',text:'测试观察'}]}}),
    transcribe:async()=>({text:'真实口播',receipt:{request_id:'fixture-asr'}}),
    async rpc({request}) {
      if(request.op==='qualification_policy'){
        const policy='{"scope":"fixture"}';
        return {ok:true,result:{video_id:videoId,policy,policy_sha256:createHash('sha256').update(policy).digest('hex')}};
      }
      if(request.op==='qualification_submit'){
        writes.push(request);
        persisted={...video,judgment_status:request.proposal.verdict,
          judgment_config:{...scope.company,run_id:run,qualification_agent:{
            preparation_sha256:request.preparation_sha256,decision_sha256:request.decision_sha256,
          }}};
        throw Error('fixture response lost');
      }
      if(request.op==='collect_partial'){
        assert.deepEqual(request.comments,[comment]);
        commentWritten=true;return {ok:true,result:{video_id:videoId,coverage:1}};
      }
      if(request.op==='collect_comment_readback'){
        assert.ok(commentWritten);assert.equal(request.douyin_id,comment.douyinId);
        return {ok:true,result:{verified:true,comment_id:commentId,video_id:videoId}};
      }
      if(request.op==='release_video')return {ok:true,result:{released:true}};
      if(request.op==='inspect_videos')return {ok:true,result:[persisted??video]};
      if(request.op==='company_config')return {ok:true,result:{...scope.company,run_id:run,
        device_binding:{...scope.company,profile,device_serial:serial,douyin_id:account,verification_status:'verified',enabled:true}}};
      assert.ok(['collect_source_read','collect_claim'].includes(request.op));
      return {ok:true,result:{source_run:origin,video}};
    },
    async phone({command,args}) {
      const stdout=command==='account-current'?'douyin_id='+account:command==='current-video-link'?
        `content_type=video\nvideo_id=${videoId}\ncontent_id=${videoId}\nresolved_url=https://www.douyin.com/video/${videoId}`:'native '+command;
      if(command==='record-stop'){
        writeFileSync(join(evidenceRoot,eid+'.rec.mkv'),'test MKV bytes',{mode:0o600});
        writeFileSync(join(evidenceRoot,eid+'.capture-sdk.txt'),'33',{mode:0o600});
      }
      if(command==='record-extract-audio')writeFileSync(join(evidenceRoot,eid+'.16k.wav'),'test WAV bytes',{mode:0o600});
      const receipt={code:0,stdout,stderr:''};
      issued.push({command,args,receipt});
      return receipt;
    },
  });
  const ipc=await serveStandaloneSkillTools({directory,call:tools.call});
  t.after(async()=>{await ipc.close();rmSync(directory,{force:true,recursive:true});});
  const call=async(kind,input)=>(await callStandaloneSkillTool(ipc.connectionPath,kind,input)).result;
  const phone=(command,args=[])=>call('phone',{command,args});
  await assert.rejects(call('brain',{args:['device-locks/release']}),{code:'STANDALONE_COLLECTION_BRAIN_READ_SCOPE'});
  assert.equal((await call('brain',{args:['device-locks']})).locks[0].locked_by,runIdentity.task_id);
  await call('inspect',{view:'device_context'});
  const context=await call('native-readback',{args:[]});
  assert.equal(context.release_owner,'standalone-host');
  assert.equal(JSON.parse(readFileSync(join(directory,context.receipt.path))).identity.run_id,runIdentity.run_id);
  assert.equal(deviceReads,1);
  await phone('open-app');
  await phone('account-current',[run+'-account']);
  await call('business',{operation:'company_config'});
  await call('business',{operation:'collect_source_read'});
  await call('business',{operation:'collect_claim',input:{video_id:videoId}});
  await phone('open-video',[videoId,run+'-open']);
  for(const [command,args] of [['current-video-link',[run+'-link']],['record-start',[eid,60,videoId]],
    ['record-stop',[eid]],['record-extract-audio',[eid]]]){
    const output=await phone(command,args);
    const reference=output.native_receipt;
    assert.ok(reference,`缺少 ${command} 的宿主回执`);
    assert.match(reference.path,/^native\//);
    references[command]={...reference,path:join(directory,reference.path)};
    const raw=readFileSync(join(directory,reference.path));
    assert.equal(createHash('sha256').update(raw).digest('hex'),reference.sha256);
    assert.deepEqual(JSON.parse(raw),{args:[command,...args.map(String)],exit_code:0,stdout:issued.at(-1).receipt.stdout});
    if(command==='current-video-link'){
      const verifier=fileURLToPath(new URL('../qualification-artifacts.py',import.meta.url));
      const checked=spawnSync('python3',['-B','-c',[
        'import json, runpy, sys',
        'verify = runpy.run_path(sys.argv[1])["native_video_identity"]',
        'spec = json.load(sys.stdin)',
        'assert verify(spec) is True',
        'assert verify(dict(spec, video_id="9999999999999999")) is False',
      ].join('\n'),verifier],{input:JSON.stringify({video_id:videoId,expected_run:run,
        video_identity:{...reference,path:join(directory,reference.path)}}),encoding:'utf8'});
      assert.equal(checked.status,0,checked.stderr);
    }
  }
  const evidence={qualification_evidence:{[videoId]:{video_id:videoId,expected_run:run,evidence_id:eid,
    video_identity:references['current-video-link'],start:references['record-start'],
    stop:references['record-stop'],extraction:references['record-extract-audio']}}};
  const submit=value=>call('proof',{args:[JSON.stringify(value)]});
  await assert.rejects(submit(evidence),{code:'STANDALONE_COLLECTION_PROOF_MEDIA_MISSING'});
  mkdirSync(join(directory,'receipts'),{mode:0o700});
  function asset(relative,bytes) {
    const path=join(directory,relative);
    writeFileSync(path,bytes,{mode:0o600});
    return {path,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const fetch=async name=>{
    const reference=await call('fetch-native',{args:[name]});
    return {...reference,path:join(directory,reference.path)};
  };
  Object.assign(evidence.qualification_evidence[videoId],{
    wav:await fetch(eid+'.16k.wav'),
    recording:await fetch(eid+'.rec.mkv'),
    sidecars:{[eid+'.capture-sdk.txt']:await fetch(eid+'.capture-sdk.txt')},
    coverage_json:asset('receipts/coverage.json','{}'),
    coverage_image:asset('receipts/coverage.jpg','test JPG bytes'),
    visual_observations:[{label:'A',text:'测试观察'}],
  });
  const wrong=structuredClone(evidence);
  wrong.qualification_evidence[videoId].start.sha256='0'.repeat(64);
  await assert.rejects(submit(wrong),{code:'STANDALONE_COLLECTION_PROOF_RECEIPT_MISMATCH'});
  const unrelated=structuredClone(evidence);
  unrelated.qualification_evidence[videoId].sidecars.fake=asset('native/'+eid+'.fake.txt','unissued bytes');
  await assert.rejects(submit(unrelated),{code:'STANDALONE_COLLECTION_PROOF_REFERENCE_MISMATCH'});
  const accepted=await submit(evidence);
  assert.equal(accepted.acceptance_not_asserted,true);
  const raw=readFileSync(join(directory,accepted.proof_manifest.path));
  assert.deepEqual(JSON.parse(raw),{schema:'activity-evidence/v1',identity:runIdentity,...evidence});
  assert.equal(createHash('sha256').update(raw).digest('hex'),accepted.proof_manifest.sha256);
  assert.deepEqual(await submit(evidence),accepted);

  const audio=evidence.qualification_evidence[videoId].wav.path;
  const prepared=await call('qualify-prepare',{args:[videoId,audio],action_name:'prepare-fixture'});
  const proposed={preparation_action_name:prepared.preparation_action_name,dossier_sha256:prepared.dossier_sha256,
    verdict:'matched',reason:'符合范围',frame_labels:['A'],transcript_quote:'真实口播'};
  const submitVote=proposal=>call('qualify-submit',{args:[videoId,audio,JSON.stringify(proposal)],action_name:'submit-fixture'});
  await assert.rejects(submitVote({...proposed,frame_labels:['E']}),{code:'STANDALONE_COLLECTION_SUBMIT_EVIDENCE'});
  assert.equal(writes.length,0);
  const qualification=await submitVote(proposed);
  assert.equal(qualification.verdict,'matched');
  assert.equal(qualification.verified,true);
  assert.equal(writes.length,1);
  assert.deepEqual(await submitVote(proposed),qualification);
  assert.equal(writes.length,1);

  assert.equal((await call('business',{operation:'scan_comments'})).comments.length,1);
  const item=await call('collection-evidence',{args:[JSON.stringify({index:0})]});
  const nativeComment=JSON.parse(readFileSync(join(directory,item.evidence.path)));
  assert.deepEqual(nativeComment.comment,comment);
  assert.equal(nativeComment.identity.task_id,runIdentity.task_id);
  assert.equal((await call('collection-readback',{args:[]})).coverage,'partial');
  await call('business',{operation:'collect_submit',input:{reference:item.reference}});
  const sampled=await call('collection-readback',{args:[]});
  assert.deepEqual(sampled.comment_ids,[commentId]);
  assert.equal(sampled.coverage,'sampled');
  assert.deepEqual((await tools.readEvidence()).comment_ids,[commentId]);
  await tools.releaseOwned();
  assert.equal(await tools.readEvidence(),null);

});

test('102 正式准备只消费同轮 proof，一份材料同一动作只转写一次',async t=>{
  const {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createHash}=await import('node:crypto');
  const {createStandaloneQualificationPreparation,reviewStandalonePreparedDecision}=await import('../standalone-qualification-preparation.mjs');
  const hold=mkdtempSync(join(realpathSync(tmpdir()),'standalone-material-'));
  t.after(()=>rmSync(hold,{recursive:true,force:true}));
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const audio=join(hold,'original.wav'),proof={sha256:sha('fixture proof')};
  mkdirSync(join(hold,'native'),{mode:0o700});
  writeFileSync(join(hold,'native/qualification-proof.json'),'fixture proof',{mode:0o600});
  const identity={task_id:'task',run_id:'run',run_tag:run,workflow:'102'};
  const calls=[];
  const prepare=createStandaloneQualificationPreparation({runDirectory:hold,runIdentity:identity,
    verifyProof:async (candidate,args)=>{
      calls.push('verify');
      assert.equal(candidate,proof);
      assert.deepEqual(args,[videoId,audio]);
      return {audio_sha256:'b'.repeat(64),duration_seconds:21,visual:{frames:[{label:'A',text:'屏幕实物'}]}};
    },
    getPolicy:async id=>{calls.push('policy');return {video_id:id,policy:'{"policy":"教学"}',policy_sha256:sha('{"policy":"教学"}')};},
    transcribe:async path=>{calls.push('asr');assert.equal(path,audio);return {text:'真实口播',receipt:{request_id:'asr-1'}};},
  });
  await assert.rejects(prepare({args:[videoId,audio]},null,videoId),{code:'STANDALONE_COLLECTION_PREPARE_SCOPE'});
  assert.deepEqual(calls,[]);
  const out=await prepare({args:[videoId,audio],action_name:'prepare-original'},proof,videoId);
  assert.equal(out.status,'prepared');
  assert.equal(out.preparation_action_name,'prepare-original');
  const receipt=readFileSync(join(hold,out.preparation_receipt.path));
  assert.equal(sha(receipt),out.preparation_receipt.sha256);
  assert.equal(JSON.parse(receipt).preparation_action_name,'prepare-original');
  assert.deepEqual(JSON.parse(receipt).identity,identity);
  const content=readFileSync(out.dossier_ref.path);
  assert.equal(sha(content),out.dossier_ref.sha256);
  const dossier=JSON.parse(content);
  assert.equal(dossier.scope.video_id,videoId);
  assert.equal(dossier.scope.run_id,identity.run_id);
  assert.equal(dossier.transcript,'真实口播');
  assert.equal(dossier.visual.frames[0].label,'A');
  assert.deepEqual(await prepare({args:[videoId,audio],action_name:'prepare-original'},proof,videoId),out);
  await assert.rejects(prepare({args:[videoId,audio],action_name:'prepare-replay'},proof,videoId),{
    code:'STANDALONE_COLLECTION_PREPARE_CONFLICT',
  });
  assert.deepEqual(calls,['verify','policy','asr']);
  const proposal={dossier_sha256:out.dossier_sha256,preparation_action_name:out.preparation_action_name,
    verdict:'matched',reason:'命中冻结业务政策',transcript_quote:'真实口播',frame_labels:['A']};
  const submission={runDirectory:hold,runIdentity:identity,videoId,audio,preparationSha:out.preparation_receipt.sha256};
  const reviewed=reviewStandalonePreparedDecision({...submission,proposal});
  assert.equal(reviewed.transcript,'真实口播');
  assert.equal(reviewed.provenance.preparation_action_name,'prepare-original');
  for(const candidate of [{...proposal,frame_labels:['D']},{...proposal,transcript_quote:'杜撰短句'},
    {...proposal,preparation_action_name:'other'}]){
    assert.throws(()=>reviewStandalonePreparedDecision({...submission,proposal:candidate}),
      {code:'STANDALONE_COLLECTION_SUBMIT_EVIDENCE'});
  }
  assert.throws(()=>reviewStandalonePreparedDecision({...submission,runIdentity:{...identity,run_id:'foreign'},proposal}),
    {code:'STANDALONE_COLLECTION_SUBMIT_PREPARATION'});
});
