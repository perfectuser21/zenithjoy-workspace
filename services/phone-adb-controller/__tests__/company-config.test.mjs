import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { freezeCompanyConfig, configTargetProfile } = require('../company-config-lib.js');

const snapshot = {company_id:'11111111-1111-4111-8111-111111111111', tenant_id:'aaaaaaaa-1111-2222-3333-444444444444', company_key:'jinoshengyuan', version:1,
 wiki:{products:[{id:'training',name:'考证陪跑'}],audiences:['考证求变者']}, runtime_config:{policy_id:'acquisition',video_judgment:{instructions:'不夸大'},comment_scoring:{criteria:{A:'求报名',B:'相关讨论',C:'寒暄','不相关':'广告'},confidence_threshold:0.6}}, source_evidence:[{source:'feishu',record_id:'real-source'}]};
function pool(responses) {
 const calls=[];const client={async query(sql,args){calls.push({sql,args});if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};const r=responses.shift();assert.ok(r,'未预期SQL '+sql);return r;},release(){}};
 return {calls,connect:async()=>client};
}
test('运行已有v1快照时不读取最新v2，恢复依然包含产品/规则/来源',async()=>{
 const p=pool([{rows:[{company_id:snapshot.company_id}]},{rows:[{snapshot}]}]);
 const out=await freezeCompanyConfig(p,{lineHint:'jinuo',runId:'same-run',step:'102'});
 assert.equal(out.version,1);assert.equal(out.policy_id,'acquisition');assert.deepEqual(out.product_ids,['training']);assert.equal(p.calls.some(c=>/company_config_versions/.test(c.sql)),false);
 const text=configTargetProfile(out,'102');assert.match(text,/考证陪跑/);assert.match(text,/不夸大/);
});
test('新运行缺公司映射时明确失败，不建立快照',async()=>{
 const p=pool([{rows:[]}]);await assert.rejects(freezeCompanyConfig(p,{lineHint:'yuesheng',runId:'new-run',step:'102'}),/COMPANY_MAPPING_MISSING/);assert.equal(p.calls.some(c=>/INSERT/.test(c.sql)),false);
});
test('草稿不能进入模型判定，事务回滚',async()=>{
 const p=pool([{rows:[{company_id:snapshot.company_id}]},{rows:[]},{rows:[{config_status:'draft'}]}]);
 await assert.rejects(freezeCompanyConfig(p,{lineHint:'jinuo',runId:'draft-run',step:'103'}),/COMPANY_CONFIG_NOT_ENABLED/);assert.ok(p.calls.some(c=>c.sql==='ROLLBACK'));
});
test('102和103缺规则必须具体报错，禁止另一公司兜底',()=>{
 assert.throws(()=>configTargetProfile({...snapshot,runtime_config:{}},'103'),/comment_scoring/);
 assert.throws(()=>configTargetProfile({...snapshot,wiki:{}},'102'),/products|audiences/);
});
