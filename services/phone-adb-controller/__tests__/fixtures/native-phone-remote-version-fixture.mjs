// Test-only remote transport isolation. A real HTTP response cannot alias the
// in-memory frozen body. No approval rule or authorization capability is added.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export function isolateNativeBoundaryRemoteVersions(f){
 const frozenMemory=JSON.stringify(f.definition.frozen),file=join(f.env.WFR_RUN_DIR,'run-definition.json'),frozenBytes=readFileSync(file),reads=[];
 const paths=[];for(const [path,response]of f.routes)if(/^\/api\/brain\/(workflows|activities)\/[^/]+\/versions\/[^/]+$/.test(path)){f.routes.set(path,structuredClone(response));paths.push(path);}
 const assertFrozenUnchanged=()=>{assert.equal(JSON.stringify(f.definition.frozen),frozenMemory);assert.deepEqual(readFileSync(file),frozenBytes);};
 const wrapHttp=(request,role,activity)=>(options,callback)=>request(options,response=>{const chunks=[];if(paths.includes(options.path)){response.on('data',b=>chunks.push(Buffer.from(b)));response.once('end',()=>{try{const raw=Buffer.concat(chunks),x=JSON.parse(raw),v=x.version;reads.push({role,activity,path:options.path,received_at:Date.now(),body_sha256:sha(raw),outer_status:v?.status??null,bindings:(v?.payload?.implementation_bindings??[]).map(b=>({kind:b.kind,name:b.name,status:b.status}))});}catch(error){reads.push({role,activity,path:options.path,error:String(error)});}});}callback(response);});
 return {reads,assertFrozenUnchanged,wrapHttp,frozen_memory_sha256:sha(frozenMemory),frozen_file_sha256:sha(frozenBytes),paths};
}
