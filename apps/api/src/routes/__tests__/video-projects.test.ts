import express from 'express';
import request from 'supertest';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { createVideoProjectsRouter } from '../video-projects';
// Disk cleanup can finish after the completed state becomes visible. A slow
// filesystem must not leave a finished project temporarily impossible to edit.
vi.mock('node:fs/promises', async importOriginal => {
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,rm:async(path:Parameters<typeof actual.rm>[0],options:Parameters<typeof actual.rm>[1])=>{
  if(String(path).split('/').at(-1)?.startsWith('video-project-')) await new Promise(done=>setTimeout(done,40));
  return actual.rm(path,options);
 }};
});
vi.mock('../../services/video-project-media',()=>({
  validateVideoBoundaries:(duration:number,cuts:number[])=>{if(cuts.includes(99)) throw Object.assign(new Error('无效切点'),{status:400});return[];},
  splitProjectVideo:async(_source:string,dir:string)=>{const file=join(dir,'clip.mp4');await writeFile(file,'clip');return[{start:0,end:5,file,metadata:{width:640,height:360,duration:5,fps:30,size:4}}];},
  assembleProjectVideo:async(_source:string,_clips:unknown,output:string)=>{await writeFile(output,'output');return{width:640,height:360,duration:5,fps:30,size:6};},
}));
const sourceId=randomUUID(),assetId=randomUUID(),jobId=randomUUID();
let directory:string;
afterEach(async()=>{if(directory) await rm(directory,{recursive:true,force:true});});
async function waitForProcessing(app:express.Express,id:string,processingStatus:string) {
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const response=await request(app).get(`/projects/${id}`);expect(response.status).toBe(200);
  if(response.body.status!==processingStatus)return response.body;
  await new Promise<void>(done=>setImmediate(done));
 }
 throw new Error(`项目 ${id} 在期限内未完成 ${processingStatus}`);
}
async function setup() {
 directory=await mkdtemp(join(tmpdir(),'video-projects-test-'));
 const asset={id:sourceId,kind:'video' as const,name:'source.mp4',url:'https://owned.example/source.mp4',width:640,height:360,duration:5,fps:30,size:6};
 type Job=Awaited<ReturnType<Parameters<typeof createVideoProjectsRouter>[0]['job']>>;
 const jobs:Record<string,Record<string,unknown>>={};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as express.Request & {videoStaffId?:string}).videoStaffId=String(req.headers['x-test-user']||'alice');next();});
 app.use('/projects',createVideoProjectsRouter({directory,asset:async(_req,id)=>{if(id!==sourceId&&id!==assetId) throw Object.assign(new Error('无权访问'),{status:404});return{...asset,id};},store:async()=>({...asset,id:assetId}),job:async(_req,id)=>{if(!jobs[id]) throw Object.assign(new Error('不存在'),{status:404});return jobs[id] as unknown as Job;},findJob:async(_req,id)=>Object.values(jobs).find(job=>job.clientRequestId===id) as unknown as Job|undefined,download:async()=>new Response('video')}));
 app.use((err:Error & {status?:number},_req:express.Request,res:express.Response,next:express.NextFunction)=>{if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.message});});
 const created=await request(app).post('/projects').send({sourceAssetId:sourceId,name:'测试视频'});
 expect(created.status).toBe(202);
 const project=await waitForProcessing(app,created.body.id,'splitting');
 expect(project.status,project.error).toBe('review');
 return{app,project,jobs};
}
async function patchSegment(app:express.Express,url:string,body:Record<string,unknown>) {
 const project=(await request(app).get(url.split('/segments/')[0])).body;
 const segment=project.segments.find((entry:{id:string})=>entry.id===url.split('/').at(-1));
 return request(app).patch(url).send({expectedRevision:segment.revision||0,...body});
}
describe('video project ownership and approval workflow',()=>{
 it('persists scene clips and rejects other owners and premature assembly',async()=>{
  const{app,project}=await setup();expect(project.status).toBe('review');expect(project.segments).toHaveLength(1);
  expect((await request(app).get(`/projects/${project.id}`).set('x-test-user','bob')).status).toBe(404);
  expect((await request(app).post(`/projects/${project.id}/assemble`).send({})).status).toBe(409);
  expect((await request(app).patch(`/projects/${project.id}`).send({confirmed:true})).status).toBe(200);
  expect((await request(app).post(`/projects/${project.id}/assemble`).send({})).status).toBe(409);
 });
 it('verifies associated task reference and resets review when edits change',async()=>{
  const{app,project,jobs}=await setup();await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`;
  jobs[jobId]={id:jobId,status:'succeeded',videoUrl:'https://result.example/result.mp4',remake:{referenceAssetId:randomUUID()}};
  expect((await patchSegment(app,url,{jobId,useOriginal:false})).status).toBe(409);
  jobs[jobId]={id:jobId,status:'succeeded',videoUrl:'https://result.example/result.mp4',remake:{referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'海边',face:false,facePresence:'unknown'}};
  const linked=await patchSegment(app,url,{jobId,useOriginal:false,approved:true});expect(linked.status).toBe(200);expect(linked.body.segments[0].approved).toBe(true);
  const changed=await patchSegment(app,url,{remake:{referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'森林',face:false},useOriginal:false,clientRequestId:randomUUID()});
  expect(changed.status).toBe(200);expect(changed.body.segments[0]).toMatchObject({approved:false,useOriginal:false});expect(changed.body.segments[0].jobId).toBeUndefined();
 });
 it('retains paid task history when selecting the original and refuses destructive re-splitting',async()=>{
  const{app,project,jobs}=await setup();await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`;
  jobs[jobId]={id:jobId,status:'succeeded',videoUrl:'https://result.example/result.mp4',remake:{referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'海边',face:false}};
  expect((await patchSegment(app,url,{jobId,useOriginal:false})).status).toBe(200);
  const original=await patchSegment(app,url,{useOriginal:true,approved:true});
  expect(original.body.segments[0].jobHistory).toContain(jobId);
  expect((await request(app).post(`/projects/${project.id}/split`).send({})).status).toBe(409);
 });
 it('persists request identifiers and can clear an explicitly rejected request without a task',async()=>{
  const{app,project}=await setup();await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`,clientRequestId=randomUUID();
  await patchSegment(app,url,{clientRequestId,useOriginal:false});
  expect((await request(app).get(`/projects/${project.id}`)).body.segments[0].clientRequestId).toBe(clientRequestId);
  expect((await patchSegment(app,url,{clientRequestId:null})).body.segments[0].clientRequestId).toBeUndefined();
 });
 it('marks interrupted processing as failed and completes an explicitly reviewed original assembly',async()=>{
  const{app,project}=await setup();
  const file=join(directory,createHash('sha256').update('alice').digest('hex'),'projects',`${project.id}.json`);
  const saved=JSON.parse(await readFile(file,'utf8'));saved.status='splitting';saved.runId='previous-process';await writeFile(file,JSON.stringify(saved));
  const interrupted=await request(app).get(`/projects/${project.id}`);expect(interrupted.body.status).toBe('failed');expect(interrupted.body.error).toContain('服务重启');
  expect(JSON.parse(await readFile(file,'utf8')).status).toBe('splitting');
  await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  await patchSegment(app,`/projects/${project.id}/segments/${project.segments[0].id}`,{useOriginal:true,approved:true});
  const assembled=await request(app).post(`/projects/${project.id}/assemble`).send({});expect(assembled.status).toBe(202);
  const current=await waitForProcessing(app,project.id,'assembling');
  expect(current.status).toBe('completed');expect((await request(app).get(`/projects/${project.id}/download`)).status).toBe(200);
 });

 it('recovers an unlinked paid attempt before rejecting edits from another tab',async()=>{
  const{app,project,jobs}=await setup();expect((await request(app).patch(`/projects/${project.id}`).send({confirmed:true})).status).toBe(200);
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`,requestA=randomUUID(),requestB=randomUUID();
  const remake={referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'海边',face:false};
  expect((await patchSegment(app,url,{remake,clientRequestId:requestA,useOriginal:false})).status).toBe(200);
  jobs[jobId]={id:jobId,status:'pending',clientRequestId:requestA,remake};
  expect((await patchSegment(app,url,{remake:{...remake,backgroundDescription:'森林'},clientRequestId:requestB,useOriginal:false})).status).toBe(409);
  const recovered=(await request(app).get(`/projects/${project.id}`)).body.segments[0];
  expect(recovered.jobId).toBe(jobId);expect(recovered.jobHistory).toContain(jobId);expect(recovered.clientRequestId).toBe(requestA);
  expect((await patchSegment(app,url,{useOriginal:true})).status).toBe(409);
  expect((await patchSegment(app,url,{clientRequestId:requestB})).status).toBe(409);
 });

 it('requires revisions and rejects stale-tab edits without changing reviewed content',async()=>{
  const{app,project}=await setup();await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`;
  expect((await request(app).patch(url).send({useOriginal:true,approved:true})).status).toBe(409);
  const first=await patchSegment(app,url,{useOriginal:true,approved:true});expect(first.status).toBe(200);
  expect(first.body.segments[0].revision).toBe(1);
  expect((await request(app).patch(url).send({expectedRevision:0,useOriginal:false})).status).toBe(409);
  expect((await request(app).get(`/projects/${project.id}`)).body.segments[0].approved).toBe(true);
 });

 it('refuses re-splitting while any segment has an unresolved submit attempt',async()=>{
  const{app,project,jobs}=await setup();await request(app).patch(`/projects/${project.id}`).send({confirmed:true});
  const url=`/projects/${project.id}/segments/${project.segments[0].id}`,clientRequestId=randomUUID();
  await patchSegment(app,url,{clientRequestId,useOriginal:false});
  // Even before a submit response can be recovered, the old browser tab cannot discard the attempt.
  expect((await request(app).post(`/projects/${project.id}/split`).send({})).status).toBe(409);
  jobs[jobId]={id:jobId,status:'pending',clientRequestId,remake:{referenceAssetId:assetId}};
  expect((await request(app).post(`/projects/${project.id}/split`).send({})).status).toBe(409);
  const unchanged=(await request(app).get(`/projects/${project.id}`)).body;
  expect(unchanged.segments[0].id).toBe(project.segments[0].id);
  expect(unchanged.segments[0].clientRequestId).toBe(clientRequestId);
  delete jobs[jobId];
  // Only an explicitly rejected submit with no recorded task may clear its marker and retry cutting.
  expect((await patchSegment(app,url,{clientRequestId:null})).status).toBe(200);
  const recut=await request(app).post(`/projects/${project.id}/split`).send({});expect(recut.status).toBe(202);
  const current=await waitForProcessing(app,project.id,'splitting');
  expect(current.status).toBe('review');
 });

});
