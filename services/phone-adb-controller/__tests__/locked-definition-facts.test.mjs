import test from'node:test';import assert from'node:assert/strict';import{createLockedDefinitionFacts}from'../locked-definition-facts.mjs';
const request={run_id:'run1',task_id:'task1'},source={commit:'a'.repeat(40)},rows=[['/api/brain/runs/run1/definition',{binding:{id:'b1'}}],['/api/brain/workflows/w1/versions/wv1',{version:{id:'wv1'}}],['/api/brain/tasks/task1',{id:'task1',claimed_by:'dynamic-never-store'}],['/api/brain/activities/a1/versions/av1',{version:{id:'av1'}}]];
test('locked facts stage is opaque and excludes Task; private copies cannot mutate retained canonical history',()=>{
 const cache=createLockedDefinitionFacts({request,source}),candidate=cache.stage(rows);assert.deepEqual(candidate,{});assert.equal(cache.ready(),false);assert.equal(cache.describe(candidate).length,3);assert.ok(cache.describe(candidate).every(r=>!r.path.includes('/tasks/')));cache.commit(candidate);const copy=cache.read(rows[0][0]);copy.value.binding.id='foreign';assert.equal(cache.read(rows[0][0]).value.binding.id,'b1');assert.ok(Object.isFrozen(copy.evidence));assert.equal('bytes'in copy.value,false);
});
for(const mode of ['clone','foreign-controller','foreign-source','replay'])test('locked facts '+mode+' candidate cannot initialize or alter another private cache',()=>{
 const a=createLockedDefinitionFacts({request,source}),candidate=a.stage(rows);let b=createLockedDefinitionFacts({request,source});if(mode==='foreign-source')b=createLockedDefinitionFacts({request,source:{commit:'f'.repeat(40)}});if(mode==='clone')assert.throws(()=>b.commit(structuredClone(candidate)),/LOCKED_FACTS/);else if(mode==='replay'){a.commit(candidate);assert.throws(()=>a.commit(candidate),/LOCKED_FACTS/);}else assert.throws(()=>b.commit(candidate),/LOCKED_FACTS/);
});
for(const extra of ['task','claim','token','decision','authorized'])test('unexpected '+extra+' wrapper cannot be cached as a historical API fact',()=>{
 const cache=createLockedDefinitionFacts({request,source}),value=structuredClone(rows);value[0][1][extra]={secret:'not-a-locked-fact'};assert.throws(()=>cache.stage(value),/LOCKED_FACTS/);
});
test('unknown path and changed historical candidate cannot refresh a primed cache',()=>{
 const cache=createLockedDefinitionFacts({request,source});cache.commit(cache.stage(rows));const changed=structuredClone(rows);changed[1][1].version.id='other';assert.throws(()=>cache.commit(cache.stage(changed)),/LOCKED_FACTS/);
 const second=createLockedDefinitionFacts({request,source});second.commit(second.stage(rows));assert.throws(()=>second.read('/api/brain/tasks/task1'),/LOCKED_FACTS/);
});
