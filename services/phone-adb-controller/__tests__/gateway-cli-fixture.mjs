import {appendFileSync,writeFileSync,chmodSync,readFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {keywordFixture,ids} from './keyword-workflow-cli-fixture.mjs';
import {repo} from './workflow-cli-fixture.mjs';
import {prepareSnapshot} from '../gateway-snapshot.mjs';
export async function gatewayFixture(t){
 const f=await keywordFixture(t,['matched'],{singleWord:true});
 const directory=join(f.home,'gateway');
 const commit=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 prepareSnapshot({root:repo,commit,role:'gateway',directory});
 f.input.execution.gateway={host:'fixture-gateway',cwd:directory,node:process.execPath};
 f.videos.set('history',{record_id:'history',fields:{视频ID:ids[2]}});
 appendFileSync(join(f.home,'http-fixture.cjs'),`
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
fs.appendFileSync(path.join(process.env.HOME,'actual-entry.jsonl'),JSON.stringify({entry:process.argv[1],cwd:process.cwd()})+'\\n');
const originalLoad=Module._load;
Module._load=function(name,parent,...rest){
 if(name==='pg')return {Pool:class{
  async end(){} async query(sql,v){
   const file=path.join(process.env.HOME,'pg.json'),db=JSON.parse(fs.readFileSync(file));let rows=[];
   fs.appendFileSync(path.join(process.env.HOME,'actual-pg.jsonl'),JSON.stringify({sql,values:v,entry:process.argv[1]})+'\\n');
   if(sql.includes('INSERT INTO zenithjoy.leadgen_videos')){
    db.videos[v[1]]||={line_key:v[0],video_id:v[1],video_url:v[2],title:v[3],keyword:v[4],harvest_batch:v[5],judgment_status:'pending',judgment_reason:null,transcript:null,process_status:'待判定'};
    const row=db.videos[v[1]];rows=[{...row,has_transcript:false,inserted:true}];
   }else if(sql.includes('SELECT video_id, video_url'))rows=db.videos[v[1]]?[db.videos[v[1]]]:[];
   else if(sql.includes('SET judgment_status = $3')){
    Object.assign(db.videos[v[1]],{judgment_status:v[2],judgment_reason:v[3],transcript:v[4]});rows=[{id:v[1]}];
   }else if(sql.includes("SET process_status = '评论已采'")){
    if(db.videos[v[1]]?.judgment_status==='matched'){Object.assign(db.videos[v[1]],{process_status:'评论已采',comment_count:v[2]});rows=[{id:v[1]}];}
   }else throw Error('blocked unexpected PG SQL');
   fs.writeFileSync(file,JSON.stringify(db));return {rows};
  }
 }};
 return originalLoad.call(this,name,parent,...rest);
};
const originalFixtureFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url)==='https://openrouter.ai/api/alpha/decisions'&&JSON.parse(options.body).questions.verdict){
  fs.appendFileSync(path.join(process.env.HOME,'actual-judge.jsonl'),JSON.stringify({entry:process.argv[1],body:JSON.parse(options.body)})+'\\n');
  return new Response(JSON.stringify({answers:{verdict:{choice:'matched',confidence:0.99}}}),{status:200});
 }
 return originalFixtureFetch(url,options);
};
`);
 const ssh=join(f.home,'.local/bin/ssh');
 writeFileSync(ssh,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2),host=args.at(-2),command=args.at(-1);
if(host!=='fixture-gateway')throw Error('blocked production SSH');
const allowed=['fetch-seen-videos.js','qualify-video.js','comment-activity.js','workflow-probe.js'];
const matches=allowed.filter(name=>command.includes("'"+path.join(process.env.HOME,'gateway',name)+"'"));
if(matches.length!==1||!command.startsWith('exec ')&&!command.startsWith('cd ')&&!command.startsWith('set -e; '))throw Error('blocked nonfrozen command');
fs.appendFileSync(path.join(process.env.HOME,'actual-ssh.jsonl'),JSON.stringify({host,command,entry:matches[0]})+'\\n');
const result=cp.spawnSync('/bin/zsh',['-c',command],{env:process.env,encoding:'utf8',input:['comment-activity.js','workflow-probe.js'].includes(matches[0])?fs.readFileSync(0):''});
fs.appendFileSync(path.join(process.env.HOME,'actual-remote.jsonl'),JSON.stringify({command,status:result.status,stderr:result.stderr,stdout:result.stdout})+'\\n');
if(process.env.DELETE_PROBE_AFTER_COLLECTION==='1'&&matches[0]==='qualify-video.js'&&command.includes("'collected'"))fs.unlinkSync(path.join(process.env.HOME,'gateway','workflow-probe.js'));
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
`);chmodSync(ssh,0o755);
 for(const name of ['scp','curl']){const file=join(f.home,'.local/bin',name);writeFileSync(file,'#!/bin/sh\necho blocked-production-transport >&2\nexit 97\n');chmodSync(file,0o755);}
 return f;
}
