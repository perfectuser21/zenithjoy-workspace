import express from 'express';
import request from 'supertest';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { createVideoProjectsRouter } from '../video-projects';
vi.mock('../../services/video-project-media',()=>({
  validateVideoBoundaries:(duration:number,cuts:number[])=>{if(cuts.includes(99)) throw Object.assign(new Error('无效切点'),{status:400});return[];},
  splitProjectVideo:async(_source:string,dir:string)=>{const file=join(dir,'clip.mp4');await writeFile(file,'clip');return[{start:0,end:5,file,metadata:{width:640,height:360,duration:5,fps:30,size:4}}];},
  assembleProjectVideo:async(_source:string,_clips:unknown,output:string)=>{await writeFile(output,'output');return{width:640,height:360,duration:5,fps:30,size:6};},
}));
const sourceId=randomUUID(),assetId=randomUUID(),jobId=randomUUID();
let directory:string;
afterEach(async()=>{if(directory) await rm(directory,{recursive:true,force:true});});
async function setup() {
 directory=await mkdtemp(join(tmpdir(),'video-projects-test-'));
 const asset={id:sourceId,kind:'video',name:'source.mp4',url:'https://owned.example/source.mp4',width:640,height:360,duration:5,fps:30,size:6};
 const jobs:Record<string,unknown>={};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).videoStaffId=req.headers['x-test-user']||'alice';next();});
 app.use('/projects',createVideoProjectsRouter({directory,asset:async(_req,id)=>{if(id!==sourceId&&id!==assetId) throw Object.assign(new Error('无权访问'),{status:404});return{...asset,id};},store:async()=>({...asset,id:assetId}),job:async(_req,id)=>{if(!jobs[id]) throw Object.assign(new Error('不存在'),{status:404});return jobs[id] as any;},download:async()=>new Response('video')}));
 app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||500).json({error:err.message}));
 const get=(url:string)=>request(app).get(url);
 const created=await request(app).post('/projects').send({sourceAssetId:sourceId,name:'测试视频'});
 expect(created.status).toBe(202);
 let project=created.body;
 for(let n=0;n<50&&project.status==='splitting';n++){await new Promise(done=>setTimeout(done,2));project=(await get(`/projects/${project.id}`)).body;}
 return{app,project,jobs};
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
  expect((await request(app).patch(url).send({jobId,useOriginal:false})).status).toBe(409);
  jobs[jobId]={id:jobId,status:'succeeded',videoUrl:'https://result.example/result.mp4',remake:{referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'海边',face:false,facePresence:'unknown'}};
  const linked=await request(app).patch(url).send({jobId,useOriginal:false,approved:true});expect(linked.status).toBe(200);expect(linked.body.segments[0].approved).toBe(true);
  const changed=await request(app).patch(url).send({remake:{referenceAssetId:assetId,productMode:'keep',background:true,backgroundDescription:'森林',face:false},useOriginal:false,clientRequestId:randomUUID()});
  expect(changed.status).toBe(200);expect(changed.body.segments[0]).toMatchObject({approved:false,useOriginal:false});expect(changed.body.segments[0].jobId).toBeUndefined();
 });
});
