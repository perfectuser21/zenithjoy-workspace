import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScoringHandler} from '../leadgen-scoring-handler.mjs';

const source='accept3a903_jinuo102g_20261030t0712';
const video='7699489394579915663';
const run='accept103_102g_exact_a1';
const decision='11111111-1111-4111-8111-111111111111';
const task='22222222-2222-4222-8222-222222222222';
const candidate='c'.repeat(40);
const ids=['818dc556-0d01-409a-9b08-4d458e4a7bc1','4d1375d8-7ef2-4393-a3ec-c56897f7d045','8d95a060-25a0-4438-a5ad-c5bd91729883'];

test('正式103评分先完成精确接纳及读回，再领取原102g评论',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'leadgen-102g-entry-'));
  try{
    const calls=[],queue=async(op,fields)=>{
      calls.push({op,fields});
      if(op==='company_config')return {};
      if(op==='admit_102g_comments')return {status:'applied',decision_id:decision,video_id:video,comment_ids:ids};
      if(op==='admit_102g_readback')return {status:'already_applied',decision_id:decision,video_id:video,comment_ids:ids};
      if(op==='score_scope')throw Error('STOP_AFTER_SCOPE');
      throw Error('unexpected '+op);
    };
    const env={WFR_RUN_DIR:dir,LEADGEN_SOURCE_RUN:source,LEADGEN_LIMIT:'3',
      LEADGEN_102G_ADMISSION_DECISION_ID:decision,LEADGEN_102G_ADMISSION_TASK_ID:task,
      LEADGEN_SEND:'0'};
    await assert.rejects(createScoringHandler({env,run,line:'jinuo',state:{source_commit:candidate},queue})(),/STOP_AFTER_SCOPE/);
    assert.deepEqual(calls.map(v=>v.op),['company_config','admit_102g_comments','admit_102g_readback','score_scope']);
    assert.deepEqual(calls[1].fields,{decision_id:decision,maintenance_task_id:task,video_id:video,candidate_source_commit:candidate});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('102g正式入口缺精确授权字段时在领取前拒绝',async()=>{
  const calls=[],env={WFR_RUN_DIR:'/tmp',LEADGEN_SOURCE_RUN:source,LEADGEN_LIMIT:'3',LEADGEN_SEND:'0'};
  const queue=async op=>{calls.push(op);return {};};
  await assert.rejects(createScoringHandler({env,run,line:'jinuo',state:{},queue})(),/ADMISSION_/);
  assert.deepEqual(calls,[]);
});

test('102g评分入口显式发送私信标志时在任何队列调用前拒绝',async()=>{
  const calls=[],env={WFR_RUN_DIR:'/tmp',LEADGEN_SOURCE_RUN:source,LEADGEN_LIMIT:'3',LEADGEN_SEND:'1',
    LEADGEN_102G_ADMISSION_DECISION_ID:decision,LEADGEN_102G_ADMISSION_TASK_ID:task};
  await assert.rejects(createScoringHandler({env,run,line:'jinuo',state:{},queue:async op=>{calls.push(op);return {};}})(),/ADMISSION_RUN_SCOPE_INVALID/);
  assert.deepEqual(calls,[]);
});
