import test from 'node:test';
import assert from 'node:assert/strict';
import { claimStandaloneCollectionVideo } from '../standalone-collection-tools.mjs';

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
const request = { op:'collect_claim', line, run, source_run:null, committed_origin_run:origin, limit:1 };

function fixture({existing=[],selection=[video]}={}) {
  const calls=[];
  const client={
    async query(sql,args) {
      calls.push({sql,args});
      if(sql.includes('FROM zenithjoy.company_config_runs')) {
        return {rows:[{company_id:scope.company.company_id,tenant_id:scope.company.tenant_id,version:34,run_id:run,
          source_run:null,snapshot:{...scope.company,config_status:'enabled',runtime_config:{routing:{line_key:line}}}}]};
      }
      if(sql.includes('UPDATE zenithjoy.leadgen_videos')) return {rows:selection};
      if(sql.includes('FROM zenithjoy.leadgen_videos')) return {rows:existing};
      return {rows:[]};
    },
    release() { calls.push({sql:'release'}); },
  };
  return {calls,pool:{connect:async()=>client}};
}

test('102 原 101 批次和公司在认领事务内绑定，同一次仅认领一条',async()=>{
  const {pool,calls}=fixture();
  assert.deepEqual(await claimStandaloneCollectionVideo(pool,request,scope),{
    source_run:origin,video:{video_id:videoId,video_url:video.video_url,title:video.title,judgment_status:'pending'},
  });
  const write=calls.find(call=>call.sql.includes('UPDATE zenithjoy.leadgen_videos'));
  assert.ok(write.sql.includes('harvest_batch=$2')&&write.sql.includes('FOR UPDATE SKIP LOCKED'));
  assert.deepEqual(write.args.slice(0,5),[line,origin,scope.company.company_id,scope.company.tenant_id,'34']);
  assert.deepEqual(calls.slice(-2).map(call=>call.sql),['COMMIT','release']);
});

test('102 丢失回执后只读同一认领，不用另一条补偿，拒绝改来源',async()=>{
  const {pool,calls}=fixture({existing:[video]});
  await assert.rejects(claimStandaloneCollectionVideo(pool,{...request,committed_origin_run:'another-batch'},scope),/STANDALONE_COLLECTION_ORIGIN/);
  assert.equal(calls.length,0);
  const result=await claimStandaloneCollectionVideo(pool,request,scope);
  assert.equal(result.video.video_id,videoId);
  assert.equal(calls.some(call=>call.sql.includes('UPDATE zenithjoy.leadgen_videos')),false);
});

test('102 未确认账号不领单，打开及录制只允许原批次实际领到的视频',async()=>{
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const effects=[];
  const tools=createStandaloneCollectionTools({
    scope:{...scope,profile:'bound-phone',serial:'fixture-phone',expected_account:'bound-account'},
    assertAuthority:async()=>{},
    async phone({command,args}) {
      effects.push({command,args});
      return {stdout:command==='account-current'?'douyin_id=bound-account\n':command==='current-video-link'?(`content_type=video\nvideo_id=${videoId}\n`):''};
    },
    async rpc({request}) {
      effects.push({op:request.op});
      const binding={company_id:scope.company.company_id,tenant_id:scope.company.tenant_id,version:34,profile:'bound-phone',
        device_serial:'fixture-phone',douyin_id:'bound-account',verification_status:'verified',enabled:true};
      return {ok:true,result:request.op==='company_config'?{...scope.company,run_id:run,device_binding:binding}:{source_run:origin,video}};
    },
  });
  const business=operation=>tools.call('business',{operation});
  const phone=(command,args=[])=>tools.call('phone',{command,args});
  const eid=run+'-open';
  await assert.rejects(business('collect_claim'),/STANDALONE_COLLECTION_ACCOUNT_REQUIRED/);
  await phone('open-app');
  await phone('account-current',[run+'-account']);
  await business('company_config');
  await business('collect_claim');
  await assert.rejects(phone('open-video',['2222222222222222222',eid]),/STANDALONE_COLLECTION_VIDEO_SCOPE/);
  await phone('open-video',[videoId,eid]);
  await assert.rejects(phone('record-start',[run+'-capture',90,videoId]),/STANDALONE_COLLECTION_VIDEO_UNVERIFIED/);
  await phone('current-video-link',[run+'-link']);
  await phone('record-start',[run+'-capture',90,videoId]);
  assert.deepEqual(effects.map(effect=>effect.command??effect.op),[
    'open-app','account-current','company_config','collect_claim','open-video','current-video-link','record-start',
  ]);
});

test('102 只从本轮已停止、带原生播放佐证的音频生成转写',async()=>{
  const {prepareStandaloneCollectionAudio}=await import('../standalone-collection-tools.mjs');
  const {mkdtempSync,realpathSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const root=mkdtempSync(join(realpathSync(tmpdir()),'direct-102-audio-'));
  try {
    const recordingId=run+'-capture',path=join(root,recordingId+'.16k.wav');
    const wav=Buffer.alloc(32044);
    wav.write('RIFF');wav.write('WAVE',8);writeFileSync(path,wav,{mode:0o600});
    const o={evidenceRoot:root,recordingId,
      stoppedOutput:'record_stopped video_streams=1 audio_streams=1 playback_restored=true mean_volume_db=-28 playback_proof_kind=native_audio',
      audioOutput:`audio_extracted path=${path} duration_seconds=1 sample_rate=16000 channels=1`};
    let calls=0;
    const transcribe=async file=>{assert.equal(file,path);calls++;return '本轮录音原文';};
    const data=await prepareStandaloneCollectionAudio({...o,transcribe});
    assert.equal(data.transcript,'本轮录音原文');
    assert.match(data.audio_sha256,/^[a-f0-9]{64}$/);
    await assert.rejects(prepareStandaloneCollectionAudio({...o,stoppedOutput:'record_stopped audio_streams=0',transcribe}),/STANDALONE_COLLECTION_RECORDING_PROOF/);
    await assert.rejects(prepareStandaloneCollectionAudio({...o,audioOutput:o.audioOutput.replace('.16k.wav','-stale.16k.wav'),transcribe}),/STANDALONE_COLLECTION_AUDIO_FILE/);
    assert.equal(calls,1);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('102 资格提交仅接受原转写和冻结政策的真实引用',async()=>{
  const {reviewStandaloneCollectionQuote}=await import('../standalone-collection-tools.mjs');
  const policy='{"policy":{"qualification":"教育内容相关"}}',transcript='这里是教育教程的原转写。';
  const proposal={verdict:'matched',reason:'教学内容符合业务政策',quote:'教育教程',policy_quote:'教育内容相关'};
  assert.deepEqual(reviewStandaloneCollectionQuote(proposal,{policy,transcript}),proposal);
  assert.throws(()=>reviewStandaloneCollectionQuote({...proposal,quote:'猜测的语音'},{policy,transcript}),/STANDALONE_COLLECTION_QUALIFICATION_QUOTE/);
  assert.throws(()=>reviewStandaloneCollectionQuote({...proposal,policy_quote:'其他政策'},{policy,transcript}),/STANDALONE_COLLECTION_QUALIFICATION_QUOTE/);
});

test('102 只在原批次样本达到目标并再次读回后给出成功证据',async()=>{
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const {mkdtempSync,realpathSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createHash}=await import('node:crypto');
  const root=mkdtempSync(join(realpathSync(tmpdir()),'direct-102-handoff-'));
  try {
    const commentId='6415775b-7b37-4c55-bf25-d6bad8ed73a7';
    const recordingId=run+'-capture',path=join(root,recordingId+'.16k.wav');
    const wav=Buffer.alloc(32044);wav.write('RIFF');wav.write('WAVE',8);
    writeFileSync(path,wav,{mode:0o600});
    const present='实际有原转写的内容',policy='{} 教程适用';
    const sha=createHash('sha256').update(policy).digest('hex');
    const expectedScope={...scope,profile:'fixture-profile',serial:'fixture-device',expected_account:'fixture-account',comment_limit:1};
    const device={company_id:scope.company.company_id,tenant_id:scope.company.tenant_id,version:34,profile:expectedScope.profile,
      device_serial:expectedScope.serial,douyin_id:expectedScope.expected_account,verification_status:'verified',enabled:true,run_id:run};
    const comment={douyinId:'commenter',commentBody:'实际正文',profileUrl:'https://v.douyin.com/test/'};
    let collected=false,qualified=false,reads=0,attempts=0;
    const tools=createStandaloneCollectionTools({scope:expectedScope,evidenceRoot:root,transcribe:async()=>present,
      assertAuthority:async()=>{},commentObserver:{
        reset(){},
        async scan(){return {comments:[{index:0}],exhausted:false};},
        async identify(index,v,binding){assert.equal(index,0);assert.equal(v.video_id,videoId);assert.equal(binding.run_id,run);return {comment};},
      },
      async phone({command}){
        const outputs={
          'account-current':'douyin_id=fixture-account',
          'current-video-link':`content_type=video\nvideo_id=${videoId}`,
          'record-stop':'record_stopped audio_streams=1 playback_restored=true mean_volume_db=-20 playback_proof_kind=native_audio',
          'record-extract-audio':`audio_extracted path=${path} duration_seconds=1 sample_rate=16000 channels=1`,
        };
        return {stdout:outputs[command]??''};
      },
      async rpc({request}) {
        const {op}=request;
        let result;
        if(op==='company_config')result={...scope.company,run_id:run,device_binding:device};
        if(op==='collect_claim')result={source_run:origin,video};
        if(op==='qualification_policy')result={video_id:videoId,policy,policy_sha256:sha};
        if(op==='qualification_submit'){
          assert.equal(request.transcript,present);
          qualified=true;result={verified:true,video_id:videoId,verdict:'matched'};
        }
        if(op==='inspect_videos')result=[{...video,judgment_status:qualified?'matched':'pending',
          judgment_config:qualified?{...scope.company,run_id:run}:null}];
        if(op==='collect_partial'){
          attempts++;
          assert.deepEqual(request.comments,[comment]);
          collected=true;
          throw Error('回执丢失');
        }
        if(op==='collect_comment_readback'){
          reads++;
          assert.equal(request.committed_origin_run,origin);
          assert.equal(collected,true);
          result={verified:true,comment_id:commentId,video_id:videoId};
        }
        if(op==='release_video')result={released:true};
        return {ok:true,result};
      },
    });
    const business=(operation,input)=>tools.call('business',{operation,...(input?{input}:{})});
    const phone=(command,args=[])=>tools.call('phone',{command,args});
    await phone('open-app');
    await phone('account-current',[run+'-account']);
    await business('company_config');
    await business('collect_claim');
    await phone('open-video',[videoId,run+'-open']);
    await phone('current-video-link',[run+'-link']);
    await phone('record-start',[recordingId,90,videoId]);
    await phone('record-stop',[recordingId]);
    await phone('record-extract-audio',[recordingId]);
    assert.equal(await tools.readEvidence(),null);
    await assert.rejects(business('scan_comments'),/STANDALONE_COLLECTION_QUALIFICATION_REQUIRED/);
    await business('qualification_input');
    await business('qualification_submit',{verdict:'matched',reason:'符合课程范围',quote:'原转写',policy_quote:'教程适用'});
    await business('qualification_readback');
    await business('scan_comments');
    const {reference}=await business('prepare_comment',{index:0});
    await assert.rejects(business('collect_submit',{reference}),/回执丢失/);
    assert.equal(await tools.readEvidence(),null);
    assert.equal((await business('collect_submit',{reference})).comment_id,commentId);
    assert.deepEqual(await tools.readEvidence(),{source_run:origin,video_id:videoId,video_url:video.video_url,qualification:'matched',
      comment_ids:[commentId],sample_target:1,coverage:'sampled'});
    await tools.releaseOwned();
    assert.equal(await tools.readEvidence(),null);
    assert.equal(attempts,1);
    assert.equal(reads,2);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('102 树等待空闲失败后只准用本轮截图导航一次，重新核对绑定账号后才放行业务', async () => {
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const effects=[];
  const accountModes=[];
  const tools=createStandaloneCollectionTools({
    scope:{...scope,profile:'bound-phone',serial:'fixture-phone',expected_account:'bound-account'},
    assertAuthority:async()=>{},
    async phone({command,args,verifyAccountOnly}) {
      if(command==='account-current')accountModes.push(verifyAccountOnly);
      effects.push(command);
      const stdout=command==='account-current'?(args[0].endsWith('first')?'account_status=visual_required':'douyin_id=bound-account'):'';
      return {stdout};
    },
    async rpc(){throw Error('应在核验后才调用业务接口');},
  });
  const phone=(command,args=[])=>tools.call('phone',{command,args});
  const tap=[648,1173,run+'-screen',run+'-tap'];
  await phone('open-app');
  await assert.rejects(phone('account-visual-tap',tap),/STANDALONE_COLLECTION_/);
  const probe=await phone('account-current',[run+'-first']);
  assert.equal(probe.account_status,'visual_required');
  await assert.rejects(tools.call('business',{operation:'collect_claim'}),/ACCOUNT_REQUIRED/);
  await assert.rejects(phone('account-visual-tap',tap),/STANDALONE_COLLECTION_/);
  await phone('snapshot-evidence',[run+'-screen']);
  await assert.rejects(phone('account-visual-tap',[648,1173,run+'-old',run+'-tap']),/STANDALONE_COLLECTION_/);
  await phone('account-visual-tap',tap);
  await assert.rejects(phone('account-visual-tap',tap),/STANDALONE_COLLECTION_/);
  await phone('account-current',[run+'-second']);
  await assert.rejects(tools.call('business',{operation:'collect_claim'}),/COMPANY_REQUIRED/);
  assert.deepEqual(accountModes,[false,true]);
  assert.deepEqual(effects,['open-app','account-current','snapshot-evidence','account-visual-tap','account-current']);
});

test('102 正式判重工具声明只读交接入口', async()=>{
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const tools=createStandaloneCollectionTools({scope,assertAuthority:async()=>{},activityPlaybook:{}});
  const inspected=await tools.call('inspect',{});
  assert.ok(inspected.business_operations.includes('collect_source_read'));
});

test('102 精确认领错 VID 时事务回滚', async()=>{
  const wrong={...video,video_id:'2222222222222222',video_url:'https://www.douyin.com/video/2222222222222222'};
  const {pool,calls}=fixture({selection:[wrong]});
  await assert.rejects(claimStandaloneCollectionVideo(pool,{...request,video_id:videoId},scope),/STANDALONE_COLLECTION_CLAIM_READBACK/);
  const write=calls.find(call=>call.sql.includes('UPDATE zenithjoy.leadgen_videos'));
  assert.match(write.sql,/video_id\s*=\s*\$8/);
  assert.equal(write.args[7],videoId);
  assert.equal(calls.some(call=>call.sql==='COMMIT'),false);
});

test('102 只读查询绑定原批次、租户和精确 VID，错误来源不查库',async()=>{
  const {readStandaloneCollectionSource}=await import('../standalone-collection-tools.mjs');
  const calls=[];
  const row={video_id:videoId,video_url:video.video_url,evidence_digest:'a'.repeat(64),observed_comment_count:1};
  const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[row]};}};
  const read={...request,op:'collect_source_read',video_id:videoId};
  await assert.rejects(readStandaloneCollectionSource(pool,{...read,committed_origin_run:'other'},scope),/ORIGIN/);
  assert.equal(calls.length,0);
  assert.deepEqual(await readStandaloneCollectionSource(pool,read,scope),{source_run:origin,video:row});
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/^SELECT/);
  assert.doesNotMatch(calls[0].sql,/\b(?:UPDATE|INSERT|DELETE)\b/i);
  assert.deepEqual(calls[0].args,[line,origin,scope.company.company_id,scope.company.tenant_id,'34',videoId]);
});

test('102 已精确认领另一条时不能在同一次运行领取第二条',async()=>{
  const {pool,calls}=fixture({existing:[video]});
  await assert.rejects(claimStandaloneCollectionVideo(pool,{...request,video_id:'2222222222222222'},scope),/CLAIM_READBACK/);
  assert.equal(calls.some(call=>call.sql.includes('UPDATE zenithjoy.leadgen_videos')),false);
});

test('102 正式判重只能补读候选视频，采集写操作仍需认领',async()=>{
  const {createStandaloneCollectionTools}=await import('../standalone-collection-tools.mjs');
  const binding={...scope.company,profile:'bound-phone',device_serial:'fixture-phone',
    douyin_id:'bound-account',verification_status:'verified',enabled:true};
  const actions=[];
  let author='another-company-account',callState='not_idle';
  const tools=createStandaloneCollectionTools({
    scope:{...scope,profile:'bound-phone',serial:'fixture-phone',expected_account:'bound-account'},
    activityPlaybook:{},assertAuthority:async()=>{},
    async readDeviceContext(){return {device:`state=device\ncall_state=${callState}\n`};},
    async readAuthor(id){return {video_id:id,douyin_id:author};},
    async phone({command,args}){
      actions.push(command);
      const stdout=command==='account-current'?'douyin_id=bound-account\n':
        command==='current-video-link'?`content_type=video\nvideo_id=${videoId}\n`:'';
      return {stdout};
    },
    async rpc({request}){
      actions.push(request.op);
      return {ok:true,result:request.op==='company_config'?{...scope.company,run_id:run,device_binding:binding,own_douyin_ids:['bound-account','another-company-account']}:{source_run:origin,video:{...video,evidence_digest:'a'.repeat(64)}}};
    },
  });
  const business=(operation,input)=>tools.call('business',input?{operation,input}:{operation});
  const phone=(command,args=[])=>tools.call('phone',{command,args});
  await phone('open-app');
  await phone('account-current',[run+'-account']);
  await business('company_config');
  await assert.rejects(business('collect_source_read'),/DEVICE_CONTEXT/);
  await assert.rejects(tools.call('inspect',{view:'device_context'}),/DEVICE_CONTEXT/);
  callState='idle';
  assert.match((await tools.call('inspect',{view:'device_context'})).device,/call_state=idle/);
  await assert.rejects(business('collect_claim',{video_id:videoId}),/SOURCE_READ_REQUIRED/);
  await business('collect_source_read');
  await assert.rejects(phone('open-video',['2222222222222222',run+'-other']),/VIDEO_SCOPE/);
  await phone('open-video',[videoId,run+'-open']);
  await phone('current-video-link',[run+'-link']);
  await phone('ui-evidence',[run+'-tree']);
  await assert.rejects(phone('record-start',[run+'-record',90,videoId]),/VIDEO_SCOPE/);
  await assert.rejects(business('collect_claim',{video_id:videoId}),/AUTHOR_UNVERIFIED/);
  assert.equal((await business('collect_author_read')).own_account,true);
  await assert.rejects(business('collect_claim',{video_id:videoId}),/AUTHOR_UNVERIFIED/);
  author='verified-external-author';
  assert.equal((await business('collect_author_read')).own_account,false);
  await business('collect_claim',{video_id:videoId});
  await assert.rejects(phone('record-start',[run+'-record',90,videoId]),/VIDEO_UNVERIFIED/);
  assert.deepEqual(actions,['open-app','account-current','company_config','collect_source_read',
    'open-video','current-video-link','ui-evidence','collect_claim']);
});

test('102 只接受已完成的 101 回执，并从同源同 VID 交付中读作者',async()=>{
  const {readStandaloneProducerHandoff}=await import('../activity-upstream-source.mjs');
  const sourceRun='7493b375-f047-4e1e-8810-fb7529fb2f0a';
  const taskId='3584447e-0b6c-400a-aac9-f3bc9bcd7874';
  const candidate={...video,evidence_digest:'a'.repeat(64),observed_comment_count:1};
  const handoff={...video,author:'原交付作者',line_key:line,
    discovery_metrics:{digest:candidate.evidence_digest,company_binding:{...scope.company,line_key:line,run_id:sourceRun}}};
  const result={task_id:taskId,run_id:sourceRun,status:'completed',business_pass:true,
    receipts:[{activity_key:'collect_videos',status:'completed',outputs:{Video:[handoff]}}]};
  const rec={run_id:sourceRun,links:{task_id:taskId},task_run:{status:'success',task_id:taskId,run_id:sourceRun}};
  const task={id:taskId,status:'completed',payload:{workflow_key:'douyin_video_discovery'},result:{foundation_result:result}};
  const input={sourceRun,line,company:scope.company,candidate,
    read:async path=>path.includes('/reconciliation')?rec:task};
  assert.deepEqual(await readStandaloneProducerHandoff(input),{task_id:taskId,run_id:sourceRun,author:'原交付作者'});
  task.status='blocked';
  await assert.rejects(readStandaloneProducerHandoff(input),/UPSTREAM_SOURCE_RESULT/);
  task.status='completed';
  handoff.discovery_metrics.company_binding.tenant_id='another-tenant';
  await assert.rejects(readStandaloneProducerHandoff(input),/UPSTREAM_SOURCE_VIDEO_EVIDENCE/);
});
