import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {generate}=vi.hoisted(()=>({generate:vi.fn().mockResolvedValue({status:'sent'})}));
vi.mock('../../services/wechat-draft',()=>({generateChatDraft:generate,generateMomentDraft:vi.fn()}));
vi.mock('../../middleware/cs-config-guard',()=>({requireServiceCredential:(req:express.Request,_res:express.Response,next:express.NextFunction)=>{req.tenantId='license-tenant';next();}}));
import {wechatRouter} from '../wechat';
describe('新事件授权租户',()=>{
 it('body省略tenant也不能用header切换租户',async()=>{
  const app=express();app.use(express.json());app.use(wechatRouter);
  const r=await request(app).post('/draft-generate').set('X-Tenant-Id','another-tenant').send({sender:'客户',wechat_id:'wx-c',content:'你好',source_event_id:'a'.repeat(64)});
  expect(r.status).toBe(403);expect(generate).not.toHaveBeenCalled();
 });
});
