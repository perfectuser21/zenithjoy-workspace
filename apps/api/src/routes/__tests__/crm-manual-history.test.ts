import { beforeEach,describe,expect,it,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../middleware/cs-config-guard',()=>({requireCsReadAccess:(_q:express.Request,_r:express.Response,n:express.NextFunction)=>n()}));
import { createManualHistoryRouter } from '../crm-manual-history';
const tenant='11111111-1111-4111-8111-111111111111';
const query=vi.fn(),generate=vi.fn();
function app(authenticated=true){
 const app=express();app.use(express.json());
 app.use((_q,r,n)=>{if(authenticated){Object.assign(_q,{tenantId:tenant,feishuUserId:'user-a',tenantRole:'owner'});}n();});
 app.use('/api/crm/manual-history',createManualHistoryRouter({db:{query,connect:vi.fn()} as any,generate}));return app;
}
const body={customer_id:'1',cs_wechat_id:'cs-a',source_type:'group',channel_name:'业务群',text:'客户：需要样品'};
beforeEach(()=>{vi.clearAllMocks();query.mockResolvedValue({rows:[],rowCount:0});});
describe('manual history auth must precede model and persistence',()=>{
 it('rejects absent current user instead of accepting a supplied actor',async()=>{
  const r=await request(app(false)).post('/api/crm/manual-history/preview').send({...body,actor:'user-a'});
  expect(r.status).toBe(401);expect(generate).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
 });
 it('rejects unknown or cross-tenant customer even if source_account is unknown',async()=>{
  const r=await request(app()).post('/api/crm/manual-history/preview').send(body);
  expect(r.status).toBe(404);expect(generate).not.toHaveBeenCalled();
  expect(query.mock.calls[0][1]).toEqual([tenant,'cs-a','1']);
 });
 it('checks object authorization on receipt lookup too',async()=>{
  const r=await request(app()).get('/api/crm/manual-history/requests/11111111-1111-4111-8111-111111111111?customer_id=1&cs_wechat_id=cs-a');
  expect(r.status).toBe(404);expect(query).toHaveBeenCalledTimes(1);expect(generate).not.toHaveBeenCalled();
 });
});
