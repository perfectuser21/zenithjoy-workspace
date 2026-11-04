import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('../src/db/connection',()=>({default:{query:vi.fn(),end:vi.fn()}}));
vi.mock('../src/services/sse.service',()=>({sseService:{subscribe:vi.fn(),emit:vi.fn(),close:vi.fn()}}));
vi.mock('../src/middleware/tenant-context',()=>({
 tenantContext:(req:any,res:any,next:any)=>{if(!req.header('X-Test-Tenant'))return res.status(401).json({error:{code:'UNAUTHORIZED'}});req.tenantId=req.header('X-Test-Tenant');next();},
 tenantContextOptional:(_req:any,_res:any,next:any)=>next(),
}));
import app from '../src/app';
import pool from '../src/db/connection';
const mockQuery=pool.query as ReturnType<typeof vi.fn>;
const ID='11111111-1111-4111-8111-111111111111';
const TENANT='22222222-2222-4222-8222-222222222222';
describe('SSE HTTP contracts',()=>{
 beforeEach(()=>vi.resetAllMocks());
 describe('GET /api/acquisition/collect/:task_id/sse',()=>{
  it('malformed UUID returns 400 before SQL',async()=>{
   const res=await request(app).get('/api/acquisition/collect/bad-id/sse').set('X-Test-Tenant',TENANT);
   expect(res.status).toBe(400);expect(mockQuery).not.toHaveBeenCalled();
  });
  it('anonymous subscriber returns 401 before reading task',async()=>{
   const res=await request(app).get(`/api/acquisition/collect/${ID}/sse`);
   expect(res.status).toBe(401);expect(mockQuery).not.toHaveBeenCalled();
  });
  it('valid unknown/foreign UUID returns 404, SQL binds authenticated tenant',async()=>{
   mockQuery.mockResolvedValueOnce({rows:[]});
   const res=await request(app).get(`/api/acquisition/collect/${ID}/sse`).set('X-Test-Tenant',TENANT);
   expect(res.status).toBe(404);expect(mockQuery.mock.calls[0][1]).toEqual([ID,TENANT]);
  });
  it('known own task subscribes with current state',async()=>{
   const {sseService}=await import('../src/services/sse.service');
   mockQuery.mockResolvedValueOnce({rows:[{id:ID,status:'running',video_count:5,lead_count_raw:2,created_at:new Date(),ended_at:null}]});
   vi.mocked(sseService.subscribe).mockImplementationOnce((_id,_req,res)=>{res.json({subscribed:true});});
   const response=await request(app).get(`/api/acquisition/collect/${ID}/sse`).set('X-Test-Tenant',TENANT);
   expect(response.status).toBe(200);expect(sseService.subscribe).toHaveBeenCalledWith(ID,expect.anything(),expect.anything(),expect.objectContaining({status:'running',video_count:5}));
  });
 });
 for(const route of ['task','jobs'])it(`valid unknown ai-video ${route} UUID returns 404`,async()=>{
  mockQuery.mockResolvedValueOnce({rows:[]});const res=await request(app).get(`/api/ai-video/${route}/${ID}/sse`);expect(res.status).toBe(404);
 });
});
