import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createVideoToolsRouter } from '../video-tools';

vi.mock('../../auth', () => ({auth:{api:{getSession:async ({headers}:{headers:Headers})=>{
  const id=headers.get('cookie')?.match(/user=([^;]+)/)?.[1];
  return id?{user:{id,email:`${id}@example.com`}}:null;
}}}}));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  execFile: Object.assign(vi.fn(), {[Symbol.for('nodejs.util.promisify.custom')]: async ()=>({stdout:JSON.stringify({streams:[{width:1024,height:1024,codec_name:'png',avg_frame_rate:'0/1'}],format:{duration:'0'}}),stderr:''})}),
}));

describe('staff image generation',()=>{
  let directory:string;
  const submit=vi.fn(); const poll=vi.fn(); const put=vi.fn(); const transport=vi.fn();
  const imageProvider={ configured:()=>true, submit, poll };
  const videoProvider={getConfiguration:()=>({wan:{configured:true,missing:[]},upscale:{configured:true,missing:[]}}),submitWan:vi.fn().mockResolvedValue({taskId:'wan-1'})};
  const storage={putObject:put,getSignedUrl:vi.fn(async(key:string)=>`https://assets.example.com/${key}`)};
  const app=()=>{const a=express(); a.use(express.json()); a.use('/video',createVideoToolsRouter({directory,storage:storage as never,provider:videoProvider as never,imageProvider, imageFetch:transport})); return a;};
  beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'imageflow-test-'));vi.stubEnv('STAFF_EMAILS','alice@example.com,bob@example.com'); submit.mockReset().mockResolvedValue('task-1');poll.mockReset().mockResolvedValue({status:'succeeded',url:'https://files.toapis.xyz/generated/a.png'});put.mockReset().mockResolvedValue(undefined);storage.getSignedUrl.mockClear();transport.mockReset().mockResolvedValue(new Response(Buffer.from([137,80,78,71,13,10,26,10]),{headers:{'Content-Length':'8'}}));});
  afterEach(async()=>{vi.unstubAllEnvs(); await rm(directory,{recursive:true,force:true});});
  it('registers generated output as the current employee asset that Wan accepts',async()=>{
    const a=app();const start=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'a cat',clientRequestId:'same'});expect(start.status).toBe(202);
    const again=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'a cat',clientRequestId:'same'});expect(again.body.id).toBe(start.body.id);expect(submit).toHaveBeenCalledTimes(1);
    expect((await request(a).get(`/video/image-jobs/${start.body.id}`).set('Cookie','user=bob')).status).toBe(404);
    const done=await request(a).get(`/video/image-jobs/${start.body.id}`).set('Cookie','user=alice');expect(done.status).toBe(200);expect(done.body.status).toBe('succeeded');expect(done.body.asset.kind).toBe('image');
    const wan=await request(a).post('/video/jobs').set('Cookie','user=alice').send({kind:'wan',prompt:'animate',media:[{type:'reference_image',url:done.body.asset.url}]});expect(wan.status).toBe(202);expect(videoProvider.submitWan).toHaveBeenCalled();
    const other=await request(a).post('/video/jobs').set('Cookie','user=bob').send({kind:'wan',prompt:'animate',media:[{type:'reference_image',url:done.body.asset.url}]});expect(other.status).toBe(400);
  });
  it('rejects changed Wan parameters with the same request ID',async()=>{
    const a=app();const first=await request(a).post('/video/jobs').set('Cookie','user=alice').send({kind:'wan',prompt:'one',clientRequestId:'wanfixed123456789'});expect(first.status).toBe(202);
    const changed=await request(a).post('/video/jobs').set('Cookie','user=alice').send({kind:'wan',prompt:'two',clientRequestId:'wanfixed123456789'});expect(changed.status).toBe(409);
  });
  it('rejects changed prompt with the same request ID instead of silently returning an old image',async()=>{
    const a=app();const first=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'cat',clientRequestId:'stable123456789012'});expect(first.status).toBe(202);
    const changed=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'dog',clientRequestId:'stable123456789012'});
    expect(changed.status).toBe(409);expect(submit).toHaveBeenCalledTimes(1);
  });
  it('reuses the generated result after an API restart for the same node request ID',async()=>{
    const first=await request(app()).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'cat',clientRequestId:'fixedrequestid123456'});
    const result=await request(app()).get(`/video/image-jobs/${first.body.id}`).set('Cookie','user=alice');
    expect(result.body.status).toBe('succeeded');
    const resumed=await request(app()).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'cat',clientRequestId:'fixedrequestid123456'});
    expect(resumed.body).toEqual(result.body);expect(submit).toHaveBeenCalledTimes(1);
  });
  it('renews a generated asset URL after it ages, without resubmitting a paid job',async()=>{
    const a=app();const created=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'chair',clientRequestId:'stable'});
    expect((await request(a).get(`/video/image-jobs/${created.body.id}`).set('Cookie','user=alice')).body.status).toBe('succeeded');
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);
    const reloaded=await request(a).get(`/video/image-jobs/${created.body.id}`).set('Cookie','user=alice');
    expect(reloaded.body.status).toBe('succeeded');expect(storage.getSignedUrl).toHaveBeenCalledTimes(2);expect(submit).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it('scopes the instance token to its configured employee and permitted routes',async()=>{
    vi.stubEnv('CREATIVE_CANVAS_INSTANCES',JSON.stringify({alice:'http://alice:8188',bob:'http://bob:8188'}));
    vi.stubEnv('CREATIVE_CANVAS_SERVICE_TOKENS',JSON.stringify({alice:'a'.repeat(48),bob:'b'.repeat(48)}));
    const a=app();const token='a'.repeat(48);
    const created=await request(a).post('/video/image-jobs').set('X-Creative-Instance-Token',token).send({prompt:'chair'});expect(created.status).toBe(202);
    expect((await request(a).get(`/video/image-jobs/${created.body.id}`).set('X-Creative-Instance-Token','b'.repeat(48))).status).toBe(404);
    expect((await request(a).post('/video/jobs').set('X-Creative-Instance-Token',token).send({kind:'upscale',videoUrl:'https://example.com/a.mp4'})).status).toBe(403);
    expect((await request(a).post('/video/uploads/presign').set('X-Creative-Instance-Token',token).send({name:'x.png',size:1})).status).toBe(403);
    expect((await request(a).post('/video/image-jobs').set('X-Creative-Instance-Token','x'.repeat(48)).send({prompt:'chair'})).status).toBe(401);
  });
  it('recovers abandoned jobs and frees slots on the next submission',async()=>{
    const a=app();
    const first=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'one'});
    const second=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'two'});
    expect(first.status).toBe(202);expect(second.status).toBe(202);
    const list=await request(a).get('/video/image-jobs').set('Cookie','user=alice');expect(list.body.jobs).toHaveLength(2);
    expect((await request(a).get('/video/image-jobs').set('Cookie','user=bob')).body.jobs).toHaveLength(0);
    poll.mockResolvedValue({status:'failed'});
    expect((await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'three'})).status).toBe(202);
    expect(poll).toHaveBeenCalledTimes(2);
    expect((await request(a).get(`/video/image-jobs/${first.body.id}`).set('Cookie','user=alice')).body.status).toBe('failed');
  });
  it('does not fetch an untrusted generated URL',async()=>{poll.mockResolvedValue({status:'succeeded',url:'https://evil.example/a.png'});const a=app();const start=await request(a).post('/video/image-jobs').set('Cookie','user=alice').send({prompt:'a cat'});const done=await request(a).get(`/video/image-jobs/${start.body.id}`).set('Cookie','user=alice');expect(done.status).toBe(502);expect(transport).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();});
});
