import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validateProducerDescriptor,verifyProducerDescriptor} from '../producer-descriptor.mjs';
import {readFrozen} from '../runtime-definition.mjs';

import {pendingDescriptor} from './fixtures/producer-pending-descriptor.mjs';
const raw=gunzipSync(readFileSync(new URL('./fixtures/a83-discovery-progress.json.gz',import.meta.url)));
const progress=JSON.parse(raw),company={company_id:pendingDescriptor.company_id,tenant_id:pendingDescriptor.tenant_id,version:14,policy_id:pendingDescriptor.policy_id};
const input=()=>({upstream:{deployment:{source_commit:pendingDescriptor.source_commit},snapshot_sha256:pendingDescriptor.snapshot_sha256,
  run_identity:{capability:pendingDescriptor.workflow_key,tag:pendingDescriptor.run_tag,profile:pendingDescriptor.profile,serial:pendingDescriptor.serial}},
  progressRaw:raw,progress,env:{LEADGEN_SOURCE_RUN:pendingDescriptor.run_tag,P:'legacy',SERIAL:pendingDescriptor.serial,LEADGEN_LINE:'jinuo'},company});

test('真实完整a83进度fixture保2VID与unknown显示，不以旧PG默认0覆盖原始观测',()=>{
  assert.equal(createHash('sha256').update(raw).digest('hex'),pendingDescriptor.progress_sha256);
  assert.deepEqual(progress.videos.map(v=>v.videoId),['7700112581541257551','7689863996204591985']);
  assert.equal(progress.videos[0].metrics.comment_total.value,2);
  assert.equal(progress.videos[1].metrics.comment_total.value,null);
  assert.equal(progress.videos[1].metrics.comment_total.reason,'unreadable_display');
});
test('v2仅认可已验证a83/beb的唯一pending范围，返回克隆不能扩大原输入',()=>{
  const got=validateProducerDescriptor(pendingDescriptor);assert.deepEqual(got,pendingDescriptor);
  got.video_ids.push('7700112581541257551');assert.equal(pendingDescriptor.video_ids.length,1);
});
test('v2真实完整progress与严格来源元数据可验证；不是281文件readFrozen正链替身',()=>{
  assert.deepEqual(verifyProducerDescriptor(pendingDescriptor,input()),pendingDescriptor);
});
for(const [name,value]of Object.entries({schema_version:3,source_commit:'a'.repeat(40),run_tag:'other101',
  snapshot_sha256:'a'.repeat(64),progress_sha256:'b'.repeat(64),profile:'other',serial:'other',line:'yuesheng',
  company_id:'00000000-0000-4000-8000-000000000001',tenant_id:'00000000-0000-4000-8000-000000000002',
  company_config_version:15,policy_id:'other',video_ids:['7700112581541257551'],allow_all:true})){
  test('v2错'+name+'不能扩大来源或碰隔离视频',()=>assert.throws(()=>validateProducerDescriptor({...pendingDescriptor,[name]:value}),/PRODUCER_DESCRIPTOR_INVALID/));
}
test('v2原progress任一字节改变均拒，不剪掉隔离旁VID来伪同源',()=>{
  const x=input();x.progressRaw=Buffer.from(JSON.stringify({...progress,videos:progress.videos.slice(1)}));
  assert.throws(()=>verifyProducerDescriptor(pendingDescriptor,x),/PRODUCER_DESCRIPTOR_INVALID/);
});
test('v2冻结digest不符仍由真实readFrozen拒绝，不为了正例放宽共享校验器',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pending-frozen-'));try{
    writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...input().upstream,files:{}}));
    assert.throws(()=>readFrozen(dir),/运行快照digest不符/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
