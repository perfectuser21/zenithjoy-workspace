import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
// Resolve execFile only when media work runs; unrelated API imports must not
// initialize subprocess machinery (or require it from unrelated test mocks).
const run = (command:string,args:string[],options:{timeout:number;maxBuffer:number}) => promisify(execFile)(command,args,options);
const MAX_OUTPUT = 200 * 1024 * 1024;
export interface VideoSpan { start: number; end: number }
function invalid(message: string): never { throw Object.assign(new Error(message), {status:400}); }
function durationCheck(duration: number) {
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) invalid('请上传 1 至 120 秒的视频');
}
export function validateVideoBoundaries(duration: number, cuts: unknown): VideoSpan[] {
  durationCheck(duration);
  if (!Array.isArray(cuts) || cuts.length > 120) return invalid('分段切点无效');
  const points = [0, ...cuts, duration];
  return points.slice(1).map((end, index) => {
    const start = points[index];
    if (typeof end !== 'number' || typeof start !== 'number' || !Number.isFinite(end) || end-start < 1-1e-7 || end-start >= 15) return invalid('每段须至少 1 秒且小于 15 秒，切点须按时间递增');
    return {start,end};
  });
}
export function planVideoSegments(duration: number, detected: number[]): VideoSpan[] {
  durationCheck(duration);
  const points=[0];
  for(const cut of [...detected].sort((a,b)=>a-b)) if(Number.isFinite(cut) && cut-points[points.length-1]>=1 && duration-cut>=1) points.push(cut);
  points.push(duration);
  const result:VideoSpan[]=[];
  for(let index=1; index<points.length; index++) {
    const start=points[index-1], end=points[index], count=Math.ceil((end-start)/14.5);
    for(let part=0;part<count;part++) result.push({start:Number((start+(end-start)*part/count).toFixed(6)),end:part===count-1?end:Number((start+(end-start)*(part+1)/count).toFixed(6))});
  }
  return result;
}
async function ffmpeg(args:string[], timeout=120000) {
  try { return await run('ffmpeg',['-nostdin','-hide_banner','-y',...args],{timeout,maxBuffer:4*1024*1024}); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT') throw Object.assign(new Error('视频处理服务尚未配置，请联系管理员'),{status:503});
    throw Object.assign(new Error('视频处理失败或超时，请重试；原素材仍然保留'),{status:422});
  }
}
export async function probeVideo(path:string) {
  const result=await run('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height,sample_aspect_ratio:format=duration','-of','json',path],{timeout:15000,maxBuffer:32768});
  const body=JSON.parse(result.stdout), video=body.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
  if(!video || !Number.isFinite(Number(body.format?.duration))) throw new Error('无法读取视频');
  const [numerator,denominator]=String(video.sample_aspect_ratio||'1:1').split(':').map(Number);
  const sar=numerator>0&&denominator>0?numerator/denominator:1;
  return {width:Number(video.width),height:Number(video.height),duration:Number(body.format.duration),sar};
}
function displaySize(meta:{width:number;height:number;sar:number}) {
  const displayWidth=meta.width*meta.sar,scale=Math.min(1,4096/displayWidth,4096/meta.height);
  if(!Number.isFinite(displayWidth)||displayWidth<=0||displayWidth/meta.height>8||meta.height/displayWidth>8) throw new Error('原片显示比例超出支持范围，请导出为标准视频后重试');
  return {width:Math.max(2,Math.round(displayWidth*scale/2)*2),height:Math.max(2,Math.round(meta.height*scale/2)*2)};
}
async function validOutput(path:string, expected:number) {
  const size=(await stat(path)).size;
  if(size<=0 || size>=MAX_OUTPUT) throw new Error('视频输出大小超出限制');
  const meta=await probeVideo(path);
  if(Math.abs(meta.duration-expected)>0.18) throw new Error('视频时长校验失败，请重试');
  return { ...meta,size,fps:30 };
}
export async function splitProjectVideo(source:string, directory:string, duration:number, cuts?:number[]) {
  const sourceMeta=await probeVideo(source);
  const display=displaySize(sourceMeta);
  let spans:VideoSpan[];
  if(cuts) spans=validateVideoBoundaries(duration,cuts);
  else {
    const detection=await ffmpeg(['-i',source,'-vf',"scale=320:-2,select='gt(scene,0.35)',showinfo",'-an','-f','null','-']);
    const detected=[...detection.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match=>Number(match[1]));
    spans=planVideoSegments(duration,detected);
  }
  const clips=[];
  let totalBytes=0;
  for(let index=0;index<spans.length;index++) {
    const span=spans[index], file=join(directory,`clip-${index}.mp4`);
    await ffmpeg(['-ss',String(span.start),'-i',source,'-t',String(span.end-span.start),'-map','0:v:0','-vf',`fps=30,scale=${display.width}:${display.height},setsar=1`,'-an','-c:v','libx264','-preset','veryfast','-crf','20','-movflags','+faststart','-fs',String(MAX_OUTPUT),file]);
    const metadata=await validOutput(file,span.end-span.start);
    totalBytes+=metadata.size;if(totalBytes>400*1024*1024) throw new Error('分段输出过大，请降低原片分辨率后重试');
    if(metadata.duration>=15 || metadata.duration<1) throw new Error('切段时长不符合生成要求，请调整切点');
    clips.push({...span,file,metadata});
  }
  return clips;
}
export async function assembleProjectVideo(source:string, clips:Array<{file:string;duration:number}>, output:string, meta:{width:number;height:number;duration:number}) {
  const args:string[]=[];
  for(const [index,clip] of clips.entries()) {
    const actual=await probeVideo(clip.file);
    if(Math.abs(actual.duration-clip.duration)>0.25) throw new Error(`第 ${index+1} 段生成时长与原片不一致，请重新生成该段后合成`);
    args.push('-i',clip.file);
  }
  args.push('-i',source);
  const {width,height}=displaySize(await probeVideo(source));
  const filters=clips.map((clip,i)=>`[${i}:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration},setpts=PTS-STARTPTS[v${i}]`);
  filters.push(clips.map((_,i)=>`[v${i}]`).join('')+`concat=n=${clips.length}:v=1:a=0[out]`);
  await ffmpeg([...args,'-filter_complex',filters.join(';'),'-map','[out]','-map',`${clips.length}:a:0?`,'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-t',String(meta.duration),'-movflags','+faststart','-fs',String(MAX_OUTPUT),output],180000);
  return validOutput(output,meta.duration);
}
