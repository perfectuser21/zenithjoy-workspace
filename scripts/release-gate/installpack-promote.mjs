import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const e=process.env,repo='perfectuser21/zenithjoy-workspace';
const need=(v,m)=>{if(!v)throw Error(m);};
const gh=args=>JSON.parse(execFileSync('gh',args,{encoding:'utf8',timeout:60000}));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'installpack-admission-'));
async function api(suffix,body){
 const response=await fetch(e.VPS_API_URL.replace(/\/$/,'')+'/api/agent/install-pack/'+suffix,{method:body?'POST':'GET',headers:{'X-Internal-Token':e.VPS_INTERNAL_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 need(response.ok,'API admission/readback failed: '+response.status);return response.json();
}
async function download(url,file,digest,allowMissing=false){
 const u=new URL(url);
 need(u.origin==='https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com','untrusted artifact origin');
 const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(300000)});
 if(allowMissing&&response.status===404)return false;
 need(response.ok,'artifact download failed: '+response.status);
 const hash=createHash('sha256');let size=0;
 await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,cb){size+=chunk.length;if(size>1024*1024*1024)return cb(Error('artifact too large'));hash.update(chunk);cb(null,chunk);}}),fs.createWriteStream(file,{flags:'wx',mode:0o600}));
 need(hash.digest('hex')===digest,'downloaded artifact hash mismatch');return true;
}
try{
 need(/^[a-f0-9]{40}$/.test(e.SOURCE_SHA||'')&&/^[1-9][0-9]*$/.test(e.CANDIDATE_RUN_ID||''),'fixed source and run required');
 execFileSync('git',['merge-base','--is-ancestor',e.SOURCE_SHA,'origin/main']);
 const run=gh(['api',`repos/${repo}/actions/runs/${e.CANDIDATE_RUN_ID}`]);
 need(run.path==='.github/workflows/agent-installpack.yml'&&run.head_sha===e.SOURCE_SHA&&run.conclusion==='success'&&run.repository?.full_name===repo,'candidate run mismatch');
 execFileSync('gh',['run','download',e.CANDIDATE_RUN_ID,'--repo',repo,'--name','installpack-candidate','--dir',tmp],{timeout:60000});
 const candidate=JSON.parse(fs.readFileSync(path.join(tmp,'manifest.json')));
 need(candidate.source_sha===e.SOURCE_SHA,'artifact source mismatch');
 const request={source_sha:e.SOURCE_SHA,sha256:candidate.sha256,acceptance_run_key:e.ACCEPTANCE_RUN_KEY};
 // 服务端从固定Brain读原验收，不接受CLI的通过声明；任何COS正式写入发生前完成。
 const verified=await api('verify',request);
 need(JSON.stringify(verified.candidate)===JSON.stringify(candidate)||
   (verified.candidate.bundle_sha256===candidate.bundle_sha256&&verified.candidate.sha256===candidate.sha256),'stored candidate differs');
 const value=verified.candidate;
 const previous=await api('release-state');request.expected_current_manifest_sha256=previous.manifest_sha256;
 await download(value.cos_url,path.join(tmp,'core.tar.gz'),value.sha256);
 const coreName=path.basename(value.download_url);
 need(/^zenithjoy-agent-v[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$/.test(coreName),'invalid core legacy filename');
 const coreUrl='https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/'+coreName;
 const corePublished=await download(coreUrl,path.join(tmp,'existing-core.tar.gz'),value.sha256,true);
 for(const [i,m] of value.modules.entries()){
  await download(m.cos_url,path.join(tmp,`module-${i}.tar.gz`),m.sha256);
  // 旧Agent使用version路径；已存在不同字节必须拒绝，禁止覆盖影响旧版本回退。
  const url='https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/'+m.filename;
  m.alreadyPublished=await download(url,path.join(tmp,`existing-${i}.tar.gz`),m.sha256,true);
 }
 execFileSync('coscmd',['config','-a',e.COS_SECRET_ID,'-s',e.COS_SECRET_KEY,'-b','zenithjoy-static-1333590468','-e','cos.accelerate.myqcloud.com'],{stdio:'ignore'});
 if(!corePublished)execFileSync('coscmd',['upload',path.join(tmp,'core.tar.gz'),'/install-pack/'+coreName],{stdio:'ignore',timeout:300000});
 await download(coreUrl,path.join(tmp,'published-core.tar.gz'),value.sha256);
 for(const [i,m] of value.modules.entries()){
  if(!m.alreadyPublished)execFileSync('coscmd',['upload',path.join(tmp,`module-${i}.tar.gz`),'/install-pack/modules/'+m.filename],{stdio:'ignore',timeout:300000});
  await download('https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/'+m.filename,path.join(tmp,`published-${i}.tar.gz`),m.sha256);
 }
 const promoted=await api('promote',request);
 const current=await api('manifest');
 need(promoted.ok&&JSON.stringify(promoted.manifest)===JSON.stringify(current),'production manifest readback mismatch');
 console.log(JSON.stringify({status:'promoted',source_sha:current.source_sha,sha256:current.sha256,bundle_sha256:current.bundle_sha256,acceptance:current.release_receipt}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
