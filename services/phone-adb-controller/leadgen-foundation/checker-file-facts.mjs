// File provenance and media parsing only. No qualification, coverage or delivery verdict.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{spawn}from'node:child_process';
const hash=x=>createHash('sha256').update(x).digest('hex'),need=x=>{if(!x)throw Error('FACT_FILE_SCOPE');},UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function regular(file,max=4*1024*1024,executable=false){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&(executable?((s.uid===process.getuid()||s.uid===0)&&(s.mode&0o022)===0):s.uid===process.getuid())&&s.nlink===1&&s.size<=max&&fs.realpathSync(file)===file);return s;}
function document(file){regular(file);const bytes=fs.readFileSync(file);return{sha256:hash(bytes),data:JSON.parse(bytes)};}
function directory(file){need(path.isAbsolute(file)&&fs.realpathSync(file)===file&&fs.statSync(file).isDirectory());return file;}
function historicalVisualFacts(host,{scope,visual_evidence:visual}){
 if(!visual)return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_NOT_RECORDED'};
 const {sha256,...record}=visual;
 const frames=record.frames;
 if(sha256!==scope.visual_evidence_sha256||hash(JSON.stringify(record))!==sha256||
    ['run_id','task_id','video_id'].some(key=>record[key]!==scope[key])||
    !/^[a-f0-9]{64}$/.test(record.coverage_sha256??'')||
    !Array.isArray(frames)||frames.length<1||frames.length>3||
    new Set(frames.map(frame=>frame?.label)).size!==frames.length||
    frames.some(frame=>!frame||typeof frame.label!=='string'||!/^[A-E]$/.test(frame.label)||
      !Number.isFinite(frame.pts_seconds)||frame.pts_seconds<0||
      typeof frame.sha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.sha256))){
  return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_RECORD_INVALID'};
 }
 const visual_frames=[];
 try{
  const receipts=directory(path.join(host,'receipts'));
  const coverage=document(path.join(receipts,'coverage-five-frames.json'));
  if(coverage.sha256!==record.coverage_sha256||!Array.isArray(coverage.data?.panels)){
   return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_COVERAGE_MISMATCH'};
  }
  for(const {label,pts_seconds,sha256:expected} of frames){
   const matches=coverage.data.panels.filter(panel=>panel?.label===label);
   const panel=matches[0];
   if(matches.length!==1||panel.pts_seconds!==pts_seconds||panel.sha256!==expected||
      typeof panel.frame!=='string'||!/^receipts\/[A-Za-z0-9][A-Za-z0-9_.-]{0,239}\.png$/.test(panel.frame)){
    return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_COVERAGE_MISMATCH'};
   }
   const file=path.join(host,panel.frame);
   regular(file,3*1024*1024);
   const bytes=fs.readFileSync(file);
   if(hash(bytes)!==expected||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'){
    return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_BYTES_MISMATCH'};
   }
   visual_frames.push({label,pts_seconds,sha256:expected,bytes:bytes.length});
  }
 }catch{
  return {visual_evidence_read:false,visual_error:'ORIGIN_VISUAL_FILE_UNAVAILABLE'};
 }
 return {visual_evidence_read:true,visual_frames};
}
export async function readQualificationOrigin(c,run,video,brainGet){
 need(UUID.test(run)&&/^\d{16,24}$/.test(video));const root=directory(c.foundation_state_root),dir=directory(path.join(root,run)),manifest=document(path.join(dir,'manifest.json')),m=manifest.data;
 need(m.run?.run_id===run&&UUID.test(m.run.task_id)&&/^[a-f0-9]{64}$/.test(m.run.definition_sha256??''));
 const bundle=directory(path.join(dir,'bundle'));need(fs.realpathSync(m.profile?.cwd)===bundle);
 const response=await brainGet('/tasks/'+m.run.task_id,c),task=response.task??response,registered=task.result?.foundation_runner?.run;
 need(task.id===m.run.task_id&&registered?.task_id===m.run.task_id&&registered.run_id===run&&registered.definition_sha256===m.run.definition_sha256);
 const host=directory(path.join(bundle,'.leadgen-run/host')),context=document(path.join(host,'context.json')),old=context.data;
 for(const key of ['company_id','tenant_id','line'])need(old[key]===c[key]);
 need(old.tasks?.['102']?.task_id===m.run.task_id&&old.tasks['102'].run_id===run&&old.verification?.['102']?.video_ids?.includes(video));
 const evidence=directory(path.join(host,'qualification-receipts',video)),journal=document(path.join(evidence,'journal.json')),s=journal.data.scope;
 need(s&&s.task_id===m.run.task_id&&s.run_id===run&&s.run===run&&s.video_id===video);
 for(const key of ['company_id','tenant_id','line'])need(s[key]===c[key]);need(/^[a-f0-9]{64}$/.test(s.audio_sha256??''));
 const documents={'journal.json':journal};for(const name of ['asr-response.json','judge-response.json'])if(fs.existsSync(path.join(evidence,name)))documents[name]=document(path.join(evidence,name));
 return{origin:{task_id:m.run.task_id,run_id:run,video_id:video,company_id:c.company_id,tenant_id:c.tenant_id,line:c.line},manifest_sha256:manifest.sha256,context_sha256:context.sha256,documents,observed_at:new Date().toISOString(),...historicalVisualFacts(host,journal.data)};
}
export async function readMediaFacts(root,name,tool){
 directory(root);need(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,239}\.(mkv|mp4|wav|webm|mp3|m4a)$/.test(name));const file=path.join(root,name),before=regular(file,512*1024*1024);
 need(tool&&path.isAbsolute(tool.path)&&/^[a-f0-9]{64}$/.test(tool.sha256));regular(tool.path,128*1024*1024,true);need(hash(fs.readFileSync(tool.path))===tool.sha256);
 const metadata=await new Promise((resolve,reject)=>{let output='',settled=false;const child=spawn(tool.path,['-v','error','-protocol_whitelist','file','-show_streams','-show_format','-of','json',file],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});
  const fail=()=>{if(!settled){settled=true;child.kill('SIGKILL');reject(Error('FACT_MEDIA_UNAVAILABLE'));}};const timer=setTimeout(fail,10000);child.on('error',fail);child.stderr.resume();child.stdout.on('data',b=>{output+=b;if(Buffer.byteLength(output)>1024*1024)fail();});child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;try{need(code===0);resolve(JSON.parse(output));}catch(e){reject(e);}});
 });
 const after=regular(file,512*1024*1024);need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]));const sha256=hash(fs.readFileSync(file));const final=fs.statSync(file);need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>after[k]===final[k]));return{name,sha256,bytes:after.size,metadata,observed_at:new Date().toISOString()};
}
