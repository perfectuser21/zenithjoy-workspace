import express from 'express';
import request from 'supertest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {createVideoProjectsRouter} from '../video-projects';
const reads=vi.hoisted(()=>({path:'',captured:()=>{},resume:Promise.resolve()}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,readFile:async(path:Parameters<typeof actual.readFile>[0],options:Parameters<typeof actual.readFile>[1])=>{
  const snapshot=await actual.readFile(path,options);
  if(String(path)===reads.path){reads.path='';reads.captured();await reads.resume;}
  return snapshot;
 }};
});
vi.mock('../../services/video-project-media',()=>({
 validateVideoBoundaries:()=>[],
 splitProjectVideo:async(_source:string,dir:string)=>{const file=join(dir,'clip.mp4');await writeFile(file,'clip');return[{start:0,end:5,file,metadata:{width:640,height:360,duration:5,fps:30,size:4}}];},
 assembleProjectVideo:vi.fn(),
}));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
interface Snapshot{id:string;status:string;segments:Array<{id:string}>}
async function waitForReview(app:express.Express,id:string):Promise<Snapshot>{
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const result=await request(app).get(`/projects/${id}`);expect(result.status).toBe(200);
  if(result.body.status!=='splitting'){expect(result.body.status,result.body.error).toBe('review');return result.body;}
  await new Promise<void>(done=>setImmediate(done));
 }
 throw new Error('项目未在期限内完成分段');
}
describe('video project lifecycle reads',()=>{
 it('does not overwrite completed work when an earlier processing read resolves after the worker releases its owner',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'video-project-read-race-'));
  const sourceId=randomUUID(),clipId=randomUUID(),store=deferred(),captured=deferred(),resume=deferred(),oldRunCaptured=deferred(),oldRunResume=deferred();
  const asset={id:sourceId,kind:'video' as const,name:'source.mp4',url:'https://owned.example/source.mp4',width:640,height:360,duration:5,fps:30,size:6};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as express.Request & {videoStaffId:string}).videoStaffId='lifecycle-reader';next();});
  app.use('/projects',createVideoProjectsRouter({directory,asset:async(_req,id)=>({...asset,id}),store:async()=>{await store.promise;return{...asset,id:clipId};},job:async()=>{throw new Error('no jobs');},download:async()=>new Response('video')}));
  app.use((error:Error & {status?:number},req:express.Request,res:express.Response,next:express.NextFunction)=>{if(res.headersSent||req.destroyed)return next(error);res.status(error.status||500).json({error:error.message});});
  try {
   const created=await request(app).post('/projects').send({sourceAssetId:sourceId});expect(created.status).toBe(202);
   const id=created.body.id;
   reads.path=join(directory,createHash('sha256').update('lifecycle-reader').digest('hex'),'projects',`${id}.json`);reads.captured=captured.resolve;reads.resume=resume.promise;
   // Capture the actual on-disk splitting snapshot, then hold that read in flight.
   const oldRead=request(app).get(`/projects/${id}`).then(response=>response);
   await captured.promise;store.resolve();
   const completed=await waitForReview(app,id);expect(completed.segments).toHaveLength(1);
   // The worker is now done and its owner is released. Return the old syscall snapshot.
   resume.resolve();const stale=await oldRead;
   expect(stale.body.status).toBe('splitting');
   const latest=await waitForReview(app,id);expect(latest.segments).toHaveLength(1);
   const persisted=JSON.parse(await readFile(join(directory,createHash('sha256').update('lifecycle-reader').digest('hex'),'projects',`${id}.json`),'utf8'));
   expect(persisted.status).toBe('review');
   // Repeat across a genuine prior-process record: another request starts a new
   // run while the old GET still holds its original snapshot.
   const path=join(directory,createHash('sha256').update('lifecycle-reader').digest('hex'),'projects',`${id}.json`);
   await writeFile(path,JSON.stringify({...persisted,status:'splitting',runId:'previous-process'}));
   reads.path=path;reads.captured=oldRunCaptured.resolve;reads.resume=oldRunResume.promise;
   const oldProcessRead=request(app).get(`/projects/${id}`).then(response=>response);
   await oldRunCaptured.promise;
   expect((await request(app).post(`/projects/${id}/split`).send({})).status).toBe(202);
   await waitForReview(app,id);
   oldRunResume.resolve();expect((await oldProcessRead).body.status).toBe('failed');
   expect((await waitForReview(app,id)).segments).toHaveLength(1);

  }finally{reads.path='';store.resolve();resume.resolve();oldRunResume.resolve();await rm(directory,{recursive:true,force:true});}
 });
});
