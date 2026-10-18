/** Classifies the original agent diff; only proven identical skill relocations are excluded. */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readImplementationSource} from './implementation-skill-source.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function classifyAgentChanges({repoRoot,base,head,event='pull_request',readSource=readImplementationSource}){
 if(![base,head].every(ref=>/^[0-9a-f]{40}$/.test(ref)))throw Error('AGENT_SCOPE_INVALID_REVISION');
 const git=(...args)=>execFileSync('git',['--no-replace-objects','-C',repoRoot,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
 const old=git('merge-base',base,head).trim();
 if(event==='push'&&old!==base)return {agent:true,reason:'non_ancestor_push',base_revision:base,merge_base_revision:old,head_revision:head};
 const files=git('diff','--no-renames','--name-only','-z',`${base}...${head}`,'--','services/agent/').split('\0').filter(Boolean);
 const deleted=new Set(git('diff','--no-renames','--diff-filter=D','--name-only','-z',`${base}...${head}`,'--','services/agent/').split('\0').filter(Boolean));
 const proof=[];let agent=false;
 for(const path of files){
  if(!deleted.has(path)||!path.endsWith('/SKILL.md')){agent=true;continue;}
  // The reader accepts only regular Git blobs and head's pinned central catalog mapping.
  const before=readSource(repoRoot,old,path),after=readSource(repoRoot,head,path);
  if(!Buffer.isBuffer(before)||!Buffer.isBuffer(after))throw Error('AGENT_SCOPE_INVALID_SOURCE');
  const same=before.equals(after);
  proof.push({path,base_revision:old,head_revision:head,base_sha256:digest(before),head_sha256:digest(after),unchanged_relocation:same});
  if(!same)agent=true;
 }
 return {agent,base_revision:base,merge_base_revision:old,head_revision:head,changed_agent_files:files,skill_relocations:proof};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [repoRoot,base,head,proofPath]=process.argv.slice(2);
  if(!repoRoot||process.argv.length<5||process.argv.length>6)throw Error('AGENT_SCOPE_INVALID_ARGUMENTS');
  const result=classifyAgentChanges({repoRoot,base,head,event:process.env.GITHUB_EVENT_NAME||'pull_request'});
  if(proofPath)writeFileSync(proofPath,JSON.stringify(result,null,2)+'\n');
  process.stdout.write(String(result.agent)+'\n');
 }catch{process.stderr.write('AGENT_SCOPE_PROOF_FAILED\n');process.exitCode=1;}
}
