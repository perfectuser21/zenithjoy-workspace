import {beforeEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {query,transaction,release}=vi.hoisted(()=>({query:vi.fn(),transaction:vi.fn(),release:vi.fn()}));
vi.mock('../../db/connection',()=>({default:{query,connect:async()=>({query:transaction,release})}}));
vi.mock('../../middleware/cs-config-guard',()=>({
 requireServiceCredential:(req:express.Request,_res:express.Response,next:express.NextFunction)=>{req.tenantId='tenant-a';next();},
 requireCsReadAccess:(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
 requireCsWriteAccess:()=> (_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
}));
import crmRouter from '../crm';
const app=express();app.use(express.json());app.use('/api/crm',crmRouter);
const body={cs_wechat_id:'cs-a',contacts:[{name:'测试新客',wechat_id:'test_customer'}]};
beforeEach(()=>{vi.clearAllMocks();query.mockResolvedValue({rows:[{tenant_id:'tenant-a'}]});transaction.mockResolvedValue({rows:[{inserted:true}]});});
describe('局部好友建档',()=>{
 it('partial只upsert观察到的人，不改变全量扫描账',async()=>{
  const r=await request(app).post('/api/crm/friend-scan/ingest').send({...body,scan_scope:'partial'});
  expect(r.status).toBe(200);expect(r.body.scan_scope).toBe('partial');
  const sqls=transaction.mock.calls.map(([s])=>String(s));
  expect(sqls.some(s=>s.includes('crm_onboarding_state'))).toBe(false);
  expect(sqls.some(s=>s.includes('scan_miss_count + 1'))).toBe(false);
  expect(sqls).toContain('COMMIT');expect(release).toHaveBeenCalled();
 });
 it('默认full仍更新onboarding和未观察联系人miss',async()=>{
  const r=await request(app).post('/api/crm/friend-scan/ingest').send(body);
  expect(r.status).toBe(200);expect(r.body.scanned_count).toBe(1);
  expect(transaction.mock.calls.some(([s])=>String(s).includes('crm_onboarding_state'))).toBe(true);
  expect(transaction.mock.calls.some(([s])=>String(s).includes('scan_miss_count + 1'))).toBe(true);
 });
 it('partial同名已绑定不同微信号时409且整批回滚',async()=>{
  transaction.mockImplementation(async(sql:string)=>{
   if(sql.includes('INSERT INTO zenithjoy.crm_customers')){
    // 模拟原子ON CONFLICT WHERE的数据库行为：没护栏时旧实现会错误覆盖。
    return sql.includes('EXCLUDED.wechat_id = zenithjoy.crm_customers.wechat_id')?{rows:[]}:{rows:[{inserted:false}]};
   }
   return {rows:[]};
  });
  const r=await request(app).post('/api/crm/friend-scan/ingest').send({...body,scan_scope:'partial'});
  expect(r.status).toBe(409);expect(r.body.error.code).toBe('CONTACT_IDENTITY_CONFLICT');
  const sqls=transaction.mock.calls.map(([s])=>String(s));expect(sqls).toContain('ROLLBACK');expect(sqls).not.toContain('COMMIT');
 });
 it('非法scan_scope拒绝且不开始事务',async()=>{
  const r=await request(app).post('/api/crm/friend-scan/ingest').send({...body,scan_scope:'everything'});
  expect(r.status).toBe(400);expect(transaction).not.toHaveBeenCalled();
 });
 it('partial空列表不重置扫描状态',async()=>{
  const r=await request(app).post('/api/crm/friend-scan/ingest').send({...body,contacts:[],scan_scope:'partial'});
  expect(r.status).toBe(200);expect(transaction.mock.calls.map(([s])=>s)).toEqual(['BEGIN','COMMIT']);
 });
});
