import express from 'express';
import request from 'supertest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { createVideoToolsRouter } from '../video-tools';
const decoder=vi.hoisted(()=>({width:1024,height:1024}));
vi.mock('../../auth',()=>({auth:{api:{getSession:async()=>null}}}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),execFile:Object.assign(vi.fn(),{[Symbol.for('nodejs.util.promisify.custom')]:async()=>({stdout:JSON.stringify({streams:[{width:decoder.width,height:decoder.height,codec_name:'png',avg_frame_rate:'0/1'}],format:{duration:'0'}}),stderr:''})})}));
describe('canvas reference image registration',()=>{
 let directory:string;const put=vi.fn();const sign=vi.fn(async(key:string)=>`https://bucket.cos.ap-guangzhou.myqcloud.com/${key}?n=${sign.mock.calls.length}`);const submit=vi.fn().mockResolvedValue({taskId:'wan-id'});
 const storage={putObject:put,getSignedUrl:sign};const provider={getConfiguration:()=>({wan:{configured:true,missing:[]},upscale:{configured:true,missing:[]}}),submitWan:submit};
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const makeApp=()=>{const a=express();a.use(express.json());a.use('/v',createVideoToolsRouter({directory,storage:storage as never,provider:provider as never}));return a;};
 const token=(s:string)=>s.repeat(48);
 const upload=(a:ReturnType<typeof makeApp>,who='a',data=png)=>request(a).post('/v/canvas-images').set('X-Creative-Instance-Token',token(who)).attach('file',data,'canvas.png');
 beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'canvas-image-test-'));vi.stubEnv('CREATIVE_CANVAS_INSTANCES',JSON.stringify({alice:'http://a:8188',bob:'http://b:8188'}));vi.stubEnv('CREATIVE_CANVAS_SERVICE_TOKENS',JSON.stringify({alice:token('a'),bob:token('b')}));put.mockReset().mockResolvedValue(undefined);sign.mockClear();submit.mockClear();decoder.width=1024;decoder.height=1024;});
 afterEach(async()=>{vi.unstubAllEnvs();vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});
 it('registers image only for the employee and allows it as a Wan reference',async()=>{
  const a=makeApp(),result=await upload(a);expect(result.status).toBe(200);expect(result.body).toMatchObject({kind:'image',width:1024,height:1024});
  expect((await request(a).get(`/v/canvas-images/${result.body.id}`).set('X-Creative-Instance-Token',token('b'))).status).toBe(404);
  expect((await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('b')).send({kind:'wan',prompt:'move',media:[{type:'reference_image',url:result.body.url}]})).status).toBe(400);
  expect((await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('a')).send({kind:'wan',prompt:'move',media:[{type:'reference_image',url:result.body.url}]})).status).toBe(202);expect(submit).toHaveBeenCalledTimes(1);
 });
 it('rejects URL import, invalid files, unauthorized access and oversized uploads',async()=>{
  const a=makeApp();expect((await request(a).post('/v/canvas-images').set('X-Creative-Instance-Token',token('a')).send({url:'http://169.254.169.254'})).status).toBe(400);
  expect((await upload(a,'a',Buffer.from('not a PNG'))).status).toBe(400);
  expect((await upload(a,'x')).status).toBe(401);
  expect((await upload(a,'a',Buffer.alloc(20*1024*1024+1))).status).toBe(413);expect(put).not.toHaveBeenCalled();
 });
 it('rejects excessive pixel counts before storing',async()=>{
  decoder.width=2049;decoder.height=2049;const result=await upload(makeApp());expect(result.status).toBe(400);expect(result.body.error).toContain('图片像素不能超过');expect(put).not.toHaveBeenCalled();
 });
 it('does not silently retry a legacy Wan task after its asset signature changes',async()=>{
  const a=makeApp(),first=await upload(a);const args={kind:'wan',prompt:'move',clientRequestId:'legacy-wan',media:[{type:'reference_image',url:first.body.url}]};
  const original=await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('a')).send(args);expect(original.status).toBe(202);
  const file=join(directory,createHash('sha256').update('alice').digest('hex'),`${original.body.id}.json`);const persisted=JSON.parse(await readFile(file,'utf8'));delete persisted.referenceHash;await writeFile(file,JSON.stringify(persisted));
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);const renewed=await request(a).get(`/v/canvas-images/${first.body.id}`).set('X-Creative-Instance-Token',token('a'));
  const retry=await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('a')).send({...args,media:[{type:'reference_image',url:renewed.body.url}]});
  expect(retry.status).toBe(409);expect(retry.body.error).toContain('请先核对历史记录');expect(submit).toHaveBeenCalledTimes(1);
 });
 it('keeps a Wan request idempotent when its owned image signature is renewed',async()=>{
  const a=makeApp(),first=await upload(a);const args={kind:'wan',prompt:'move',clientRequestId:'fixed-wan',media:[{type:'reference_image',url:first.body.url}]};
  const original=await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('a')).send(args);expect(original.status).toBe(202);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);const renewed=await request(a).get(`/v/canvas-images/${first.body.id}`).set('X-Creative-Instance-Token',token('a'));
  const retry=await request(a).post('/v/jobs').set('X-Creative-Instance-Token',token('a')).send({...args,media:[{type:'reference_image',url:renewed.body.url}]});
  expect(retry.status).toBe(202);expect(retry.body.id).toBe(original.body.id);expect(submit).toHaveBeenCalledTimes(1);
 });
 it('deduplicates the same image for one employee and renews its signed URL after expiry',async()=>{
  const a=makeApp(),first=await upload(a),again=await upload(a);expect(first.status).toBe(200);expect(again.body.id).toBe(first.body.id);expect(put).toHaveBeenCalledTimes(1);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);const renewed=await request(a).get(`/v/canvas-images/${first.body.id}`).set('X-Creative-Instance-Token',token('a'));expect(renewed.status).toBe(200);expect(renewed.body.url).not.toBe(first.body.url);expect(put).toHaveBeenCalledTimes(1);
 });
});
