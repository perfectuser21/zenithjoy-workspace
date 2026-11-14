import request from 'supertest';import {vi,describe,it,expect,beforeEach} from 'vitest';
import app from '../src/app';import pool from '../src/db/connection';
vi.mock('../src/db/connection',()=>({default:{query:vi.fn(),end:vi.fn(),connect:vi.fn()}}));
const q=pool.query as ReturnType<typeof vi.fn>;
const ID='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{vi.clearAllMocks();delete process.env.ZENITHJOY_INTERNAL_TOKEN;});
describe('Worker API要求Brain挂号及租约身份',()=>{
 it('队列只选择有挂号的待领与执行中工作单，支持分页防饥饿',async()=>{q.mockResolvedValue({rows:[]});const r=await request(app).get('/api/pipelines/running?limit=50&offset=50');expect(r.status).toBe(200);const sql=q.mock.calls[0][0];expect(sql).toContain("pr.status IN ('pending','running')");expect(sql).toContain('pr.cecelia_task_id IS NOT NULL');expect(sql).toContain('OFFSET $2');expect(q.mock.calls[0][1]).toEqual([50,50]);expect(sql).toContain('COALESCE(pr.notebook_id,t.notebook_id)');});
 it('满页提供下一页游标，不永久困在前50个旧running',async()=>{q.mockResolvedValue({rows:Array.from({length:50},(_,i)=>({id:String(i),status:'running'}))});const r=await request(app).get('/api/pipelines/running?limit=50');expect(r.body.data.next_offset).toBe(50);q.mockResolvedValue({rows:[{id:ID,status:'pending'}]});const next=await request(app).get('/api/pipelines/running?limit=50&offset=50');expect(next.body.data.items[0].id).toBe(ID);expect(next.body.data.next_offset).toBeNull();});
 it('无身份的旧stage-complete/fail不能更新业务状态',async()=>{const x=await request(app).post(`/api/pipelines/${ID}/stage-complete`).send({stage:'export',is_final:true,output:{}});const y=await request(app).post(`/api/pipelines/${ID}/fail`).send({error:'old'});expect(x.status).toBe(400);expect(y.status).toBe(400);expect(pool.connect).not.toHaveBeenCalled();expect(q).not.toHaveBeenCalled();});
 it('数据库故障拒绝返回伪空队列',async()=>{q.mockRejectedValue(new Error('db down'));expect((await request(app).get('/api/pipelines/running')).status).toBe(500);});
});
