import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,chmodSync,symlinkSync,linkSync,statSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../locate-element.py',import.meta.url));
const script=`import importlib.util,sys
s=importlib.util.spec_from_file_location('locate',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
x=m.locate(sys.argv[2],'private fixture description',100,100,sys.argv[3],'fixture/model','unit-only-key');print(x)
`;
const run=(shot,url,ledger)=>new Promise((resolve,reject)=>{
 const env={...process.env};delete env.ZJ_EXTERNAL_LEDGER;if(ledger!==undefined)env.ZJ_EXTERNAL_LEDGER=ledger;
 const p=spawn('python3',['-I','-B','-c',script,source,shot,url],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.once('error',reject);p.once('close',code=>resolve({code,stdout,stderr}));
});
async function fixture(t,handler){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'external-ledger-'));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));const shot=join(root,'shot.png');writeFileSync(shot,'fixture image bytes');let calls=0;
 const server=http.createServer(async(req,res)=>{calls++;for await(const _ of req){}if(handler)return handler(req,res);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:"Action: click(start_box='<|box_start|>(12,34)<|box_end|>')"}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return {root,shot,ledger:join(root,'external.jsonl'),url:'http://127.0.0.1:'+server.address().port,calls:()=>calls};
}
test('one real local HTTP request produces one durable intent and one correlated return without image or prompt data',async t=>{
 const f=await fixture(t);const r=await run(f.shot,f.url,f.ledger);assert.equal(r.code,0,r.stderr);assert.equal(f.calls(),1);assert.equal(existsSync(f.ledger),true,'enabled ledger must exist');const rows=readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,2);assert.equal(rows[0].phase,'intent');assert.equal(rows[1].phase,'returned');assert.equal(rows[0].request_id,rows[1].request_id);assert.equal(rows[0].provider,'openrouter');assert.equal(rows[0].endpoint,'127.0.0.1');assert.equal(rows[0].model,'fixture/model');assert.equal(rows[0].kind,'image_grounding');assert.equal(rows[1].status,200);assert.equal(rows[1].error,null);assert.equal(statSync(f.ledger).mode&0o777,0o600);assert.match(rows[0].request_id,/^[a-f0-9-]{36}$/);assert.ok(Number.isFinite(Date.parse(rows[0].at)));
 assert.equal(/unit-only-key|private fixture|fixture image|base64|messages|authorization/i.test(readFileSync(f.ledger,'utf8')),false);
 const again=await run(f.shot,f.url,f.ledger);assert.equal(again.code,0,again.stderr);assert.equal(f.calls(),2);const later=readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);assert.equal(later.length,4);assert.deepEqual(later.slice(0,2),rows);assert.notEqual(later[0].request_id,later[2].request_id);
});
test('HTTP errors are counted with finite error codes and no response body leakage',async t=>{
 const f=await fixture(t,(_req,res)=>{res.writeHead(503);res.end('private error body');});const r=await run(f.shot,f.url,f.ledger);assert.notEqual(r.code,0);assert.equal(f.calls(),1);assert.equal(existsSync(f.ledger),true);const rows=readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[1].phase,'returned');assert.equal(rows[1].status,503);assert.equal(rows[1].error,'http_error');assert.equal(readFileSync(f.ledger,'utf8').includes('private error body'),false);
});
test('unsafe ledger paths or permissions refuse before any HTTP request and preserve existing bytes',async t=>{
 const f=await fixture(t);const target=join(f.root,'target');writeFileSync(target,'original\n',{mode:0o600});
 const bad=[];const symlink=join(f.root,'symlink');symlinkSync(target,symlink);bad.push(symlink);const hardlink=join(f.root,'hardlink');linkSync(target,hardlink);bad.push(hardlink);
 const broad=join(f.root,'broad');writeFileSync(broad,'original\n',{mode:0o644});bad.push(broad);
 const publicDir=join(f.root,'public');mkdirSync(publicDir,{mode:0o755});bad.push(join(publicDir,'ledger'));
 const privateDir=join(f.root,'private');mkdirSync(privateDir,{mode:0o700});const alias=join(f.root,'alias');symlinkSync(privateDir,alias);bad.push(join(alias,'ledger'));bad.push('relative-ledger.jsonl');
 for(const ledger of bad){const r=await run(f.shot,f.url,ledger);assert.notEqual(r.code,0,'unsafe path must reject: '+ledger);assert.match(r.stderr,/LOCATE_EXTERNAL_LEDGER/);}
 assert.equal(f.calls(),0);assert.equal(readFileSync(target,'utf8'),'original\n');assert.equal(readFileSync(broad,'utf8'),'original\n');
});
test('ledger mode refuses redirects so each actual request has its own prior intent',async t=>{
 const f=await fixture(t,(req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/target'});res.end();}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'(12,34)'}}]}));}});const r=await run(f.shot,f.url+'/redirect',f.ledger);assert.notEqual(r.code,0);assert.equal(f.calls(),1);const rows=readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[1].status,302);assert.equal(rows[1].error,'http_error');
});
test('legacy calls without an enabled ledger keep the existing HTTP behavior',async t=>{
 const f=await fixture(t);const r=await run(f.shot,f.url,undefined);assert.equal(r.code,0,r.stderr);assert.equal(f.calls(),1);assert.equal(existsSync(f.ledger),false);assert.match(r.stdout,/12, 34/);
});
test('an explicitly enabled but empty ledger is invalid rather than silently disabling accounting',async t=>{
 const f=await fixture(t);const r=await run(f.shot,f.url,'');assert.notEqual(r.code,0);assert.match(r.stderr,/LOCATE_EXTERNAL_LEDGER/);assert.equal(f.calls(),0);
});
