// Real OS integration probe. Loaded with the package's pinned tsx and imports
// the actual production manager; no replacement watcher or manager is supplied.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createFolderWatchManager} from '../../folder-watch.ts';

const root=fs.realpathSync(process.argv[2]);
const watched=path.join(root,'watched'),incoming=path.join(root,'incoming');
fs.mkdirSync(watched);fs.mkdirSync(incoming);
const target=path.join(watched,'native-event.mp4');
const events=[];const started=performance.now();let probes=0,published=0,ready=false;
let writer,deadline;let succeed,fail;
const result=new Promise((resolve,reject)=>{succeed=resolve;fail=reject;});
const manager=createFolderWatchManager({onChange:file=>{
 events.push({file,elapsedMs:Math.round(performance.now()-started)});
 if(!ready&&path.basename(file).startsWith('ready-')){
  ready=true;clearInterval(writer);
  // Publish after the readiness callback batch drains, once, then leave the
  // directory quiet. Rewriting one file every 40ms can be coalesced by FSEvents.
  setImmediate(()=>{
   try{const staged=path.join(incoming,'video.partial');fs.writeFileSync(staged,'native video publication');published++;fs.renameSync(staged,target);}catch(error){fail(error);}
  });
 }
 if(file===target)succeed(file);
}});
try{
 manager.bind(watched);
 deadline=setTimeout(()=>fail(new Error('Native folder event was not delivered within 8000ms: '+JSON.stringify({probes,published,ready,events}))),8000);
 const probe=()=>{
  if(ready)return;
  const staged=path.join(incoming,'ready.partial'),name=`ready-${++probes}.txt`;
  try{fs.writeFileSync(staged,name);fs.renameSync(staged,path.join(watched,name));}catch(error){fail(error);}
 };
 // These are actual atomic file publications until an OS event demonstrates
 // subscription readiness; no fixed startup sleep or synthetic callback.
 writer=setInterval(probe,250);probe();
 assert.equal(await result,target);assert.equal(ready,true);assert.equal(published,1);
 assert.equal(fs.readFileSync(target,'utf8'),'native video publication');
 assert.deepEqual(manager.listMp4s(),[target]);
 process.stdout.write(JSON.stringify({platform:process.platform,probes,published,target,events,elapsedMs:Math.round(performance.now()-started)})+'\n');
}finally{clearInterval(writer);clearTimeout(deadline);manager.stop();}
