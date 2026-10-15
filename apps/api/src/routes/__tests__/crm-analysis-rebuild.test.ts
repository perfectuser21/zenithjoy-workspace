import {beforeEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {analyze,binding}=vi.hoisted(()=>({analyze:vi.fn(),binding:vi.fn()}));
vi.mock('../../services/wechat/crm-analysis',()=>({crmScopeKey:(scope:unknown)=>JSON.stringify(scope),analyzeCrmScope:analyze,requireCrmBinding:binding,readScopedCrmProfile:vi.fn()}));
vi.mock('../../middleware/cs-config-guard',()=>({
 requireServiceCredential:(req:express.Request,res:express.Response,next:express.NextFunction)=>{if(req.get('Authorization')!=='Bearer test-license')return res.sendStatus(401);req.tenantId='tenant-a';next();},
 requireCsReadAccess:(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
 requireCsWriteAccess:()=> (_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
}));
import router from '../crm';
const app=express();app.use(express.json());app.use('/api/crm',router);
const body={tenant_id:'tenant-a',cs_wechat_id:'cs-a',customer_wechat_id:'wx-a'};
beforeEach(()=>{vi.clearAllMocks();binding.mockResolvedValue(true);analyze.mockResolvedValue({status:'updated'});});
describe('已消费真实历史的显式重算入口',()=>{
 it('仅显式boolean rebuild传入受限分析合同',async()=>{
  const r=await request(app).post('/api/crm/analysis/run').set('Authorization','Bearer test-license').send({...body,rebuild:true});
  expect(r.status).toBe(200);expect(analyze.mock.calls[0][1]).toEqual({rebuild:true});
 });
 it('缺省仍为普通待办补扫，字符串开关拒绝',async()=>{
  expect((await request(app).post('/api/crm/analysis/run').set('Authorization','Bearer test-license').send({...body,rebuild:'true'})).status).toBe(400);
  expect(analyze).not.toHaveBeenCalled();
  expect((await request(app).post('/api/crm/analysis/run').set('Authorization','Bearer test-license').send(body)).status).toBe(200);
  expect(analyze.mock.calls[0][1]).toEqual({rebuild:false});
 });
 it('无凭据、跨租户或无账号绑定均不得重算',async()=>{
  expect((await request(app).post('/api/crm/analysis/run').send({...body,rebuild:true})).status).toBe(401);
  expect((await request(app).post('/api/crm/analysis/run').set('Authorization','Bearer test-license').send({...body,tenant_id:'tenant-b',rebuild:true})).status).toBe(403);
  binding.mockResolvedValue(false);
  expect((await request(app).post('/api/crm/analysis/run').set('Authorization','Bearer test-license').send({...body,rebuild:true})).status).toBe(403);
  expect(analyze).not.toHaveBeenCalled();
 });
});
