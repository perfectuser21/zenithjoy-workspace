import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
function baseFixture(t){
 const top=realpathSync(mkdtempSync(join(tmpdir(),'publish-release-')));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const home=join(top,'home'),source=join(top,'business'),central=join(source,'.skills-source');mkdirSync(central,{recursive:true});mkdirSync(home);
 const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 for(const root of [source,central]){git(root,'init','-q','-b','cp-fixture');git(root,'config','core.hooksPath','/dev/null');}
 const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
 const skill='.agents/skills/multi-platform-publish/SKILL.md',runtime='.skills-runtime/android-publish/SKILL.md';
 const payloads={[skill]:'# publishing skill\n',[runtime]:'# fixed phone base\n','.agents/skills/multi-platform-publish/references/catalog.json':'{"routes":[]}\n'};
 const files=Object.entries(payloads).map(([path,payload],i)=>{put(central,'manual-'+i,payload);return {path,source:'manual-'+i,sha256:hash(payload),mode:'100644'};});
 put(central,'distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files}}}));
 const loader='import argparse,json,pathlib,hashlib\np=argparse.ArgumentParser();p.add_argument("command");p.add_argument("--workspace");p.add_argument("--source");a=p.parse_args();w=pathlib.Path(a.workspace);s=pathlib.Path(a.source);c=json.loads((s/"distribution/catalog.json").read_text());files=c["profiles"]["zenithjoy"]["files"];\nfor e in files:\n b=(s/e["source"]).read_bytes();assert hashlib.sha256(b).hexdigest()==e["sha256"];t=w/e["path"];t.parent.mkdir(parents=True,exist_ok=True);t.write_bytes(b) if a.command=="install" else None;assert t.read_bytes()==b\n';
 put(central,'distribution/skills_source.py',loader);
 const commit=root=>{git(root,'add','.');git(root,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
 const centralSha=commit(central);put(source,'scripts/skills-source.py',readFileSync(new URL('../../../scripts/skills-source.py',import.meta.url)));
 put(source,'.skills-source.json',JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',revision:centralSha,profile:'zenithjoy',loader_sha256:hash(loader)}));
 put(source,'.gitignore','.skills-source/\n.skills-runtime/\n.agents/skills/multi-platform-publish/SKILL.md\n.agents/skills/multi-platform-publish/references/\n');
 put(source,'.agents/skills/multi-platform-publish/scripts/publish_catalog.py','from pathlib import Path\nr=Path(__file__).resolve().parents[4];print((r/".skills-runtime/android-publish/SKILL.md").read_text())\n');
 put(source,'extra-runtime-contract.json','{"fixed":true}\n');const revision=commit(source);
 return {top,home,source,revision,put,git,commit,runtime,skill};
}

export function transportFixture(t,{payloadBytes=270000}={}){
 const f=baseFixture(t),prefix='services/phone-adb-controller/';
 // 全部部署执行器使用原件；手机业务不会执行。
 for(const name of ['deployment-manifest.mjs','deployment-fixed-source.mjs','runtime-definition.mjs','producer-descriptor.mjs','no-comments-evidence.mjs','comment-count-evidence.py','runtime-host.mjs','runtime-release.mjs']){
  f.put(f.source,prefix+name,readFileSync(new URL('../'+name,import.meta.url)));
 }
 const commander=['wf-launch.sh','wf-status.sh','wf-agent-run.sh','wf-agent-lib.py','wf-agent-handoff.py','wf-v2.py','wf-v2-io.py','wf-v2-phone.py','wf-v2-shell.py','wf-report.py','workflow-contracts.json','AGENTS.md'];
 for(const name of commander)f.put(f.source,prefix+'commander/'+name,readFileSync(new URL('../commander/'+name,import.meta.url)));
 f.put(f.source,prefix+'commander/skills/workflow-commander/SKILL.md','# fixed fixture commander\n');
 f.put(f.source,prefix+'leadgen-run.sh','#!/bin/sh\nexit 0\n');f.put(f.source,prefix+'leadgen-rpc.mjs','export const fixed=true;\n');
 f.put(f.source,prefix+'transport-payload.bin',Buffer.alloc(payloadBytes,67));
 f.revision=f.commit(f.source);
 const environment='staging:'+f.revision,repo='perfectuser21/zenithjoy-workspace';
 f.plan={environment,releases:{},release_ids:{}};
 for(const host of ['mmv','xian-m4']){
  const payload={components:[{kind:'repo',repo,revision:f.revision}],workflows:[{payload:{key:'fixture'},payload_sha256:'f'.repeat(64)}]};
  const release={id:'release-'+host,environment,target:host,payload};
  // 原digest是稳定key序JSON，不是普通JSON串。
  f.plan.releases[host]=release;f.plan.release_ids[host]=release.id;
 }
 f.bin=join(f.top,'bin');mkdirSync(f.bin);f.log=join(f.top,'transport.jsonl');
 const ssh=new URL('./candidate-transport-ssh.mjs',import.meta.url).pathname;
 f.put(f.bin,'ssh','#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(ssh)+' "$@"\n');
 execFileSync('chmod',['700',join(f.bin,'ssh')]);
 f.config=join(f.top,'config.json');
 f.run=(mode,extra={})=>{
  writeFileSync(f.config,JSON.stringify({top:f.top,source:f.source,sha:f.revision,plan:f.plan,mode,...extra}));
  const result=execFileSync(process.execPath,[new URL('./candidate-transport-run.mjs',import.meta.url).pathname,f.config],{env:{...process.env,HOME:f.home,PATH:f.bin+':'+process.env.PATH,CANDIDATE_TRANSPORT_CONFIG:f.config},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  return JSON.parse(result);
 };
 f.calls=()=>existsSync(f.log)?readFileSync(f.log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return f;
}
