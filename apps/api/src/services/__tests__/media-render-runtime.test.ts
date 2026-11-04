import {beforeAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {spawnSync} from 'node:child_process';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {renderMashupWithAudio} from '../mashup-render-ffmpeg';
vi.setConfig({testTimeout:30000,hookTimeout:30000});
let dir:string;
function command(binary:string,args:string[]){const r=spawnSync(binary,args,{maxBuffer:16*1024*1024});expect(r.status,r.stderr?.toString()).toBe(0);return r.stdout;}
interface Probe {streams:Array<{codec_type:string;width?:number;height?:number}>;format:{duration:string}}
function probe(file:string):Probe{return JSON.parse(command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]).toString());}
beforeAll(()=>{expect(command('ffmpeg',['-hide_banner','-filters']).toString()).toMatch(/\bsubtitles\b/);expect(command('fc-list',[':lang=zh','family']).toString().trim(),'Chinese subtitle font is required').not.toBe('');});
beforeEach(()=>{dir=mkdtempSync('/tmp/zj-render-runtime-');});afterEach(()=>rmSync(dir,{recursive:true,force:true}));
const clip=()=>{const file=join(dir,'input.mp4');command('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=duration=1.5:size=160x90:rate=10','-pix_fmt','yuv420p','-y',file]);return file;};
describe('real mashup render with audio and subtitle pixels',()=>{
 it('honors portrait dimensions, per-segment trims and a real audio stream',()=>{
  const file=clip(),audio=join(dir,'audio.wav'),out=join(dir,'out.mp4');command('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-y',audio]);
  expect(renderMashupWithAudio([{path:file,durationSec:0.5},{path:file,durationSec:0.7}],out,{width:180,height:320,fps:10,preset:'ultrafast',audioPath:audio})).toBe(true);
  const actual=probe(out);expect(actual.streams.find(s=>s.codec_type==='video')).toMatchObject({width:180,height:320});expect(actual.streams.some(s=>s.codec_type==='audio')).toBe(true);expect(Number(actual.format.duration)).toBeGreaterThanOrEqual(1);expect(Number(actual.format.duration)).toBeLessThan(1.6);
 });
 it('burns Chinese subtitles into different decoded frame pixels, rather than trusting exit zero or file size',()=>{
  const file=clip(),plain=join(dir,'plain.mp4'),captioned=join(dir,'captioned.mp4'),srt=join(dir,'caption.srt');writeFileSync(srt,'1\n00:00:00,000 --> 00:00:01,400\n真实中文字幕\n');
  const opts={width:320,height:180,fps:10,preset:'ultrafast'};
  expect(renderMashupWithAudio([{path:file}],plain,opts)).toBe(true);expect(renderMashupWithAudio([{path:file}],captioned,{...opts,srtPath:srt})).toBe(true);
  const frame=(path:string)=>createHash('sha256').update(command('ffmpeg',['-v','error','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])).digest('hex');
  expect(frame(captioned)).not.toBe(frame(plain));expect(probe(plain).streams.some(s=>s.codec_type==='audio')).toBe(false);
 });
 it('rejects missing media or subtitle input without a false successful render',()=>{expect(renderMashupWithAudio([],join(dir,'out.mp4'))).toBe(false);expect(renderMashupWithAudio([{path:join(dir,'missing.mp4')}],join(dir,'out.mp4'))).toBe(false);expect(renderMashupWithAudio([{path:clip()}],join(dir,'out.mp4'),{srtPath:join(dir,'missing.srt')})).toBe(false);});
});
