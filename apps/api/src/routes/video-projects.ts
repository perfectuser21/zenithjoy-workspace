import {Router,type Request,type Response,type NextFunction} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {assembleProjectVideo,splitProjectVideo,validateVideoBoundaries} from '../services/video-project-media';
import {parseRemake,type RemakeConfig} from '../services/wan-remake-workflow';
interface OwnerRequest extends Request {videoStaffId?:string}
export interface ProjectAsset {id:string;url:string;kind:'video'|'image';name:string;width:number;height:number;duration:number;size:number;fps:number;createdAt?:string}
interface ProjectJob {id:string;clientRequestId?:string;status:string;videoUrl?:string;error?:string;remake?:RemakeConfig}
interface Segment {id:string;revision?:number;start:number;end:number;assetId:string;videoUrl?:string;remake?:RemakeConfig;jobId?:string;job?:ProjectJob;approved:boolean;useOriginal:boolean;clientRequestId?:string;jobHistory?:string[]}
interface Project {id:string;name:string;sourceAssetId:string;source:ProjectAsset;status:'splitting'|'review'|'editing'|'assembling'|'completed'|'failed';confirmed:boolean;segments:Segment[];createdAt:string;updatedAt:string;error?:string;outputAssetId?:string;outputUrl?:string;clientRequestId?:string;runId?:string}
interface Dependencies {directory:string;asset:(req:OwnerRequest,id:string)=>Promise<ProjectAsset>;store:(req:OwnerRequest,file:string,name:string,meta:{width:number;height:number;duration:number;size:number;fps:number})=>Promise<ProjectAsset>;job:(req:OwnerRequest,id:string)=>Promise<ProjectJob>;findJob?:(req:OwnerRequest,clientRequestId:string)=>Promise<ProjectJob|undefined>;download:(url:string,result:boolean)=>Promise<globalThis.Response>}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PROCESS_ID=randomUUID();
const activeOwners=new Map<string,{projectId:string;token:string}>();
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
const wrap=(fn:(req:OwnerRequest,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
export function createVideoProjectsRouter(deps:Dependencies) {
 const router=Router();
 const folder=(req:OwnerRequest)=>join(deps.directory,createHash('sha256').update(req.videoStaffId!).digest('hex'),'projects');
 const file=(req:OwnerRequest,id:string)=>{
  if(!uuid.test(id)) return fail(404,'项目不存在或无权访问');
  const root=resolve(folder(req));
  const path=resolve(root,`${id.replace(/[^a-zA-Z0-9-]/g,'')}.json`);
  if(!path.startsWith(root+sep)) return fail(404,'项目不存在或无权访问');
  return path;
 };
 async function save(req:OwnerRequest,project:Project){
  project.updatedAt=new Date().toISOString();await mkdir(folder(req),{recursive:true,mode:0o700});
  const path=file(req,project.id),temp=`${path}.${randomUUID()}.tmp`;
  // Only durable IDs/configuration are authoritative; URLs and task snapshots are refreshed on reads.
  const stored={...project,segments:project.segments.map(({job,videoUrl,...segment})=>segment)};
  await writeFile(temp,JSON.stringify(stored),{mode:0o600});await rename(temp,path);
 }
 async function load(req:OwnerRequest,id:string):Promise<Project>{
  let project:Project;
  try {project=JSON.parse(await readFile(file(req,id),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT') return fail(404,'项目不存在或无权访问');throw error;}
  if(['splitting','assembling'].includes(project.status) && (project.runId!==PROCESS_ID || !activeOwners.has(req.videoStaffId!))){project.status='failed';project.error='上次处理因服务重启中断，请重新分段或重新合成；已保存的素材仍可使用。';await save(req,project);}
  return project;
 }
 async function visible(req:OwnerRequest,project:Project){
  const source=await deps.asset(req,project.sourceAssetId);
  const segments=await Promise.all(project.segments.map(async segment=>{
   const asset=await deps.asset(req,segment.assetId);
   return{...segment,videoUrl:asset.url,...(segment.jobId?{job:await deps.job(req,segment.jobId)}:{})};
  }));
  const {runId,clientRequestId,...result}=project;
  return{...result,source,segments,...(project.outputAssetId?{outputUrl:(await deps.asset(req,project.outputAssetId)).url}:{})};
 }
 const locks=new Map<string,Promise<unknown>>();
 async function serialized<T>(req:OwnerRequest,fn:()=>Promise<T>):Promise<T>{
  const key=req.videoStaffId!,previous=locks.get(key)||Promise.resolve();let release!:()=>void;
  const current=new Promise<void>(done=>{release=done;});locks.set(key,current);await previous;
  try{return await fn();}finally{release();if(locks.get(key)===current)locks.delete(key);}
 }
 async function download(url:string,path:string,result=false,budget={bytes:0}){
  const response=await deps.download(url,result);
  if(!response.ok||!response.body) return fail(410,'素材读取失败，请重新连接或上传');
  let bytes=0;const maximum=(result?200:100)*1024*1024;
  const limiter=new Transform({transform(chunk:Buffer,_enc,next){bytes+=chunk.length;budget.bytes+=chunk.length;next(bytes>maximum||budget.bytes>512*1024*1024?new Error('素材文件过大，无法处理'):null,chunk);}});
  await pipeline(Readable.fromWeb(response.body as never),limiter,createWriteStream(path,{mode:0o600,flags:'wx'}),{signal:AbortSignal.timeout(120000)});
  if(!bytes) fail(422,'素材文件为空');
 }
 function checkIdle(req:OwnerRequest,project?:Project){
  if(activeOwners.size>=2 && !activeOwners.has(req.videoStaffId!)) fail(429,'视频处理繁忙，请稍后重试');
  const active=activeOwners.get(req.videoStaffId!);
  if(active && (!project || active.projectId!==project.id || ['splitting','assembling'].includes(project.status))) fail(409,'另一个视频正在分段或合成，请等待完成');
  if(project && ['splitting','assembling'].includes(project.status)) fail(409,'视频正在处理中，请稍后再修改');
 }
 function start(req:OwnerRequest,project:Project,operation:(dir:string)=>Promise<void>){
  const token=randomUUID();activeOwners.set(req.videoStaffId!,{projectId:project.id,token});
  const release=()=>{if(activeOwners.get(req.videoStaffId!)?.token===token)activeOwners.delete(req.videoStaffId!);};
  void (async()=>{let directory:string|undefined;try{
   directory=await mkdtemp(join(tmpdir(),'video-project-'));await operation(directory);await save(req,project);release();
  }catch(error){project.status='failed';project.error=error instanceof Error?error.message:'处理失败，请重试';await save(req,project);release();}
  finally{release();if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});}})().catch(error=>{console.error('[video-project] failed to persist processing result',error instanceof Error?error.message:'unknown');});
 }
 async function split(req:OwnerRequest,project:Project,cuts?:number[]){
  const source=await deps.asset(req,project.sourceAssetId);
  if(source.kind!=='video'||source.duration<1||source.duration>120||source.size>100*1024*1024||Math.min(source.width,source.height)<240||Math.max(source.width,source.height)>4096) fail(400,'请上传 1 至 120 秒且不超过 100 MB 的完整视频');
  if(cuts!==undefined) validateVideoBoundaries(source.duration,cuts);
  project.status='splitting';project.runId=PROCESS_ID;project.confirmed=false;delete project.error;delete project.outputAssetId;
  await save(req,project);
  start(req,project,async dir=>{
   const path=join(dir,'source');await download(source.url,path);
   const clips=await splitProjectVideo(path,dir,source.duration,cuts);
   const segments:Segment[]=[];
   for(const clip of clips){const asset=await deps.store(req,clip.file,`分镜-${segments.length+1}.mp4`,clip.metadata);segments.push({id:randomUUID(),revision:0,start:clip.start,end:clip.end,assetId:asset.id,approved:false,useOriginal:true});}
   project.segments=segments;project.status='review';
  });
 }
 router.get('/',wrap(async(req,res)=>{
  const names=await readdir(folder(req)).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return[];throw error;});
  const projects=await Promise.all(names.filter(name=>/^[a-f0-9-]+\.json$/i.test(name)).map(async name=>visible(req,await load(req,name.slice(0,-5)))));
  res.json({projects:projects.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50)});
 }));
 router.post('/',wrap(async(req,res)=>serialized(req,async()=>{
  const body=req.body||{};
  if(!uuid.test(body.sourceAssetId||'')) fail(400,'请先上传完整视频');
  if(body.clientRequestId!==undefined && (typeof body.clientRequestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.clientRequestId)))fail(400,'创建请求标识无效');
  const names=await readdir(folder(req)).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return[];throw error;});
  for(const name of names.filter(n=>/^[a-f0-9-]+\.json$/i.test(n))){const old=await load(req,name.slice(0,-5));if(body.clientRequestId&&old.clientRequestId===body.clientRequestId){if(old.sourceAssetId!==body.sourceAssetId)fail(409,'原片已变化，请重新创建');res.status(202).json(await visible(req,old));return;}}
  checkIdle(req);
  const source=await deps.asset(req,body.sourceAssetId);
  const name=typeof body.name==='string'?body.name.trim().slice(0,100):source.name;
  const project:Project={id:randomUUID(),name:name||'我的视频',sourceAssetId:source.id,source,status:'splitting',confirmed:false,segments:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),clientRequestId:body.clientRequestId};
  await split(req,project);res.status(202).json(await visible(req,project));
 })));
 router.get('/:id',wrap(async(req,res)=>res.json(await visible(req,await load(req,req.params.id)))));
 router.post('/:id/split',wrap(async(req,res)=>serialized(req,async()=>{
  const project=await load(req,req.params.id);checkIdle(req,project);
  if(project.segments.some(s=>s.clientRequestId))fail(409,'有分段的生成请求尚未确认，请先恢复原任务；明确提交失败并清除请求标识后才能重新分段');
  if(project.segments.some(s=>s.jobId || s.jobHistory?.length))fail(409,'已有生成结果，请新建项目后重新切段，避免丢失已付费结果');
  const cuts=req.body?.boundaries;if(cuts!==undefined&&!Array.isArray(cuts))fail(400,'切点格式无效');
  await split(req,project,cuts);res.status(202).json(await visible(req,project));
 })));
 router.patch('/:id',wrap(async(req,res)=>serialized(req,async()=>{
  const project=await load(req,req.params.id);checkIdle(req,project);
  if(req.body?.confirmed!==true||!project.segments.length)fail(400,'请先检查完整分段后确认');
  project.confirmed=true;project.status='editing';delete project.error;await save(req,project);res.json(await visible(req,project));
 })));
 router.patch('/:id/segments/:segmentId',wrap(async(req,res)=>serialized(req,async()=>{
  const project=await load(req,req.params.id);checkIdle(req,project);if(!project.confirmed)fail(409,'请先确认分段');
  const segment=project.segments.find(s=>s.id===req.params.segmentId);if(!segment)fail(404,'分段不存在');
  const body=req.body||{};
  if(!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision!==(segment.revision||0))fail(409,'此分段已在其他页面更新，请刷新后继续');
  // A browser may lose the submit response after the provider accepted it.
  // Recover that paid attempt before considering any replacement configuration.
  let currentJob=segment.jobId?await deps.job(req,segment.jobId):undefined;
  if(!currentJob&&segment.clientRequestId&&deps.findJob){
    const recovered=await deps.findJob(req,segment.clientRequestId);
    if(recovered){
      if(!recovered.remake||recovered.remake.referenceAssetId!==segment.assetId)fail(409,'生成请求与当前分段不一致，请联系管理员核对');
      segment.jobId=recovered.id;segment.jobHistory=[...new Set([...(segment.jobHistory||[]),recovered.id])];segment.useOriginal=false;segment.approved=false;segment.revision=(segment.revision||0)+1;
      await save(req,project);currentJob=recovered;
    }
  }
  if(!currentJob&&segment.clientRequestId&&body.clientRequestId!==null){
    const changesUnconfirmedAttempt=body.useOriginal===true||(body.clientRequestId!==undefined&&body.clientRequestId!==segment.clientRequestId)||(body.remake!==undefined&&JSON.stringify(parseRemake(body.remake))!==JSON.stringify(segment.remake));
    if(changesUnconfirmedAttempt)fail(409,'上次生成请求尚未确认，请先按原请求恢复；明确提交失败后才能清除请求标识');
  }
  if(currentJob&&['pending','running','unknown'].includes(currentJob.status)){
    const changesAttempt=(body.useOriginal===true)||(body.clientRequestId!==undefined&&body.clientRequestId!==segment.clientRequestId)||(body.jobId!==undefined&&body.jobId!==currentJob.id)||(body.remake!==undefined&&JSON.stringify(parseRemake(body.remake))!==JSON.stringify(segment.remake));
    if(changesAttempt)fail(409,'此分段的生成任务仍在处理中或状态待确认，请先恢复原任务结果');
  }
  const next={...segment};
  if(body.remake!==undefined){const remake=parseRemake(body.remake);if(remake.referenceAssetId!==segment.assetId)fail(409,'修改素材与当前分段不一致');if(JSON.stringify(remake)!==JSON.stringify(next.remake)){next.approved=false;delete next.jobId;delete next.clientRequestId;}next.remake=remake;next.useOriginal=false;}
  if(body.useOriginal!==undefined){if(typeof body.useOriginal!=='boolean')fail(400,'请选择是否保留原片');if(next.useOriginal!==body.useOriginal)next.approved=false;next.useOriginal=body.useOriginal;if(body.useOriginal){delete next.remake;delete next.jobId;delete next.clientRequestId;next.approved=false;}}
  if(body.clientRequestId===null){
    if(segment.jobId || (segment.clientRequestId && (!deps.findJob || await deps.findJob(req,segment.clientRequestId))))fail(409,'此请求已有生成任务，请按原请求继续查询并关联结果');
    delete next.clientRequestId;
  } else if(body.clientRequestId!==undefined){if(typeof body.clientRequestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.clientRequestId))fail(400,'生成请求标识无效');if(next.clientRequestId!==body.clientRequestId){delete next.jobId;next.approved=false;}next.clientRequestId=body.clientRequestId;}
  if(body.jobId!==undefined){if(!uuid.test(body.jobId))fail(400,'生成任务无效');const job=await deps.job(req,body.jobId);if(segment.clientRequestId&&job.clientRequestId!==segment.clientRequestId)fail(409,'生成任务属于旧版本，请刷新当前分段后继续');if(!job.remake||job.remake.referenceAssetId!==segment.assetId)fail(409,'生成任务与当前分段不一致');if(next.remake && JSON.stringify(parseRemake(job.remake))!==JSON.stringify(next.remake))fail(409,'生成任务与当前修改设置不一致');next.remake=parseRemake(job.remake);next.jobHistory=[...new Set([...(next.jobHistory||[]),job.id])];next.jobId=job.id;next.useOriginal=false;next.approved=false;}
  if(body.approved!==undefined){if(typeof body.approved!=='boolean')fail(400,'审核状态无效');if(body.approved&&!next.useOriginal){if(!next.jobId)fail(409,'请先生成并预览此分段');const job=await deps.job(req,next.jobId);if(job.status!=='succeeded'||!job.videoUrl)fail(409,'此分段尚未生成成功，请稍后审核');}next.approved=body.approved;}
  next.revision=(segment.revision||0)+1;project.segments[project.segments.indexOf(segment)]=next;project.status='editing';delete project.outputAssetId;delete project.error;await save(req,project);res.json(await visible(req,project));
 })));
 router.post('/:id/assemble',wrap(async(req,res)=>serialized(req,async()=>{
  const project=await load(req,req.params.id);checkIdle(req,project);
  if(!project.confirmed||!project.segments.length||project.segments.some(s=>!s.approved))fail(409,'请先逐段审核通过，再合成成片');
  const inputs:Array<{url:string;result:boolean;duration:number}>=[];
  for(const segment of project.segments){if(segment.useOriginal)inputs.push({url:(await deps.asset(req,segment.assetId)).url,result:false,duration:segment.end-segment.start});else{if(!segment.jobId)fail(409,'有分段尚未生成');const job=await deps.job(req,segment.jobId);if(job.status!=='succeeded'||!job.videoUrl)fail(409,'有分段尚未生成成功');inputs.push({url:job.videoUrl,result:true,duration:segment.end-segment.start});}}
  const source=await deps.asset(req,project.sourceAssetId);
  project.status='assembling';project.runId=PROCESS_ID;delete project.error;await save(req,project);
  start(req,project,async dir=>{
   const sourcePath=join(dir,'source'),budget={bytes:0};await download(source.url,sourcePath,false,budget);
   const clips=[];for(let i=0;i<inputs.length;i++){const path=join(dir,`input-${i}`);await download(inputs[i].url,path,inputs[i].result,budget);clips.push({file:path,duration:inputs[i].duration});}
   const output=join(dir,'output.mp4');const meta=await assembleProjectVideo(sourcePath,clips,output,source);
   const asset=await deps.store(req,output,'完整成片.mp4',meta);project.outputAssetId=asset.id;project.status='completed';
  });res.status(202).json(await visible(req,project));
 })));
 router.get('/:id/download',wrap(async(req,res)=>{
  const project=await load(req,req.params.id);if(project.status!=='completed'||!project.outputAssetId)fail(409,'成片尚未准备好');
  const asset=await deps.asset(req,project.outputAssetId),response=await deps.download(asset.url,false);
  if(!response.ok||!response.body)fail(410,'成片链接已失效，请重试');
  res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Disposition',`attachment; filename="video-${project.id}.mp4"`);res.setHeader('Cache-Control','private, no-store');
  await pipeline(Readable.fromWeb(response.body as never),res,{signal:AbortSignal.timeout(120000)});
 }));
 return router;
}
