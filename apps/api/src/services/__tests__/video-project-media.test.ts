import { describe, expect, it } from 'vitest';
import { planVideoSegments, validateVideoBoundaries } from '../video-project-media';
describe('video project scene segmentation', () => {
  it('retains detected scene cuts and covers every second with legal reference clips', () => {
    const segments = planVideoSegments(60, [8, 20, 45, 59.6]);
    expect(segments[0]).toEqual({start:0,end:8});
    expect(segments.at(-1)?.end).toBe(60);
    for (const [index, segment] of segments.entries()) {
      expect(segment.end-segment.start).toBeGreaterThanOrEqual(1);
      expect(segment.end-segment.start).toBeLessThan(15);
      if(index) expect(segment.start).toBe(segments[index-1].end);
    }
  });
  it('handles exact 15 second scenes and very short trailing scenes without losing time', () => {
    expect(planVideoSegments(15, [])).toEqual([{start:0,end:7.5},{start:7.5,end:15}]);
    const clips=planVideoSegments(30.4,[15,30]);
    expect(clips.at(-1)?.end).toBe(30.4);
    expect(clips.every(c=>c.end-c.start>=1 && c.end-c.start<15)).toBe(true);
  });
  it('rejects invalid duration and user cuts rather than silently changing explicit edits', () => {
    expect(()=>planVideoSegments(0.5,[])).toThrow();
    expect(()=>validateVideoBoundaries(60,[20,10])).toThrow();
    expect(()=>validateVideoBoundaries(60,[10,59.8])).toThrow();
    expect(()=>validateVideoBoundaries(60,[10,25,40,50])).toThrow();
    expect(validateVideoBoundaries(60,[12,24,36,48])).toHaveLength(5);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitProjectVideo,assembleProjectVideo,probeVideo } from '../video-project-media';
it('really detects scene changes, splits a 45 second source, and restores original sound and portrait ratio',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'video-project-media-real-'));
 try {
  const source=join(directory,'source.mp4');
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=240x320:r=30:d=9','-f','lavfi','-i','color=blue:s=240x320:r=30:d=13','-f','lavfi','-i','color=green:s=240x320:r=30:d=23','-f','lavfi','-i','sine=frequency=440:duration=45','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',source]);
  const clips=await splitProjectVideo(source,directory,45);
  expect(clips.some(clip=>Math.abs(clip.end-9)<0.1)).toBe(true);
  expect(clips.some(clip=>Math.abs(clip.end-22)<0.1)).toBe(true);
  expect(clips.every(clip=>clip.metadata.duration>=1&&clip.metadata.duration<15)).toBe(true);
  const output=join(directory,'output.mp4');
  const meta=await assembleProjectVideo(source,clips.map(clip=>({file:clip.file,duration:clip.end-clip.start})),output,{width:240,height:320,duration:45});
  expect(meta.duration).toBeCloseTo(45,1);expect(meta.width).toBe(240);expect(meta.height).toBe(320);
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output],{encoding:'utf8'})).streams;
  expect(streams.some((stream:{codec_type:string})=>stream.codec_type==='audio')).toBe(true);
  expect((await probeVideo(output)).duration).toBeCloseTo(45,1);
 }finally{await rm(directory,{recursive:true,force:true});}
},120000);
it('rejects a generated segment with a materially different duration instead of freezing or truncating it',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'video-project-duration-'));
 try {
  const short=join(directory,'short.mp4');
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=240x320:r=30:d=1','-c:v','libx264','-preset','ultrafast',short]);
  await expect(assembleProjectVideo(short,[{file:short,duration:5}],join(directory,'output.mp4'),{width:240,height:320,duration:5})).rejects.toThrow('第 1 段生成时长');
 }finally{await rm(directory,{recursive:true,force:true});}
});
it('preserves display aspect ratio for anamorphic source videos and supports sources without sound',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'video-project-sar-'));
 try {
  const source=join(directory,'source.mp4');
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=320x240:r=30:d=3','-vf','setsar=2/1','-c:v','libx264','-preset','ultrafast',source]);
  const clips=await splitProjectVideo(source,directory,3);
  const output=join(directory,'output.mp4');
  const result=await assembleProjectVideo(source,clips.map(clip=>({file:clip.file,duration:clip.end-clip.start})),output,{width:320,height:240,duration:3});
  expect(result.width/result.height).toBeCloseTo(8/3,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
