import test from 'node:test';
import assert from 'node:assert/strict';

test('Commander叫停后不执行下一活动，锁内清场仍有前后Commander回执', async () => {
  const {runWorkflow} = await import('../leadgen-workflow.mjs');
  const executed=[],records=[];
  const result=await runWorkflow({activities:['source','dedup','cleanup'].map(key=>({key})),
    context:{run_id:'r'},handlers:Object.fromEntries(['source','dedup','cleanup'].map(k=>[k,async()=>{executed.push(k);return {ok:true};}])),
    commander:async r=>({action:r.activity==='source'&&r.phase==='after'?'finish':'continue',reason:'实际证据'}),
    record:async r=>records.push(r)});
  assert.deepEqual(executed,['source','cleanup']);
  assert.equal(result.status,'partial');
  assert.equal(records.filter(r=>r.activity==='cleanup'&&['before','after'].includes(r.phase)).length,2);
});

test('活动抛错与Commander断线都必须清场，并保留失败状态',async()=>{
  const {runWorkflow}=await import('../leadgen-workflow.mjs');
  for(const failure of ['script','model']){
    let cleaned=0;
    const result=await runWorkflow({activities:[{key:'preflight'},{key:'cleanup'}],context:{},
      handlers:{preflight:async()=>{throw Error('SCRIPT_FAILED');},cleanup:async()=>{cleaned++;return {released:true};}},
      commander:async r=>{if(failure==='model')throw Error('AUTH_UNAVAILABLE');return {action:'continue',reason:'记录失败'};},record:async()=>{}});
    assert.equal(cleaned,1);assert.equal(result.status,'failed');
  }
});

test('采集成功必须有同视频完成标记；非零返回时即使有LEAD也不能落完成',async()=>{
  const {parseCollection}=await import('../leadgen-workflow.mjs');
  const row='LEAD\t昵称\tid\tpersonal\t想报名\t今天\t陕西\t视频标题\t词\t西安\thttps://www.douyin.com/user/u\thttps://www.douyin.com/video/7646309328911907195';
  assert.throws(()=>parseCollection({code:6,stdout:row},'7646309328911907195'),/采集/);
  assert.throws(()=>parseCollection({code:0,stdout:row},'7646309328911907195'),/完成标记/);
  const comments=parseCollection({code:0,stdout:row+'\nCOLLECTION\t7646309328911907195\tcollected\t1'},'7646309328911907195');
  assert.equal(comments.length,1);assert.equal(comments[0].commentBody,'想报名');
  assert.deepEqual(parseCollection({code:0,stdout:'COLLECTION\t7646309328911907195\tno_comments\t0'},'7646309328911907195'),[]);
});
