// Real OS integration probe, loaded with the package's pinned tsx. The real
// production manager receives only an observational fs.watch forwarding wrapper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createFolderWatchManager} from '../../folder-watch.ts';

const root=fs.realpathSync(process.argv[2]);
const watched=path.join(root,'watched'),incoming=path.join(root,'incoming');
fs.mkdirSync(watched);fs.mkdirSync(incoming);
const target=path.join(watched,'native-event.mp4');
const events=[],rawEvents=[];const started=performance.now();let published=0,completed=false;
let publisher,deadline;let succeed,fail;
const result=new Promise((resolve,reject)=>{succeed=resolve;fail=reject;});
const registration={attempted:false,registered:false,closed:false,errors:[]};
const errorInfo=error=>({code:error.code,message:error.message});
const diagnostics=()=>({root,watched,cwd:process.cwd(),node:process.version,execPath:process.execPath,tmpdir:os.tmpdir(),TMPDIR:process.env.TMPDIR,uid:process.getuid?.(),rootStat:{uid:fs.statSync(root).uid,mode:fs.statSync(root).mode},watchFunctionHash:createHash('sha256').update(fs.watch.toString()).digest('hex'),managerFunctionHash:createHash('sha256').update(createFolderWatchManager.toString()).digest('hex'),registration,rawEvents,events,published});
const manager=createFolderWatchManager({fsWatch:(directory,options,listener)=>{
 registration.attempted=true;
 try{
  const watcher=fs.watch(directory,options,(event,filename)=>{
   rawEvents.push({event,filename:filename?.toString()??null,elapsedMs:Math.round(performance.now()-started)});
   listener(event,filename);
  });
  registration.registered=true;
  watcher.on('error',error=>{registration.errors.push(errorInfo(error));fail(error);});
  watcher.on('close',()=>{registration.closed=true;if(!completed)fail(new Error('Native watcher closed before target delivery'));});
  return watcher;
 }catch(error){registration.errors.push(errorInfo(error));throw error;}
},onChange:file=>{
 events.push({file,elapsedMs:Math.round(performance.now()-started)});
 if(file===target)succeed(file);
}});
try{
 manager.bind(watched);
 if(!registration.registered)throw new Error('Production bind did not register a native watcher');
 deadline=setTimeout(()=>fail(new Error('Native folder event was not delivered within 8000ms')),8000);
 // One publication after registration, then quiescence. Requiring a separate
 // readiness notification first adds a second delayed FSEvents batch without
 // testing an additional production promise. The target callback proves readiness.
 publisher=setImmediate(()=>{
  try{const staged=path.join(incoming,'video.partial');fs.writeFileSync(staged,'native video publication');published++;fs.renameSync(staged,target);}catch(error){fail(error);}
 });
 assert.equal(await result,target);assert.equal(published,1);
 assert.equal(fs.readFileSync(target,'utf8'),'native video publication');
 assert.deepEqual(manager.listMp4s(),[target]);
 completed=true;process.stdout.write(JSON.stringify({platform:process.platform,target,...diagnostics(),elapsedMs:Math.round(performance.now()-started)})+'\n');
}catch(error){console.error(JSON.stringify({error:errorInfo(error),...diagnostics()}));throw error;}finally{completed=true;clearImmediate(publisher);clearTimeout(deadline);manager.stop();}
