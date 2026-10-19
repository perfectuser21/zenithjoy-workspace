// Test-only deployment prerequisite: a private business checkout and its own
// exact central Git objects. Never populate the caller's checkout or cache.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDeploymentSkillSources} from '../deployment-fixed-source.mjs';

const source=fileURLToPath(new URL('../../../',import.meta.url));
export function withDeploymentPrefixFixture(run){
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'deployment-prefix-fixture-')));
 const env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')||['NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','BASH_ENV','ENV'].includes(key))delete env[key];
 Object.assign(env,{GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'});
 const git=(root,...args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
 try{
  const root=join(temporary,'source'),cache=join(root,'.skills-source');
  const revision=git(source,'rev-parse','HEAD').trim();
  if(!/^[0-9a-f]{40}$/.test(revision))throw Error('fixture business revision invalid');
  git(temporary,'init','--quiet','--template=',root);
  git(root,'fetch','--quiet','--no-tags','--depth=1',source,revision);
  git(root,'checkout','--quiet','--detach',revision);
  const lock=JSON.parse(readFileSync(join(root,'.skills-source.json'),'utf8'));
  if(lock.repository!=='perfectuser21/zenithjoy-skills'||lock.profile!=='zenithjoy'||!/^[0-9a-f]{40}$/.test(lock.revision))throw Error('fixture Skill lock invalid');
  const external=realpathSync(process.env.SKILLS_SOURCE_DIR||join(source,'.skills-source'));
  git(root,'init','--quiet','--template=',cache);
  git(cache,'fetch','--quiet','--no-tags','--depth=1',external,lock.revision);
  // This is the real deployment-prepare prerequisite. The local transport
  // supplies only its exact objects; the original bootstrap still verifies.
  prepareDeploymentSkillSources(root,revision);
  execFileSync('python3',['-I',join(root,'scripts/skills-source.py'),'install','--workspace',root],{env,stdio:['ignore','pipe','pipe'],timeout:60000});
  execFileSync('python3',['-I',join(root,'scripts/skills-source.py'),'verify','--workspace',root],{env,stdio:['ignore','pipe','pipe'],timeout:60000});
  return run(root,env);
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
