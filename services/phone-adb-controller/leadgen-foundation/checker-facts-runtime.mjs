import {readQualificationOrigin,readMediaFacts} from './checker-file-facts.mjs';
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{spawn}from'node:child_process';
const HERE=path.dirname(fileURLToPath(import.meta.url)),hash=x=>createHash('sha256').update(x).digest('hex');
const need=x=>{if(!x)throw Error('FACT_RUNTIME_UNAVAILABLE');};
function privateBytes(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0);return fs.readFileSync(file,'utf8');}
export function listHostReceipts(root,identity){
 const directory=path.join(root,'receipts');
 need(fs.realpathSync(directory)===directory);
 const files=fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort();
 need(files.length<=500);
 let total=0;
 return files.flatMap(name=>{
  need(/^[A-Za-z0-9_.-]+\.json$/.test(name));
  const file=path.join(directory,name),stat=fs.lstatSync(file);
  total+=stat.size;
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&!(stat.mode&0o022)
   &&stat.size<=2*1024*1024&&total<=12*1024*1024);
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));
  // Original phone command evidence shares the directory with the host transport ledger.
  if(Object.keys(raw).sort().join(',')==='args,exit_code,stderr,stdout'
   &&Array.isArray(raw.args)&&Number.isInteger(raw.exit_code)&&typeof raw.stdout==='string'&&typeof raw.stderr==='string')return [];
  const binding=raw.binding??{},bound=binding.identity;
  need(!(stat.mode&0o077)&&bound&&['task_id','run_id','run_tag'].every(key=>typeof identity[key]==='string'&&identity[key]===bound[key])
   &&/^[a-z][a-z0-9_]{0,79}$/.test(binding.activity??'')&&/^[a-z][a-z0-9_-]{0,79}$/.test(binding.kind??'')
   &&['terminal','unknown','prepared'].includes(raw.state)
   &&Number.isFinite(raw.started_at));
  const operation=binding.args?.[0];
  return [{path:'receipts/'+name,activity:binding.activity,kind:binding.kind,
   ...(typeof operation==='string'&&/^[A-Za-z0-9][A-Za-z0-9_/-]{0,63}$/.test(operation)?{operation}:{}),
   state:raw.state,started_at:raw.started_at,...(Number.isFinite(raw.ended_at)?{ended_at:raw.ended_at}:{}),
   ...(Number.isInteger(raw.result?.exit_code)?{exit_code:raw.result.exit_code}:{})}];
 });
}
export function readFrozenContext(file,expectedSha){
 need(path.isAbsolute(file)&&fs.realpathSync(file)===file&&/^[a-f0-9]{64}$/.test(expectedSha??''));
 const bytes=privateBytes(file);need(hash(bytes)===expectedSha);return JSON.parse(bytes);
}
function runtime(c){
 need(path.isAbsolute(c.runtime_root)&&fs.realpathSync(c.runtime_root)===c.runtime_root);
 const pins=c.verification.runtime_sha256;need(pins&&Object.keys(pins).length>0);
 for(const [relative,expected]of Object.entries(pins)){const file=path.resolve(c.runtime_root,relative);need(file.startsWith(c.runtime_root+path.sep)&&fs.realpathSync(file)===file&&hash(fs.readFileSync(file))===expected);}
 return createRequire(path.join(c.runtime_root,'package.json'));
}
async function boundedJson(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});need(response.ok);
 const text=await response.text();need(Buffer.byteLength(text)<=4*1024*1024);return JSON.parse(text);
}
export function readOnlyCrmFetch(url,options={}){
 const parsed=new URL(url),method=(options.method??'GET').toUpperCase();
 need(parsed.protocol==='https:'&&parsed.hostname==='open.feishu.cn'&&parsed.port===''&&!parsed.username&&!parsed.password);
 need(method==='GET'||method==='POST'&&parsed.pathname==='/open-apis/auth/v3/tenant_access_token/internal'&&parsed.search==='');
 return fetch(parsed.href,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
}
export const factDependencies={
 async originRead(c,run,video){return readQualificationOrigin(c,run,video,factDependencies.brainGet);},
 async mediaRead(c,name){return readMediaFacts(path.join(c.checker_evidence_root,'native'),name,c.checker_media_tool);},
 async loadPool(c){
  runtime(c);const {loadActivityHostPg}=await import('./activity-host-pg.mjs');const{Pool}=await loadActivityHostPg(c);
  const config=JSON.parse(privateBytes(c.credentials.database));need(typeof config.DATABASE_URL==='string');
  return new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:5000,max:1});
 },
 async brainGet(endpoint,c){
  need(/^\/tasks\/[A-Za-z0-9-]+$/.test(endpoint)||endpoint==='/device-locks');
  const line=privateBytes(c.credentials.brain).split('\n').find(l=>/^(BRAIN_INTERNAL_TOKEN|CECELIA_INTERNAL_TOKEN)=/.test(l));need(line);
  const raw=line.slice(line.indexOf('=')+1);let token;try{token=JSON.parse(raw);}catch{token=raw.replace(/^['"]|['"]$/g,'');}
  return boundedJson('http://127.0.0.1:5221/api/brain'+endpoint,{headers:{'X-Internal-Token':token}});
 },
 hostReceipts(identity){return listHostReceipts(HERE,identity);},
 async nativeRead(c,run){
  runtime(c);need(c.transport==='local');
  const facts=await new Promise((resolve,reject)=>{
   const child=spawn(c.python,[path.join(HERE,'native-probe.py')],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'}});let output='',settled=false;
   const fail=()=>{if(!settled){settled=true;child.kill('SIGTERM');reject(Error('FACT_NATIVE_UNAVAILABLE'));}};
   const timer=setTimeout(fail,35000);child.stdout.on('data',b=>{output+=b;if(Buffer.byteLength(output)>2*1024*1024)fail();});child.stderr.resume();child.on('error',fail);
   child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;try{need(code===0);resolve(JSON.parse(output));}catch{reject(Error('FACT_NATIVE_UNAVAILABLE'));}});
   child.stdin.on('error',fail);child.stdin.end(JSON.stringify({...c,run}));
  });
  // Keep the unclassified original account page alongside parsed fields. No 120-second verdict.
  const root=fs.realpathSync(c.native_root),files=fs.readdirSync(root).filter(n=>n.startsWith(run)&&n.endsWith('-profile.xml')).sort().slice(-5);
  facts.account_documents=files.map(name=>{const p=path.join(root,name),s=fs.lstatSync(p);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=1024*1024);const bytes=fs.readFileSync(p);return{name,sha256:hash(bytes),mtime_ms:s.mtimeMs,xml:bytes.toString('utf8')};});
  return facts;
 },
 async feishuGet(id,c){
  need(/^[A-Za-z0-9_-]+$/.test(id));const require=runtime(c),route=require('./line-routes.js').routeOf(c.line);
  const client=await require('./leadgen-outreach-orders.js').orderClient(route,{env:{LEADGEN_FEISHU_CREDENTIALS:c.credentials.feishu},fetcher:readOnlyCrmFetch,deadlineAt:Date.now()+30000});
  return client.get(id);
 },
};
