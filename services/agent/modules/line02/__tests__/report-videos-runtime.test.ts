import {afterEach,describe,it,expect} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';import {createServer,type Server} from 'node:http';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {resolve} from 'node:path';
let child:ChildProcess,server:Server,dir:string;
afterEach(async()=>{if(child){child.kill('SIGKILL');await new Promise<void>(r=>child.exitCode!==null||child.signalCode!==null?r():child.once('exit',()=>r()));}if(server)await new Promise<void>(r=>server.close(()=>r()));if(dir)await rm(dir,{recursive:true,force:true});});
async function execute(keywords:string[],scriptResult:unknown,firstStatus=200){
 dir=await mkdtemp('/tmp/zj-report-module-');await mkdir(dir+'/publishers');
 // Only the browser boundary is a fixture executable; real module controls spawning, parsing and HTTP.
 await writeFile(dir+'/publishers/keyword-search-douyin.cjs',`console.log(${JSON.stringify(JSON.stringify(scriptResult))});`);
 const requests:Array<{headers:Record<string,any>;body:any}>=[];let dispatched=false;
 let done!:(value:typeof requests)=>void;const result=new Promise<typeof requests>(r=>done=r);
 server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({tasks:dispatched?[]:[{task_id:'task-runtime',keywords}]}));dispatched=true;return;}
  let body='';for await(const c of req)body+=c;
  if(req.url==='/api/acquisition/collect/report-videos'){
   requests.push({headers:req.headers,body:JSON.parse(body)});res.statusCode=requests.length===1?firstStatus:200;res.end('{"success":true}');
   if([200,400,403,409].includes(res.statusCode))done(requests);
  }else res.end('{}');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 child=fork(resolve('modules/line02/index.ts'),[],{execArgv:['--import','tsx'],env:{...process.env,ZENITHJOY_CORE_DIR:dir,ZENITHJOY_NODE_BIN:process.execPath},stdio:['ignore','ignore','ignore','ipc']});
 const ready=new Promise<void>((r,reject)=>{child.once('message',()=>r());child.once('error',reject);});
 child.send({type:'config',agentId:'fixture-agent',config:{apiBase:`http://127.0.0.1:${(server.address()as any).port}`,pollIntervalMs:15}});await ready;
 const timeout=setTimeout(()=>done([]),4000);const observed=await result;clearTimeout(timeout);expect(observed.length,'actual module must send HTTP report').toBeGreaterThan(0);return observed;
}
describe('real Line02 module report-videos protocol',()=>{
 it('spawns search boundary, deduplicates IDs and transmits agent identity',async()=>{
  const observed=await execute(['one','two'],{ok:true,video_urls:['https://www.douyin.com/video/7123456789012345678','invalid']});
  expect(observed[0].body).toEqual({task_id:'task-runtime',videos:[{video_id:'7123456789012345678'}]});expect(observed[0].headers['x-agent-id']).toBe('fixture-agent');
 });
 it('reports successful empty search as empty',async()=>{const r=await execute(['empty'],{ok:true,video_urls:[]});expect(r[0].body).toEqual({task_id:'task-runtime',videos:[],reason:{search_result:'empty'}});});
 it('reports script failure separately from empty results',async()=>{const r=await execute(['error'],{ok:false,error:'SEARCH_TIMEOUT'});expect(r[0].body.reason).toEqual({error_code:'SEARCH_TIMEOUT'});});
 it('retries HTTP 503 with identical payload',async()=>{const r=await execute([],{ok:true,video_urls:[]},503);expect(r).toHaveLength(2);expect(r[1].body).toEqual(r[0].body);});
 it('does not retry a terminal task conflict',async()=>{const r=await execute([],{ok:true,video_urls:[]},409);expect(r).toHaveLength(1);});
});
