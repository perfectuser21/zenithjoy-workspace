import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
// Only session lookup is an isolated identity boundary. Router, service and SQL are real.
vi.mock('../../../src/auth',()=>({auth:{api:{getSession:async()=>null}}}));
import pool from '../../../src/db/connection';
import pipeline from '../../../src/routes/ai-video-pipeline';
import aiVideo from '../../../src/routes/ai-video';
import { AiVideoPipelineService } from '../../../src/services/ai-video-pipeline.service';
const app=express();app.use(express.json());app.use('/api/ai-video/jobs',pipeline);app.use('/api/ai-video',aiVideo);
app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({error:err.message}));
const ids:Record<string,string>={};
beforeAll(async()=>{
 if(!process.env.DATABASE_HOST?.startsWith('/tmp/zj-media-'))throw new Error('requires disposable media PostgreSQL harness');
 await pool.query(`CREATE SCHEMA IF NOT EXISTS zenithjoy;
 CREATE TABLE IF NOT EXISTS zenithjoy.licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),license_key text,status text);
 CREATE TABLE zenithjoy.ai_video_generations(id varchar(255) PRIMARY KEY);
 CREATE TABLE zenithjoy.ai_video_pipeline_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text DEFAULT 'pending',progress int DEFAULT 0,src_video text,src_logo text,topic text,template_id text,license_id uuid,original_script text,target_aspect text,detected_aspect text,step15_orientation text,step15_confidence float,step15_reasoning text,result_url text,output_dir text,error_msg text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
 for(const who of ['a','b'])ids[who]=(await pool.query("INSERT INTO zenithjoy.licenses(license_key,status) VALUES($1,'active') RETURNING id",[who])).rows[0].id;
});
afterAll(async()=>pool.end());
const create=async(key?:string)=>{
 const r=request(app).post('/api/ai-video/jobs').send({local_path:'/tmp/input.mp4',original_script:'原文',target_aspect:'9:16'});
 if(key)r.set('Authorization',`Bearer ${key}`);
 const result=await r;expect(result.status).toBe(201);return result.body.job.id as string;
};
describe('real HTTP + PostgreSQL pipeline lifecycle and isolation',()=>{
 it('round trips the current .job envelope and fields through SQL and HTTP',async()=>{
  const id=await create('a');const result=await request(app).get(`/api/ai-video/jobs/${id}`);
  expect(result.status).toBe(200);expect(result.body).toMatchObject({id,original_script:'原文',target_aspect:'9:16',detected_aspect:null,license_id:ids.a});
  expect(result.body).not.toHaveProperty('raw_script');expect(result.body).not.toHaveProperty('originalScript');
 });
 it('returns exact separate pending sets for two licenses and anonymous compatibility',async()=>{
  await pool.query('TRUNCATE zenithjoy.ai_video_pipeline_jobs');
  const a=await create('a'),b=await create('b'),anonymous=await create();
  for(const [key,expected]of [['a',a],['b',b],['',anonymous]]){
   const r=request(app).get('/api/ai-video/jobs?status=pending');if(key)r.set('Authorization',`Bearer ${key}`);
   const result=await r;expect(result.status).toBe(200);expect(result.body.data.map((j:any)=>j.id)).toEqual([expected]);
  }
 });
 it('never lets invalid credentials fall through to unlicensed pending jobs',async()=>{
  const r=await request(app).get('/api/ai-video/jobs?status=pending').set('Authorization','Bearer invalid');expect(r.status).toBe(401);
 });
 it('returns only the calling license stale jobs, excludes fresh/other-license jobs',async()=>{
  await pool.query('TRUNCATE zenithjoy.ai_video_pipeline_jobs');
  const a=await create('a'),b=await create('b'),fresh=await create('a'),anonymous=await create();
  await pool.query("UPDATE zenithjoy.ai_video_pipeline_jobs SET status='processing',updated_at=now()-interval '10 minutes' WHERE id=ANY($1::uuid[])",[[a,b,anonymous]]);
  await pool.query("UPDATE zenithjoy.ai_video_pipeline_jobs SET status='processing' WHERE id=$1",[fresh]);
  for(const[key,expected]of [['a',a],['b',b],['',anonymous]]){
   const r=request(app).get('/api/ai-video/jobs?status=processing&stale_minutes=5');if(key)r.set('Authorization',`Bearer ${key}`);
   const result=await r;expect(result.status).toBe(200);expect(result.body.data.map((j:any)=>j.id)).toEqual([expected]);
  }
  expect((await request(app).get('/api/ai-video/jobs?status=processing')).body.data).toEqual([]);
 });
 it('persists progress, aspect and terminal completion',async()=>{
  const id=await create('a');
  expect((await request(app).patch(`/api/ai-video/jobs/${id}/progress`).send({progress:25,status:'processing',detected_aspect:'16:9'})).status).toBe(200);
  expect((await request(app).put(`/api/ai-video/jobs/${id}/complete`).send({output_dir:'/tmp/output'})).body).toMatchObject({status:'completed',progress:100,detected_aspect:'16:9',output_dir:'/tmp/output'});
  expect((await pool.query('SELECT status FROM zenithjoy.ai_video_pipeline_jobs WHERE id=$1',[id])).rows[0].status).toBe('completed');
 });
 it('SSE rejects malformed pipeline UUID, returns unknown IDs as exact 404, and forwards DB failures',async()=>{
  expect((await request(app).get('/api/ai-video/jobs/not-a-uuid/sse').timeout(2000)).status).toBe(400);
  expect((await request(app).get('/api/ai-video/jobs/00000000-0000-4000-8000-000000000000/sse')).status).toBe(404);
  expect((await request(app).get('/api/ai-video/task/job-local-unknown/sse')).status).toBe(404);
  const query=vi.spyOn(pool,'query').mockRejectedValueOnce(new Error('isolated database failure'));
  expect((await request(app).get('/api/ai-video/jobs/00000000-0000-4000-8000-000000000000/sse').timeout(2000)).status).toBe(500);query.mockRestore();
  const query2=vi.spyOn(pool,'query').mockRejectedValueOnce(new Error('isolated database failure'));
  expect((await request(app).get('/api/ai-video/task/job-local-unknown/sse').timeout(2000)).status).toBe(500);query2.mockRestore();
 });
 it('does not invent a successful task if PostgreSQL refuses the insert',async()=>{
  const query=vi.spyOn(pool,'query').mockRejectedValueOnce(Object.assign(new Error('connection refused'),{code:'ECONNREFUSED'}));
  await expect(new AiVideoPipelineService().createJob({srcVideo:'/tmp/input.mp4',srcLogo:null,topic:null})).rejects.toMatchObject({code:'ECONNREFUSED'});query.mockRestore();
 });
});
