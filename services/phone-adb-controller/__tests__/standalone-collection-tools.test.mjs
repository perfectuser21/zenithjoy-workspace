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
