import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import http from 'node:http';import type {AddressInfo} from 'node:net';import express from 'express';import request from 'supertest';
type ProviderPayload={model:string;messages:Array<{content:unknown}>};
const boundary=vi.hoisted(()=>({port:0,query:vi.fn(),payloads:[]as ProviderPayload[],reply:{}as Record<string,unknown>,status:200}));
vi.mock('../../db/connection',()=>({default:{query:boundary.query}}));
// The paid HTTPS transport is redirected to a real isolated HTTP provider server.
vi.mock('https',()=>({default:{request:(options:http.RequestOptions,callback:(response:http.IncomingMessage)=>void)=>{expect(options.hostname).toBe('openrouter.ai');return http.request({...options,hostname:'127.0.0.1',port:boundary.port},callback);}}}));
import router from '../../routes/ai-video-pipeline';
import {getTemplate} from '../../templates/registry';
const app=express();app.use(express.json());app.use('/api/ai-video/jobs',router);app.use((err:Error & {status?:number},req:express.Request,res:express.Response,next:express.NextFunction)=>{void req;void next;res.status(err.status??500).json({error:err.message});});
let server:http.Server;
beforeAll(async()=>{server=http.createServer(async(req,res)=>{let data='';for await(const c of req)data+=c;boundary.payloads.push(JSON.parse(data));res.writeHead(boundary.status,{'Content-Type':'application/json'});res.end(JSON.stringify(boundary.reply));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));boundary.port=(server.address()as AddressInfo).port;});
afterAll(async()=>new Promise<void>(r=>server.close(()=>r())));
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('/* isolated GSAP CDN */')));boundary.query.mockReset().mockResolvedValue({rows:[{id:'job',template_id:'C'}]});boundary.payloads=[];boundary.status=200;boundary.reply={choices:[{message:{content:'{}'}}]};});
const orientation=()=>request(app).post('/api/ai-video/jobs/job/detect-frame-orientation').attach('frame',Buffer.from('raw-frame-bytes'),{filename:'frame.jpg',contentType:'image/jpeg'});
describe('current transcript/orientation provider adapters over loopback HTTP',()=>{
 it('forwards multipart frame bytes and exact current model, persists all orientation fields',async()=>{
  boundary.reply={choices:[{message:{content:JSON.stringify({orientation:'cw90',confidence:0.87,reasoning:'sideways face'})}}]};
  const result=await orientation();expect(result.status).toBe(200);expect(result.body).toEqual({orientation:'cw90',confidence:0.87,reasoning:'sideways face'});
  expect(boundary.payloads[0]).toMatchObject({model:'google/gemini-2.0-flash-lite-001',messages:[{content:[{type:'text'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+Buffer.from('raw-frame-bytes').toString('base64')}}]}]});
  const update=boundary.query.mock.calls.find(c=>String(c[0]).startsWith('UPDATE'));expect(update?.[1]).toEqual(['cw90',0.87,'sideways face','job']);
 });
 it.each(['W-G','C','R'])('composes current %s template through HTTP with scene timing, HTML and overlay rectangle',async template=>{
  boundary.query.mockResolvedValue({rows:[{id:'job',template_id:template,original_script:'原始意图'}]});
  boundary.reply={choices:[{message:{content:JSON.stringify({scenes:[{i:0,eyebrow:'INTRO',title:'first',subtitle:'one'},{i:1,eyebrow:'END',title:'second',subtitle:'two'}]})}}]};
  const result=await request(app).post('/api/ai-video/jobs/job/compose-template').send({duration:10,segments:[{start:0,end:5,text:'first'},{start:5,end:10,text:'second'}]});
  expect(result.status).toBe(200);expect(Object.keys(result.body).sort()).toEqual(['aspect','html','phoneRect']);expect(result.body.aspect).toBe(getTemplate(template)!.aspect);expect(result.body.phoneRect).toEqual(getTemplate(template)!.phoneRect);
  expect(result.body.html).toContain('id="sc0"');expect(result.body.html).toContain('id="sc1"');expect(result.body.html).toContain('window.__hf');expect(result.body.html).toContain('seek:function');expect(result.body.html).not.toContain('react.development.js');expect(result.body.html).not.toContain('babel.min.js');
  expect(boundary.payloads[0]).toMatchObject({model:'anthropic/claude-sonnet-4-5'});expect(boundary.payloads[0].messages[0].content).toContain('原始意图');
 });
 it('invalid template is exact HTTP 400 with an existing job and no provider call',async()=>{
  boundary.query.mockResolvedValue({rows:[{id:'job',template_id:'INVALID'}]});
  const result=await request(app).post('/api/ai-video/jobs/job/compose-template').send({duration:10});expect(result.status).toBe(400);expect(result.body.error).toBe('unknown template: INVALID');expect(boundary.payloads).toEqual([]);
 });
 it('requires an actual frame and job before the provider is called',async()=>{
  expect((await request(app).post('/api/ai-video/jobs/job/detect-frame-orientation')).status).toBe(400);
  boundary.query.mockResolvedValueOnce({rows:[]});expect((await orientation()).status).toBe(404);expect(boundary.payloads).toEqual([]);
 });
 it('forwards transcript segments and merges explicit keep decisions without dropping timing/text',async()=>{
  boundary.reply={choices:[{message:{content:JSON.stringify({segments:[{index:0,keep:true,reason:'core'},{index:1,keep:false,reason:'off topic'}]})}}]};
  const segments=[{start:0,end:3,text:'核心观点'},{start:3,end:4,text:'接电话'}];
  const result=await request(app).post('/api/ai-video/jobs/job/analyze-transcript').send({segments,duration:4});expect(result.status).toBe(200);
  expect(result.body.segments).toEqual([{...segments[0],keep:true,reason:'core'},{...segments[1],keep:false,reason:'off topic'}]);expect(boundary.payloads[0].model).toBe('google/gemini-2.0-flash-001');
 });
 it('rejects empty segment input and provider error JSON instead of success-shaped output',async()=>{
  expect((await request(app).post('/api/ai-video/jobs/job/analyze-transcript').send({segments:[]})).status).toBe(400);
  boundary.status=503;boundary.reply={choices:[{message:{content:'{"orientation":"cw90"}'}}]};expect((await orientation()).status).toBe(502);
 });
 it('invalid provider JSON is an explicit failure; unknown orientation is persisted as none',async()=>{
  boundary.reply={choices:[{message:{content:'{broken}'}}]};expect((await orientation()).status).toBe(500);
  boundary.reply={choices:[{message:{content:'{"orientation":"sideways","confidence":0.1}'}}]};expect((await orientation()).body).toMatchObject({orientation:'none',confidence:0.1});
 });
});
