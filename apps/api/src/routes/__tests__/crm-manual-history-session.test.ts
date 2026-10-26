import { beforeEach,describe,expect,it,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const {getSession}=vi.hoisted(()=>({getSession:vi.fn()}));
vi.mock('../../auth',()=>({auth:{api:{getSession}}}));
// Reproduce the legacy guard's supported header identity path. The new endpoint must never use it.
vi.mock('../../middleware/cs-config-guard',()=>({requireCsReadAccess:(q:express.Request,_r:express.Response,n:express.NextFunction)=>{if(q.get('X-Feishu-User-Id'))Object.assign(q,{tenantId:'11111111-1111-4111-8111-111111111111',feishuUserId:q.get('X-Feishu-User-Id'),tenantRole:'owner'});n();}}));
import {createManualHistoryRouter} from '../crm-manual-history';
import {ManualHistoryService} from '../../services/crm/manual-history';
const tenant='11111111-1111-4111-8111-111111111111';
const query=vi.fn(),generate=vi.fn();
function app(){const app=express();app.use(express.json());app.use('/api/crm/manual-history',createManualHistoryRouter({db:{query,connect:vi.fn()} as any,generate}));return app;}
const body={customer_id:'1',cs_wechat_id:'cs-a',source_type:'group',channel_name:'业务群',text:'客户：需要样品'};
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();getSession.mockResolvedValue(null);query.mockResolvedValue({rows:[{id:'1'}],rowCount:1});});
describe('manual history default authentication derives actor exclusively from session cookie',()=>{
 it('does not accept known legacy header identities, bypass headers or Bearer without a cookie',async()=>{
  const r=await request(app()).post('/api/crm/manual-history/preview').set('X-Feishu-User-Id','known-owner').set('X-Bypass-Tenant','true').set('Authorization','Bearer legacy-token').send(body);
  expect(r.status).toBe(401);expect(query).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();expect(getSession).not.toHaveBeenCalled();
 });
 it('does not fall back to headers when the cookie is invalid',async()=>{
  const r=await request(app()).get('/api/crm/manual-history/?customer_id=1&cs_wechat_id=cs-a').set('Cookie','better-auth.session_token=invalid').set('X-Feishu-User-Id','known-owner');
  expect(r.status).toBe(401);expect(query).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();
 });
 it('maps the actual session user into tenant_members and ignores competing headers',async()=>{
  getSession.mockResolvedValue({user:{id:'actual-session-user'}});
  query.mockResolvedValueOnce({rows:[{tenant_id:tenant,role:'owner'}],rowCount:1}).mockResolvedValueOnce({rows:[{id:'1'}],rowCount:1});
  const preview=vi.spyOn(ManualHistoryService.prototype,'preview').mockResolvedValue({id:'preview'} as any);
  const r=await request(app()).post('/api/crm/manual-history/preview').set('Cookie','better-auth.session_token=valid').set('X-Feishu-User-Id','other-user').set('X-Bypass-Tenant','true').send(body);
  expect(r.status).toBe(200);expect(query.mock.calls[0][1]).toEqual(['actual-session-user']);
  expect(preview.mock.calls[0][0]).toEqual({tenantId:tenant,actor:'actual-session-user',customerId:'1',csWechatId:'cs-a'});
  const headers=getSession.mock.calls[0][0].headers as Headers;
  expect(headers.get('cookie')).toContain('session_token=valid');expect(headers.get('x-feishu-user-id')).toBeNull();expect(headers.get('authorization')).toBeNull();
 });
 it('rejects a body-supplied actor instead of changing the session actor',async()=>{
  getSession.mockResolvedValue({user:{id:'actual-session-user'}});
  query.mockResolvedValueOnce({rows:[{tenant_id:tenant,role:'owner'}],rowCount:1}).mockResolvedValueOnce({rows:[{id:'1'}],rowCount:1});
  const r=await request(app()).post('/api/crm/manual-history/preview').set('Cookie','better-auth.session_token=valid').send({...body,actor:'forged-operator'});
  expect(r.status).toBe(400);expect(generate).not.toHaveBeenCalled();expect(query.mock.calls[0][1]).toEqual(['actual-session-user']);
 });
});
