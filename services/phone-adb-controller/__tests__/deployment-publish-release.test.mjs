import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const top=mkdtempSync(join(tmpdir(),'publish-release-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
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
test('published package owns both Git histories, full dependency closure and survives source deletion',async t=>{
 const f=fixture(t),m=await import('../deployment-publish-release.mjs');const result=m.buildPublishRelease(f.source,f.revision,{home:f.home});
 assert.equal(result.package,join(f.home,'.local/share/zenithjoy/publish-releases',f.revision));
 rmSync(f.source,{recursive:true,force:true});const report=m.verifyPublishRelease(result.package,f.revision);
 assert.ok(report.files.some(x=>x.path===f.runtime));assert.ok(report.files.some(x=>x.path==='extra-runtime-contract.json'));
 assert.match(execFileSync('python3',[join(result.package,'.agents/skills/multi-platform-publish/scripts/publish_catalog.py')],{encoding:'utf8'}),/fixed phone base/);
 writeFileSync(join(result.package,f.runtime),'changed dependency');assert.throws(()=>m.verifyPublishRelease(result.package,f.revision),/漂移|checksum|不符/);
});
test('atomic activation keeps prior package and rolls links back on verification failure',async t=>{
 const f=fixture(t),m=await import('../deployment-publish-release.mjs');const first=m.buildPublishRelease(f.source,f.revision,{home:f.home});
 m.activatePublishRelease(first.package,{home:f.home});const link=join(f.home,'.openclaw/skills/multi-platform-publish'),before=readlinkSync(link);
 f.put(f.source,'extra-runtime-contract.json','{"fixed":"new"}\n');const next=f.commit(f.source),second=m.buildPublishRelease(f.source,next,{home:f.home});
 assert.throws(()=>m.activatePublishRelease(second.package,{home:f.home,verifyActivated(){throw Error('official verification failed');}}),/official verification failed/);
 assert.equal(readlinkSync(link),before);assert.ok(existsSync(first.package));
 const receipt=m.activatePublishRelease(second.package,{home:f.home});assert.notEqual(readlinkSync(link),before);
 m.rollbackPublishRelease(receipt,{home:f.home});assert.equal(readlinkSync(link),before);assert.ok(existsSync(second.package));
 const codex=join(f.home,'.codex-team1/skills/multi-platform-publish');assert.equal(readlinkSync(codex),before);
});
test('activation rejects foreign directories and package symlink escape without replacing existing entries',async t=>{
 const f=fixture(t),m=await import('../deployment-publish-release.mjs'),result=m.buildPublishRelease(f.source,f.revision,{home:f.home});
 const entry=join(f.home,'.openclaw/skills/multi-platform-publish');mkdirSync(entry,{recursive:true});writeFileSync(join(entry,'keep'),'existing directory');
 assert.throws(()=>m.activatePublishRelease(result.package,{home:f.home}),/链接|目录/);assert.equal(readFileSync(join(entry,'keep'),'utf8'),'existing directory');
 rmSync(entry,{recursive:true});rmSync(join(result.package,f.runtime));symlinkSync(join(f.top,'outside'),join(result.package,f.runtime));assert.throws(()=>m.activatePublishRelease(result.package,{home:f.home}),/链接/);
});
