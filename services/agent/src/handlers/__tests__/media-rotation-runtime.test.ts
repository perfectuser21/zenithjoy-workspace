import {describe,it,expect,afterEach} from 'vitest';import {spawnSync} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer,type Server} from 'node:http';
import {rotationToTranspose,recoverStaleJobs,runFfmpeg} from '../video-pipeline';
let dir:string;let server:Server;afterEach(async()=>{if(dir)rmSync(dir,{recursive:true,force:true});if(server)await new Promise<void>(r=>server.close(()=>r()));});
function run(binary:string,args:string[]){const r=spawnSync(binary,args,{encoding:'utf8'});if(r.error)throw Object.assign(new Error(`${binary} is required for real pixel normalization: ${r.error.message}`),{cause:r.error});expect(r.status,r.stderr).toBe(0);return r.stdout;}
describe('current orientation normalization and stale recovery runtime',()=>{
 it.each([[-90,'display_matrix','transpose=1'],[90,'display_matrix','transpose=2'],[90,'legacy_tag','transpose=1'],[270,'legacy_tag','transpose=2'],[180,'legacy_tag','hflip,vflip'],[90,'none','']])('maps signed %s %s to filter %s',(signed,source,filter)=>{expect(rotationToTranspose(signed as number,source as any)).toBe(filter);});
 it('normalizes real pixels through production argv execution with shell-looking filenames',async()=>{
  dir=mkdtempSync(join(tmpdir(),'zj-rotation-'));const input=join(dir,'in $(printf injected) & %PATH%.mp4'),output=join(dir,'out & literal.mp4');
  run('ffmpeg',['-f','lavfi','-i','testsrc=duration=0.3:size=96x64:rate=10','-pix_fmt','yuv420p','-y',input]);
  await runFfmpeg(['-noautorotate','-i',input,'-vf',rotationToTranspose(-90,'display_matrix'),'-metadata:s:v:0','rotate=0','-pix_fmt','yuv420p','-y',output]);
  const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',output]));expect(probe.streams[0]).toMatchObject({width:64,height:96});
 });
 it('uses real HTTP with license and fails only the returned stale job',async()=>{
  const calls:any[]=[];server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({url:req.url,headers:req.headers,body:body?JSON.parse(body):null});res.setHeader('Content-Type','application/json');res.end(req.method==='GET'?'{"data":[{"id":"stale-owned"}]}':'{}');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));await recoverStaleJobs(`http://127.0.0.1:${(server.address()as any).port}`,'fixture-license');
  expect(calls.map(c=>c.url)).toEqual(['/api/ai-video/jobs?status=processing&stale_minutes=5','/api/ai-video/jobs/stale-owned/progress']);expect(calls[0].headers.authorization).toBe('Bearer fixture-license');expect(calls[1].body).toEqual({status:'failed',progress:0});
 });
});
