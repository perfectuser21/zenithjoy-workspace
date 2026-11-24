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
