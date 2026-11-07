// Cecelia immutable-history v1 only: reviewed e3 getters + origin/O immutable
// Run/WF/AV/release rows. This is historical input, never a cached authorization.
import {createHash} from 'node:crypto';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=()=>{throw Object.assign(Error('OFFICIAL_CONTROL_LOCKED_FACTS'),{code:'OFFICIAL_CONTROL_LOCKED_FACTS'});};
export function createLockedDefinitionFacts({request,source}){
 const identity=sha(canonical({request,source})),taskPath='/api/brain/tasks/'+request.task_id,candidates=new WeakMap();
 let stored,invalid=false;
 const check=()=>{if(invalid)fail();};
 const metadata=rows=>Object.freeze(rows.map(r=>Object.freeze({path:r.path,sha256:r.sha256,bytes:Buffer.byteLength(r.bytes)})));
 function validate(rows){
  if(!Array.isArray(rows)||rows.length!==3||new Set(rows.map(r=>r.path)).size!==3)fail();
  if(rows.filter(r=>r.path===`/api/brain/runs/${request.run_id}/definition`).length!==1
   ||rows.filter(r=>/^\/api\/brain\/workflows\/[^/?#]+\/versions\/[^/?#]+$/.test(r.path)).length!==1
   ||rows.filter(r=>/^\/api\/brain\/activities\/[^/?#]+\/versions\/[^/?#]+$/.test(r.path)).length!==1)fail();
  for(const r of rows){
   if(r.path===taskPath||typeof r.bytes!=='string'||Buffer.byteLength(r.bytes)>2*1024*1024||sha(r.bytes)!==r.sha256)fail();
   const value=JSON.parse(r.bytes);if(canonical(value)!==r.bytes||!value||typeof value!=='object'||Array.isArray(value))fail();
   const allowed=r.path.endsWith('/definition')?['binding','release','workflow','activities','definition_view','omitted']:['version'];
   if(Object.keys(value).some(k=>!allowed.includes(k))||!(r.path.endsWith('/definition')?value.binding:value.version))fail();
  }
 }
 return Object.freeze({
  ready(){check();return stored!==undefined;},
  stage(rows){
   check();const serialized=rows.filter(([path])=>path!==taskPath).map(([path,value])=>{const bytes=canonical(value);return {path,bytes,sha256:sha(bytes)};});validate(serialized);
   const candidate=Object.freeze({});candidates.set(candidate,{identity,rows:serialized});return candidate;
  },
  describe(candidate){check();const staged=candidates.get(candidate);if(!staged||staged.identity!==identity)fail();return metadata(staged.rows);},
  commit(candidate){
   check();const staged=candidates.get(candidate);if(!staged||staged.identity!==identity){invalid=true;fail();}
   try{validate(staged.rows);if(stored&&canonical(stored)!==canonical(staged.rows))fail();stored=staged.rows;candidates.delete(candidate);}catch{invalid=true;fail();}
  },
  read(path){
   check();const row=stored?.find(r=>r.path===path);if(!row){invalid=true;fail();}
   try{validate(stored);return {value:JSON.parse(row.bytes),evidence:Object.freeze({identity,path,sha256:row.sha256,bytes:Buffer.byteLength(row.bytes),protocol:'cecelia-immutable-history-v1'})};}catch{invalid=true;fail();}
  },
 });
}
