import { beforeEach, describe, expect, it, vi } from 'vitest';
const {query,release,llm}=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),llm:vi.fn()}));
vi.mock('../../../db/connection',()=>({default:{query,connect:async()=>({query,release})}}));
vi.mock('../../../llm/openrouter',()=>({callOpenRouter:llm}));
import {crmScopeKey,parseCrmScope,analyzeCrmScope,readCrmContext,runCrmAnalysisSweep,withCrmEvent} from '../crm-analysis';
beforeEach(()=>{vi.clearAllMocks();query.mockResolvedValue({rows:[],rowCount:0});});
const scope={tenantId:'tenant-a',csWechatId:'cs-a',customerWechatId:'wx-a'};
describe('scoped CRM analysis',()=>{
 it('scope可逆且租户/账号/客户任一变化都隔离',()=>{
  expect(parseCrmScope(crmScopeKey(scope))).toEqual(scope);
  expect(crmScopeKey(scope)).not.toBe(crmScopeKey({...scope,csWechatId:'cs-b'}));
  expect(()=>crmScopeKey({...scope,customerWechatId:''})).toThrow();
  expect(parseCrmScope('wx-a')).toBeNull();
 });
 it('无归属账号不读取消息或调用模型',async()=>{
  expect(await analyzeCrmScope(crmScopeKey(scope))).toMatchObject({status:'unbound'});
  expect(llm).not.toHaveBeenCalled();
 });
 it('成功分析只消费delivered且事务内写画像和水位，不改人工主状态',async()=>{
  query.mockImplementation(async(sql:string)=>{
   if(sql.includes('service_agents'))return {rows:[{ok:1}]};
   if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:true}]};
   if(sql.includes('SELECT id, sender_name'))return {rows:[{id:'12',sender_name:'测试',direction:'in',content:'预算5000',created_at:new Date()}]};
   return {rows:[],rowCount:1};
  });
  llm.mockResolvedValue({content:JSON.stringify({summary:'客户预算5000',need:'客服',budget:'5000',concern:null,stage_suggestion:'A2',next_action:'介绍方案'})});
  expect(await analyzeCrmScope(crmScopeKey(scope))).toMatchObject({status:'updated'});
  const sqls=query.mock.calls.map(([s])=>String(s));
  expect(sqls.find(s=>s.includes('SELECT id, sender_name'))).toContain("status = 'delivered'");
  expect(sqls).toContain('COMMIT');
  expect(sqls.some(s=>/UPDATE zenithjoy.crm_customers/.test(s))).toBe(false);
  expect(sqls.some(s=>s.includes('id = ANY'))).toBe(true);
 });
 it('模型失败回滚，消息保持待办',async()=>{
  query.mockImplementation(async(sql:string)=>sql.includes('service_agents')?{rows:[{}]}:sql.includes('pg_try_advisory_xact_lock')?{rows:[{locked:true}]}:sql.includes('SELECT id, sender_name')?{rows:[{id:1,direction:'in',content:'hello'}]}:{rows:[]});
  llm.mockRejectedValue(new Error('timeout'));
  expect(await analyzeCrmScope(crmScopeKey(scope))).toMatchObject({status:'failed'});
  expect(query.mock.calls.map(([s])=>s)).toContain('ROLLBACK');
  expect(query.mock.calls.some(([s])=>String(s).includes('SET consolidated'))).toBe(false);
 });
 it('重复事件只有已有入站时返回unknown，不再调用生成器',async()=>{
  query.mockImplementation(async(sql:string)=>sql.includes('service_agents')?{rows:[{}]}:sql.includes('pg_try_advisory_lock')?{rows:[{locked:true}]}:sql.includes('source_event_id =')?{rows:[{direction:'in',id:1,status:'delivered'}]}:{rows:[]});
  const generate=vi.fn();
  expect(await withCrmEvent(scope,'a'.repeat(64),generate)).toMatchObject({status:'event_unknown'});
  expect(generate).not.toHaveBeenCalled();expect(release).toHaveBeenCalled();
 });
 it('CRM读取必须带完整scope且不回落全局昵称记忆',async()=>{
  await readCrmContext(scope,'同名客户');
  expect(query.mock.calls.some(([s,p])=>String(s).includes('crm_customers')&&JSON.stringify(p).includes('tenant-a'))).toBe(true);
  expect(query.mock.calls.some(([s,p])=>String(s).includes('wechat_contact_memory')&&JSON.stringify(p).includes(crmScopeKey(scope)))).toBe(true);
 });
 it('补扫只扫描新scope的持久delivered待办',async()=>{
  await runCrmAnalysisSweep();
  expect(String(query.mock.calls[0][0])).toContain("status = 'delivered'");
  expect(String(query.mock.calls[0][0])).toContain("crm:v1:%");
 });
});
describe('CRM档案与读回',()=>{
 it('scoped画像读回不会查询旧昵称记忆',async()=>{
  const {readScopedCrmProfile}=await import('../crm-analysis');
  query.mockImplementation(async(sql:string)=>sql.includes('SELECT direction')?{rows:[{direction:'in',content:'真实消息',created_at:new Date()}]}:{rows:[]});
  const profile=await readScopedCrmProfile(scope,'客户');
  expect(profile?.messages[0].text).toBe('真实消息');
  expect(query.mock.calls.some(([s])=>String(s).includes('cs_memory_'))).toBe(false);
 });
 it('新事件入站前必须有精确CRM客户身份，不能覆盖不同微信号',async()=>{
  const {ensureCrmCustomer}=await import('../crm-analysis');
  await expect(ensureCrmCustomer(scope,'同名客户')).rejects.toThrow('CRM_CUSTOMER_IDENTITY_CONFLICT');
  expect(query.mock.calls.some(([s])=>String(s).includes('wechat_id IS NULL'))).toBe(true);
 });
});
