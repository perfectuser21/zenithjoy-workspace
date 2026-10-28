import express from 'express';
import request from 'supertest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoToolsRouter } from '../video-tools';
import type { MaterialStorage } from '../../services/material-storage';

const decoder = vi.hoisted(() => ({
  paths: [] as string[],
  metadata: {streams:[{width:1280,height:720,codec_name:'h264',avg_frame_rate:'25/1'}],format:{duration:'14.768',format_name:'mov,mp4,m4a,3gp,3g2,mj2'}},
}));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: async (_binary: string, args: string[]) => {
    decoder.paths.push(args[args.length - 1]);
    return {stdout:JSON.stringify(decoder.metadata),stderr:''};
  } }),
}));
vi.mock('../../auth', () => ({auth:{api:{getSession:async ({headers}:{headers:Headers})=>{
  const id=headers.get('cookie')?.match(/user=([^;]+)/)?.[1];
  return id?{user:{id,email:`${id}@example.com`}}:null;
}}}}));

describe('video direct upload: intent → COS PUT → verified completion',()=>{
  let directory: string;
  let expectedSize: number | null;
  let heads: string[];
  let signedKeys: string[];
  let transport: ReturnType<typeof vi.fn<typeof fetch>>;
  const content=Buffer.from('uploaded-video-bytes');
  const signed=(key:string)=>`https://materials-123.cos.accelerate.myqcloud.com/${key}?signature=server-generated`;
  const storage:MaterialStorage={
    putObject:async()=>{throw new Error('direct upload must not proxy file bytes through putObject');},
    presignPut:async(key)=>{signedKeys.push(key);return signed(key);},
    getSignedUrl:async(key)=>signed(key),
    deleteObject:async()=>{},
    headObject:async(key)=>{heads.push(key);return expectedSize===null?null:{sizeBytes:expectedSize};},
  };
  const makeApp=()=>{
    const app=express();app.use(express.json());
    app.use('/api/video-tools',createVideoToolsRouter({directory,storage}));return app;
  };
  const presign=(app:ReturnType<typeof makeApp>,body:unknown={name:'reference.mp4',size:content.length})=>request(app).post('/api/video-tools/uploads/presign').set('Cookie','user=alice').send(body);
  const complete=(app:ReturnType<typeof makeApp>,id:string,user='alice')=>request(app).post(`/api/video-tools/uploads/${id}/complete`).set('Cookie',`user=${user}`).send({});
  beforeEach(async()=>{
    directory=await mkdtemp(join(tmpdir(),'video-direct-test-'));
    expectedSize=content.length;heads=[];signedKeys=[];decoder.paths=[];
    vi.stubEnv('STAFF_EMAILS','alice@example.com,bob@example.com');
    transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(content,{headers:{'Content-Length':String(content.length)}}));
    vi.stubGlobal('fetch',transport);
  });
  afterEach(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});

  it('issues only a server-owned object key and completes with the same Asset schema as multipart upload',async()=>{
    const app=makeApp();const intent=await presign(app,{name:'reference.mp4',size:content.length,key:'another-account/overwrite.mp4'});
    expect(intent.status).toBe(200);
    expect(intent.body).toEqual({id:expect.any(String),uploadUrl:expect.stringContaining('https://materials-123.cos.accelerate.myqcloud.com/video-tools/')});
    expect(signedKeys[0]).not.toContain('another-account');
    const result=await complete(app,intent.body.id);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({id:intent.body.id,url:signed(signedKeys[0]),kind:'video',name:'reference.mp4',width:1280,height:720,duration:14.768,size:content.length,fps:25,createdAt:expect.any(String)});
    expect(heads).toEqual(signedKeys);
    expect(transport.mock.calls[0][0]).toBe(signed(signedKeys[0]));
    expect(transport.mock.calls[0][1]).toMatchObject({redirect:'error',signal:expect.any(AbortSignal)});
    expect(decoder.paths[0]).toMatch(/video-tools-complete-/);
    await expect(readFile(decoder.paths[0])).rejects.toMatchObject({code:'ENOENT'});
  });
  it('persists the intent across router restarts and makes simultaneous/repeated completion idempotent',async()=>{
    const intent=await presign(makeApp());const restarted=makeApp();
    const results=await Promise.all([complete(restarted,intent.body.id),complete(restarted,intent.body.id)]);
    expect(results.map(result=>result.status)).toEqual([200,200]);
    expect(results[0].body).toEqual(results[1].body);
    const again=await complete(makeApp(),intent.body.id);
    expect(again.body).toEqual(results[0].body);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(heads).toHaveLength(1);
  });
  it('does not let another staff account complete or inspect someone else’s upload',async()=>{
    const app=makeApp();const intent=await presign(app);
    expect(intent.status).toBe(200);
    expect((await complete(app,intent.body.id,'bob')).status).toBe(404);
    expect(heads).toEqual([]);expect(transport).not.toHaveBeenCalled();
  });
  it('expires uncompleted intents after the signed upload window',async()=>{
    const app=makeApp();const intent=await presign(app);
    expect(intent.status).toBe(200);
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+3*3600_000);
    expect((await complete(app,intent.body.id)).status).toBe(410);
    expect(heads).toEqual([]);expect(transport).not.toHaveBeenCalled();
  });
  it.each([null,1,101*1024*1024])('refuses completion when HEAD reports missing or mismatched bytes (%s)',async size=>{
    const app=makeApp();const intent=await presign(app);expectedSize=size;
    expect((await complete(app,intent.body.id)).status).toBe(409);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([{name:'reference.mp4',size:0,status:400},{name:'reference.mp4',size:101*1024*1024,status:413},{name:'program.exe',size:42,status:400},{name:'reference.mp4',size:2.5,status:400}])('rejects invalid upload intent before signing ($name, $size)',async ({status,...body})=>{
    expect((await presign(makeApp(),body)).status).toBe(status);expect(signedKeys).toEqual([]);
  });
  it('rechecks the downloaded byte count instead of trusting HEAD alone',async()=>{
    const app=makeApp();const intent=await presign(app);
    transport.mockResolvedValueOnce(new Response('truncated'));
    expect((await complete(app,intent.body.id)).status).toBe(409);
    expect(decoder.paths).toEqual([]);
  });
  it('cuts off a stream that exceeds the intended byte count before probing it',async()=>{
    const app=makeApp();const intent=await presign(app);
    transport.mockResolvedValueOnce(new Response(Buffer.alloc(content.length+1)));
    expect((await complete(app,intent.body.id)).status).toBe(409);
    expect(decoder.paths).toEqual([]);
  });
  it('keeps a timed-out completion retryable without issuing another PUT URL',async()=>{
    const app=makeApp();const intent=await presign(app);
    transport.mockRejectedValueOnce(Object.assign(new Error('network timeout'),{name:'TimeoutError'}));
    expect((await complete(app,intent.body.id)).status).toBe(504);
    expect((await complete(app,intent.body.id)).status).toBe(200);
    expect(signedKeys).toHaveLength(1);
  });
  it('refuses an unsafe storage URL before any server-side fetch',async()=>{
    const app=makeApp();const intent=await presign(app);
    const signer=vi.spyOn(storage,'getSignedUrl').mockResolvedValue('http://127.0.0.1/private');
    expect((await complete(app,intent.body.id)).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();signer.mockRestore();
  });
  it('rejects anonymous and cross-origin calls at both new upload endpoints',async()=>{
    const app=makeApp();
    expect((await request(app).post('/api/video-tools/uploads/presign').send({name:'reference.mp4',size:42})).status).toBe(401);
    expect((await request(app).post('/api/video-tools/uploads/presign').set('Cookie','user=alice').set('Origin','https://other.example').send({name:'reference.mp4',size:42})).status).toBe(403);
    const intent=await presign(app);
    expect((await request(app).post(`/api/video-tools/uploads/${intent.body.id}/complete`).set('Cookie','user=alice').set('Origin','https://other.example').send({})).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
});
