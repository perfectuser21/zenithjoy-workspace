import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {publishNativeFile} from '../standalone-native-evidence.mjs';
import {
  createStandaloneQualificationPreparation,reviewStandalonePreparedDecision,standaloneQualificationDecisionId,
} from '../standalone-qualification-preparation.mjs';
import {recordStandaloneCollectionQualification} from '../standalone-collection-tools.mjs';

const require=createRequire(import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');

test('正式资格在隔离 PostgreSQL 实际提交并读回，同一动作重放不二次写入',{
  skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1',
},async t=>{
  const {Pool}=require('pg'),pool=new Pool();
  const runDirectory=mkdtempSync(join(realpathSync(tmpdir()),'qualification-pg-fixture-'));
  const schema='qualification_test_'+randomUUID().replaceAll('-','');
  let created=false;
  t.after(async()=>{
    try {if(created)await pool.query('DROP SCHEMA '+schema+' CASCADE');}
    finally {await pool.end();rmSync(runDirectory,{recursive:true,force:true});}
  });
  assert.match((await pool.query('SELECT current_database() AS db')).rows[0].db,/(?:^|_)scratch$/);
  await pool.query('CREATE SCHEMA '+schema);
  created=true;
  const sql=text=>text.replaceAll('zenithjoy.',schema+'.');
  const query=(text,args)=>pool.query(sql(text),args);
  const scoped={connect:async()=>{
    const client=await pool.connect();
    return {query:(text,args)=>client.query(sql(text),args),release:()=>client.release()};
  }};
  const run='test-102',origin='test-101',line='yuesheng',videoId='1234567890123456789';
  const company={company_id:randomUUID(),tenant_id:randomUUID(),policy_id:'test',version:1};
  const snapshot={...company,config_status:'enabled',wiki:{products:[{id:'p'}],audiences:['a']},
    runtime_config:{routing:{line_key:line},video_judgment:{scope:'教学'}}};
  const policy=require('../company-config-lib.js').configTargetProfile(snapshot,'102');
  await query('CREATE TABLE zenithjoy.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,source_run text,snapshot jsonb)');
  await query('CREATE TABLE zenithjoy.leadgen_videos(id uuid default gen_random_uuid(),video_id text,video_url text,title text,line_key text,discovery_metrics jsonb,harvest_batch text,process_status text,judgment_status text,judgment_reason text,judgment_config jsonb,transcript text,updated_at timestamptz)');
  await query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,$3,$4,NULL,$5)',
    [company.company_id,company.tenant_id,company.version,run,JSON.stringify(snapshot)]);
  await query('INSERT INTO zenithjoy.leadgen_videos(video_id,video_url,line_key,discovery_metrics,harvest_batch,process_status,judgment_status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [videoId,'https://www.douyin.com/video/'+videoId,line,JSON.stringify({company_binding:{...company,run_id:origin,line_key:line}}),run,'处理中:'+run,'pending']);

  const runIdentity={task_id:randomUUID(),run_id:randomUUID(),run_tag:run,workflow:'102'};
  const audio=join(runDirectory,'sample.wav');
  const proof=publishNativeFile(runDirectory,'qualification-proof.json',Buffer.from('{}'));
  const prepare=createStandaloneQualificationPreparation({runDirectory,runIdentity,
    verifyProof:async()=>({audio_sha256:'b'.repeat(64),duration_seconds:20,
      visual:{sha256:'c'.repeat(64),frames:[{label:'A',text:'测试材料'}]}}),
    getPolicy:async()=>({video_id:videoId,policy,policy_sha256:sha(policy)}),
    transcribe:async()=>({text:'测试转写',receipt:{request_id:'test-asr'}}),
  });
  const prepared=await prepare({args:[videoId,audio],action_name:'prepare'},proof,videoId);
  const proposal={dossier_sha256:prepared.dossier_sha256,preparation_action_name:'prepare',
    verdict:'matched',reason:'符合资格',transcript_quote:'测试转写',frame_labels:['A']};
  const preparationSha=prepared.preparation_receipt.sha256;
  const reviewed=reviewStandalonePreparedDecision({runDirectory,runIdentity,videoId,audio,preparationSha,proposal});
  const authority={workflow_key:'douyin_video_processing',line,run_tag:run,source_run:origin,limit:1,company,
    qualification_authority:{runDirectory,runIdentity}};
  const request={op:'qualification_submit',line,run,source_run:null,limit:1,committed_origin_run:origin,
    video_id:videoId,proposal,audio_path:audio,preparation_sha256:preparationSha,submission_action_name:'submit',
    decision_sha256:standaloneQualificationDecisionId(reviewed,'submit')};

  await assert.rejects(recordStandaloneCollectionQualification(scoped,{...request,decision_sha256:'x'},authority),
    {code:'STANDALONE_COLLECTION_SUBMIT_EVIDENCE'});
  assert.equal((await recordStandaloneCollectionQualification(scoped,request,authority)).verified,true);
  const read=async()=>(await query('SELECT judgment_status,judgment_reason,transcript,judgment_config,updated_at FROM zenithjoy.leadgen_videos')).rows[0];
  const result=await read();
  assert.equal(result.transcript,'测试转写');
  assert.equal(result.judgment_status,'matched');
  assert.equal(result.judgment_config.qualification_agent.decision_sha256,request.decision_sha256);
  assert.equal((await recordStandaloneCollectionQualification(scoped,request,authority)).verified,true);
  assert.deepEqual(await read(),result);
});
