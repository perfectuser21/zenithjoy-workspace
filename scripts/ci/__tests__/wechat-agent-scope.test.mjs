import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {classifyAgentChanges} from '../wechat-agent-scope.mjs';
import {readImplementationSource} from '../implementation-skill-source.mjs';
const skill='services/agent/publishers/toutiao-publisher/SKILL.md';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
for(const mode of ['relocation','runtime','mixed','changed-body','new-skill','missing-mapping','fetch-error','merge-base'])test('real Git agent scope: '+mode,t=>{
 const root=mkdtempSync(join(tmpdir(),'agent-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const business=join(root,'business'),central=join(root,'central');
 for(const dir of [business,central]){mkdirSync(dir);git(dir,'init','-q');git(dir,'config','core.hooksPath','/dev/null');}
 git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
 const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=f@f','-c','commit.gpgsign=false','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
 put(business,skill,'original\n');let base=commit(business);
 if(mode==='merge-base'){
  const original=base;git(business,'checkout','-qb','base-tip');put(business,skill,'base branch only');base=commit(business);git(business,'checkout','--detach',original);
 }
 const payload=mode==='changed-body'?'changed\n':'original\n';put(central,'body.md',payload);
 put(central,'distribution/catalog.json',JSON.stringify({profiles:{zenithjoy:{files:mode==='missing-mapping'?[]:[{path:skill,source:'body.md',sha256:createHash('sha256').update(payload).digest('hex')}]}}}));
 const revision=commit(central);
 put(business,'.skills-source.json',JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision,loader_sha256:'0'.repeat(64)}));
 if(mode==='runtime')put(business,'services/agent/runtime.py','changed');
 else if(mode==='new-skill')put(business,'services/agent/new/SKILL.md','new');
 else{rmSync(join(business,skill));if(mode==='mixed')put(business,'services/agent/runtime.py','changed');}
 const head=commit(business);
 const readSource=(root,ref,path)=>{if(mode==='fetch-error'&&ref===head)throw Error('fetch failed');return readImplementationSource(root,ref,path,{source:central});};
 const run=()=>classifyAgentChanges({repoRoot:business,base,head,readSource});
 if(['missing-mapping','fetch-error'].includes(mode))assert.throws(run);
 else{const r=run();assert.equal(r.agent,!['relocation','merge-base'].includes(mode));if(['relocation','merge-base'].includes(mode))assert.equal(r.skill_relocations[0].unchanged_relocation,true);
  if(mode==='merge-base'){const push=classifyAgentChanges({repoRoot:business,base,head,event:'push',readSource});assert.equal(push.agent,true);assert.equal(push.reason,'non_ancestor_push');}
 }
});
test('changes job permanently runs regression and scopes only AGENT through fixed reader',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/wechat-cs-e2e.yml',import.meta.url),'utf8');
 assert.match(workflow,/run: node --test scripts\/ci\/__tests__\/wechat-agent-scope.test.mjs/);
 assert.match(workflow,/SKILLS_SOURCE_SSH_KEY: \$\{\{ secrets.SKILLS_SOURCE_SSH_KEY \}\}/);
 assert.match(workflow,/AGENT=\$\(node scripts\/ci\/wechat-agent-scope.mjs/);
 assert.match(workflow,/if echo "\$FILES" \| grep -qE '\^\(services\/agent\//);
});

test('CLI classification errors are nonzero and never print false',()=>{
 try{execFileSync(process.execPath,[new URL('../wechat-agent-scope.mjs',import.meta.url).pathname,'.','invalid','invalid'],{stdio:['ignore','pipe','pipe']});assert.fail('must fail');}
 catch(error){assert.equal(error.status,1);assert.equal(error.stdout.toString(),'');assert.match(error.stderr.toString(),/AGENT_SCOPE_PROOF_FAILED/);}
});
