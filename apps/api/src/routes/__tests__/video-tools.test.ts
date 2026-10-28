import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoToolsRouter } from '../video-tools';

vi.mock('../../auth', () => ({ auth: { api: { getSession: async ({headers}: {headers: Headers}) => {
  const id = headers.get('cookie')?.match(/user=([^;]+)/)?.[1];
  return id ? {user:{id,email:`${id}@example.com`}} : null;
} } } }));

describe('video tools API smoke: staff upload, submit, resume and download', () => {
  let directory: string;
  let state: 'pending' | 'succeeded' | 'failed';
  let submissions: number;
  const downloadResult=vi.fn(async (_url:string)=>new Response('completed-video'));
  const makeApp = () => {
    const provider = {
      getConfiguration: () => ({wan:{configured:true,missing:[]},upscale:{configured:true,missing:[]}}),
      submitWan: async () => { submissions++; return {taskId:`task-${submissions}`}; },
      submitUpscale: async () => { submissions++; return {taskId:`upscale-${submissions}`}; },
      fetchTask: async () => ({status:state,...(state==='succeeded'?{videoUrl:'https://media.example.com/result.mp4'}:{}),...(state==='failed'?{error:'生成失败，请检查素材'}:{})}),
      downloadResult,
    };
    const app = express();
    app.use(express.json());
    app.use('/api/video-tools', createVideoToolsRouter({provider: provider as never,directory}));
    return app;
  };
  beforeEach(async()=>{
    directory=await mkdtemp(join(tmpdir(),'video-tools-test-'));
    state='pending';submissions=0;
    downloadResult.mockClear();
    vi.stubEnv('STAFF_EMAILS','alice@example.com,bob@example.com');
  });
  afterEach(async()=>{vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});

  it('rejects anonymous users and forged staff identity headers before creating paid tasks',async()=>{
    const app=makeApp();
    expect((await request(app).post('/api/video-tools/jobs').set('X-User-Email','alice@example.com').send({kind:'wan',prompt:'海边日落'})).status).toBe(401);
    expect((await request(app).post('/api/video-tools/jobs').set('Cookie','user=outsider').send({kind:'wan',prompt:'海边日落'})).status).toBe(403);
    expect(submissions).toBe(0);
  });
  it('downloads completed results through the provider transport while retaining account isolation',async()=>{
    const app=makeApp();const created=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send({kind:'upscale',videoUrl:'https://source.example.com/video.mp4'});state='succeeded';
    expect((await request(app).get(`/api/video-tools/jobs/${created.body.id}/download`).set('Cookie','user=bob')).status).toBe(404);
    expect(downloadResult).not.toHaveBeenCalled();
    const result=await request(app).get(`/api/video-tools/jobs/${created.body.id}/download`).set('Cookie','user=alice');
    expect(result.status).toBe(200);expect(result.headers['content-type']).toContain('video/mp4');
    expect(Buffer.from(result.body).toString()).toBe('completed-video');
    expect(downloadResult).toHaveBeenCalledExactlyOnceWith('https://media.example.com/result.mp4');
  });
  it('submits once and recovers the same task after a server restart without resubmitting',async()=>{
    const body={kind:'wan',prompt:'海边日落',resolution:'480P',duration:2,clientRequestId:'one-click'};
    const app=makeApp();
    const created=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send(body);
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({kind:'wan',status:'pending'});
    const again=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send(body);
    expect(again.body.id).toBe(created.body.id);
    expect(submissions).toBe(1);
    state='succeeded';
    const resumed=await request(makeApp()).get('/api/video-tools/jobs').set('Cookie','user=alice');
    expect(resumed.body.jobs.map((j:{id:string})=>j.id)).toContain(created.body.id);
    state='succeeded';
    const result=await request(makeApp()).get(`/api/video-tools/jobs/${created.body.id}`).set('Cookie','user=alice');
    expect(result.body).toMatchObject({status:'succeeded',videoUrl:'https://media.example.com/result.mp4'});
  });
  it('serializes simultaneous duplicate submissions to avoid charging twice',async()=>{
    const app=makeApp();
    const body={kind:'wan',prompt:'海边日落',clientRequestId:'parallel-click'};
    const responses=await Promise.all([1,2].map(()=>request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send(body)));
    expect(responses.map(r=>r.status)).toEqual([202,202]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(submissions).toBe(1);
  });
  it('refreshes completed provider tasks before deciding whether the active task limit is full',async()=>{
    const app=makeApp();
    for(const prompt of ['first','second']) expect((await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send({kind:'wan',prompt})).status).toBe(202);
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+20000);
    state='succeeded';
    try { expect((await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send({kind:'wan',prompt:'third'})).status).toBe(202); }
    finally {clock.mockRestore();}
    expect(submissions).toBe(3);
  });
  it('does not expose another staff member’s tasks',async()=>{
    const app=makeApp();
    const created=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send({kind:'wan',prompt:'海边日落'});
    expect((await request(app).get(`/api/video-tools/jobs/${created.body.id}`).set('Cookie','user=bob')).status).toBe(404);
    expect((await request(app).get('/api/video-tools/jobs').set('Cookie','user=bob')).body.jobs).toEqual([]);
  });
  it('returns real failures without presenting an input video as a successful result',async()=>{
    const app=makeApp();
    const created=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').send({kind:'upscale',videoUrl:'https://media.example.com/source.mp4'});
    expect(created.status).toBe(202);
    state='failed';
    const result=await request(app).get(`/api/video-tools/jobs/${created.body.id}`).set('Cookie','user=alice');
    expect(result.body.status).toBe('failed');
    expect(result.body.error).toContain('失败');
    expect(result.body.videoUrl).toBeUndefined();
    expect((await request(app).get(`/api/video-tools/jobs/${created.body.id}/download`).set('Cookie','user=alice')).status).toBe(409);
  });
  it.each([{kind:'wan',prompt:''},{kind:'wan',prompt:'test',duration:31},{kind:'upscale',videoUrl:'http://127.0.0.1/video.mp4'},{kind:'upscale',videoUrl:'file:///etc/passwd'}])('rejects invalid input before submitting ($kind)',async body=>{
    expect((await request(makeApp()).post('/api/video-tools/jobs').set('Cookie','user=alice').send(body)).status).toBe(400);
    expect(submissions).toBe(0);
  });
  it('rejects cross-origin paid submissions and oversized or unsupported uploads',async()=>{
    const app=makeApp();
    const attack=await request(app).post('/api/video-tools/jobs').set('Cookie','user=alice').set('Origin','https://untrusted.example').send({kind:'wan',prompt:'海边日落'});
    expect(attack.status).toBe(403);
    const upload=await request(app).post('/api/video-tools/uploads').set('Cookie','user=alice').attach('file',Buffer.from('hello'),'program.exe');
    expect(upload.status).toBe(400);
    expect(submissions).toBe(0);
  });
});
