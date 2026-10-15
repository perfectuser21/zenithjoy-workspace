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
describe('事件结果与恢复',()=>{
 for(const status of ['delivered','failed'])it(`${status}不再返回可发送文案`,async()=>{
  query.mockImplementation(async(sql:string)=>sql.includes('service_agents')?{rows:[{}]}:sql.includes('pg_try_advisory_lock')?{rows:[{locked:true}]}:sql.includes('source_event_id =')?{rows:[{direction:'out',id:42,status,content:'旧回复'}]}:{rows:[]});
  const generate=vi.fn();const result=await withCrmEvent(scope,'b'.repeat(64),generate);
  expect(result.status).toBe('event_'+status);expect(result.reply).toBeUndefined();expect(generate).not.toHaveBeenCalled();
 });
 it('被其他进程占锁时返回processing而不新生成',async()=>{
  query.mockImplementation(async(sql:string)=>sql.includes('service_agents')?{rows:[{}]}:{rows:[{locked:false}]});
  const generate=vi.fn();expect((await withCrmEvent(scope,'c'.repeat(64),generate)).status).toBe('event_processing');
  expect(generate).not.toHaveBeenCalled();expect(release).toHaveBeenCalled();
 });
 it('没有新scope事实时保留Windows旧资料分支',async()=>{
  const {readScopedCrmProfile}=await import('../crm-analysis');
  expect(await readScopedCrmProfile(scope,'客户')).toBeNull();
 });
 it('新scope只有draft时也不回退旧昵称资料',async()=>{
  query.mockImplementation(async(sql:string)=>sql.includes('count(*)')?{rows:[{total:1,pending:0}]}:{rows:[]});
  const {readScopedCrmProfile}=await import('../crm-analysis');
  expect((await readScopedCrmProfile(scope,'客户'))?.messages).toEqual([]);
 });
});


describe('真实迟到送达回归：待办水位不等于完整客户证据',()=>{
 const inMessage={id:'334',sender_name:'测试客户',direction:'in',content:'想了解智能客服，预算5000元，担心回复不及时',created_at:'2026-10-15T16:27:50.389Z'};
 const outMessage={id:'335',sender_name:'测试客户',direction:'out',content:'5000预算先看基础方案',created_at:'2026-10-15T16:27:52.504Z'};
 const old={summary:'客户预算5000，关注及时回复',need:'智能客服',budget:'5000',concern:'回复延迟',stage_suggestion:'A2',next_action:'介绍方案',source_message_ids:['334'],updated_at:'2026-10-15T16:28:00Z'};
 function setup(pending:unknown[],history:unknown[],previous:unknown=old,archivedIn:unknown[]=[]){
  query.mockImplementation(async(sql:string)=>{
   if(sql.includes('service_agents'))return {rows:[{}]};
   if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:true}]};
   if(sql.includes('consolidated = FALSE')&&sql.includes('SELECT'))return {rows:pending};
   if(sql.includes('wechat_messages')&&sql.includes('SELECT')&&sql.includes('id = ANY'))return {rows:archivedIn};
   if(sql.includes('wechat_messages')&&sql.includes('SELECT'))return {rows:history};
   if(sql.includes('SELECT summary,facts'))return {rows:previous?[{summary:old.summary,facts:{schema_version:1,analysis:previous}}]:[]};
   return {rows:[],rowCount:1};
  });
  llm.mockResolvedValue({content:JSON.stringify({...old,summary:'客户预算未见新增表达',budget:null})});
 }
 function stored(){return JSON.parse(query.mock.calls.find(([s])=>String(s).includes('INSERT INTO zenithjoy.wechat_contact_memory'))![1][3]).analysis;}
 it('入站已消费而出站晚到时，模型仍收到同scope原始入站，来源与消费ID分开',async()=>{
  setup([outMessage],[outMessage,inMessage]);
  await analyzeCrmScope(crmScopeKey(scope));
  const prompt=llm.mock.calls[0][0].prompt;
  expect(prompt).toContain(inMessage.content);
  expect(prompt).toContain('"role":"in"');
  expect(stored().source_message_ids).toEqual(['334','335']);
  expect(stored().customer_source_message_ids).toEqual(['334']);
  expect(stored().consumed_message_ids).toEqual(['335']);
  const water=query.mock.calls.find(([s])=>String(s).includes('SET consolidated'))!;
  expect(water[1][2]).toEqual(['335']);
  expect(query.mock.calls.some(([s])=>String(s).includes('UPDATE zenithjoy.crm_customers'))).toBe(false);
 });
 it('仅新增客服话语时不得用null或新摘要抹去已确认客户预算',async()=>{
  setup([outMessage],[outMessage,inMessage]);
  await analyzeCrmScope(crmScopeKey(scope));
  expect(stored().budget).toBe('5000');
  expect(stored().summary).toBe(old.summary);
 });
 it('新的客户明确撤回预算仍允许更新为空，不强行保留旧值',async()=>{
  const correction={...inMessage,id:'336',content:'我撤回之前的预算，预算尚未确定',created_at:'2026-10-15T17:00:00Z'};
  setup([correction],[correction,outMessage,inMessage]);
  await analyzeCrmScope(crmScopeKey(scope));
  expect(stored().budget).toBeNull();
 });
 it('近100条全为客服时回查旧画像真实入站来源，避免预算和来源被窗口抹去',async()=>{
  setup([outMessage],[outMessage],old,[inMessage]);
  await analyzeCrmScope(crmScopeKey(scope));
  expect(stored().budget).toBe('5000');
  expect(stored().customer_source_message_ids).toEqual(['334']);
  expect(llm.mock.calls[0][0].prompt).toContain(inMessage.content);
  const evidence=query.mock.calls.find(([s])=>String(s).includes('SELECT')&&String(s).includes('id = ANY'))!;
  expect(evidence[0]).toContain("direction = 'in'");
  expect(evidence[0]).toContain("status = 'delivered'");
  expect(evidence[1]).toEqual([crmScopeKey(scope),scope.csWechatId,['334']]);
 });
 it('旧AI字段没有可回查的真实客户来源时不保留预算宣称',async()=>{
  setup([outMessage],[outMessage],old,[]);
  await analyzeCrmScope(crmScopeKey(scope));
  expect(stored().budget).toBeNull();
  expect(stored().summary).not.toContain('5000');
  expect(stored().customer_source_message_ids).toEqual([]);
 });
 it('模型数字预算正规转字符串，不凭空添加币种',async()=>{
  setup([inMessage],[inMessage],null);
  llm.mockResolvedValue({content:JSON.stringify({...old,budget:5000})});
  await analyzeCrmScope(crmScopeKey(scope));
  expect(stored().budget).toBe('5000');
 });
 it('正式显式rebuild可从已送达历史修复画像，不伪造待办或改已消费消息',async()=>{
  setup([],[outMessage,inMessage]);
  llm.mockResolvedValue({content:JSON.stringify({...old,budget:5000})});
  expect(await analyzeCrmScope(crmScopeKey(scope),{rebuild:true})).toMatchObject({status:'updated'});
  expect(stored().budget).toBe('5000');
  expect(stored().source_message_ids).toEqual(['334','335']);
  expect(stored().consumed_message_ids).toEqual([]);
  expect(query.mock.calls.some(([s])=>String(s).includes('SET consolidated'))).toBe(false);
 });
});
