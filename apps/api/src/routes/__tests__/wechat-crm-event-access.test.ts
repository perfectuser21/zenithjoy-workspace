import {beforeEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {generate,query,mark}=vi.hoisted(()=>({generate:vi.fn(),query:vi.fn(),mark:vi.fn()}));
vi.mock('../../services/wechat-draft',()=>({generateChatDraft:generate,generateMomentDraft:vi.fn()}));
vi.mock('../../db/connection',()=>({default:{query}}));
vi.mock('../../services/wechat/contact-memory',()=>({markMessageReceipt:mark}));
vi.mock('../../services/wechat/cs-identity-resolve',()=>({resolveCsWechatIdentity:async()=> 'cs-a'}));
vi.mock('../../middleware/cs-config-guard',()=>({requireServiceCredential:(req:express.Request,res:express.Response,next:express.NextFunction)=>{
 if(!req.header('Authorization')){res.status(401).json({error:'UNAUTHORIZED'});return;}
 req.tenantId='license-tenant';next();
}}));
import {wechatRouter} from '../wechat';
import {crmScopeKey} from '../../services/wechat/crm-analysis';
const app=express();app.use(express.json());app.use(wechatRouter);
beforeEach(()=>{vi.clearAllMocks();generate.mockResolvedValue({status:'sent'});query.mockResolvedValue({rows:[]});mark.mockResolvedValue(false);});
const body={sender:'客户',wechat_id:'wx-c',content:'你好',source_event_id:'a'.repeat(64)};
describe('新事件授权租户',()=>{
 it('body省略tenant也不能用header切换租户',async()=>{
  const r=await request(app).post('/draft-generate').set('Authorization','Bearer test').set('X-Tenant-Id','another-tenant').send(body);
  expect(r.status).toBe(403);expect(generate).not.toHaveBeenCalled();
 });
 it('新事件无凭据必须经过凭据闸且拒绝',async()=>{
  expect((await request(app).post('/draft-generate').send(body)).status).toBe(401);expect(generate).not.toHaveBeenCalled();
 });
 it('授权tenant优先于body/header兜底',async()=>{
  const r=await request(app).post('/draft-generate').set('Authorization','Bearer test').send(body);
  expect(r.status).toBe(200);expect(generate).toHaveBeenCalledWith(expect.objectContaining({tenant_id:'license-tenant'}));
 });
 it('跨tenant凭据不能确认scoped消息',async()=>{
  query.mockResolvedValue({rows:[{contact_key:crmScopeKey({tenantId:'other',csWechatId:'cs-a',customerWechatId:'wx-c'})}]});
  const r=await request(app).post('/messages/42/receipt').set('Authorization','Bearer test').send({ok:true,cs_wechat_id:'cs-a'});
  expect(r.status).toBe(403);expect(mark).not.toHaveBeenCalled();
 });
 it('无凭据回执仅调用不带授权scope的受限更新',async()=>{
  const r=await request(app).post('/messages/42/receipt').send({ok:false,cs_wechat_id:'cs-a'});
  expect(r.status).toBe(200);expect(mark).toHaveBeenCalledWith(42,false,'cs-a');
 });
});
