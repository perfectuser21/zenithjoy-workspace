import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,symlinkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {deploymentManifest,collectDeployment} from '../deployment-manifest.mjs';
const sql='apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql';
const deployed='release-evidence/20261014_130000_leadgen_outreach_bridge.sql';
const bytes=readFileSync(new URL('../../../apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql',import.meta.url));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'sql-release-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(dirname(join(root,sql)),{recursive:true});writeFileSync(join(root,sql),bytes);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'}).toString().trim();git('init');git('add','.');const tree=git('write-tree');const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixed SQL');
 git('update-ref','HEAD',commit);return {root,commit};
}
const entries=[{path:sql,deployed_path:deployed}];
test('固定源SQL附件进入正式manifest，dirty/越界/重复落点继续拒绝',t=>{
 const {root,commit}=fixture(t);const m=deploymentManifest(root,[],{commit,repositoryFiles:entries});
 assert.equal(m.files.length,1);assert.equal(m.files[0].path,sql);assert.equal(m.files[0].deployed_path,deployed);
 assert.throws(()=>deploymentManifest(root,[],{commit,repositoryFiles:[...entries,...entries]}));
 for(const invalid of [{path:'../'+sql,deployed_path:deployed},{path:sql,deployed_path:'../outside.sql'},{path:sql,deployed_path:'release-evidence/wrong.sql'}])assert.throws(()=>deploymentManifest(root,[],{commit,repositoryFiles:[invalid]}));
 writeFileSync(join(root,sql),'changed after commit');assert.throws(()=>deploymentManifest(root,[],{commit,repositoryFiles:entries}),/固定commit/);
});
test('正式CLI附件映射必须真的输出，源缺失或错commit不得盖章',t=>{
 const {root,commit}=fixture(t);const cli=new URL('../deployment-manifest.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[cli,root,`--repository-file=${sql}=${deployed}`],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const m=JSON.parse(r.stdout);assert.equal(m.files.length,1);assert.equal(m.files[0].path,sql);
 const missing=spawnSync(process.execPath,[cli,root,'--repository-file=apps/api/db/migrations/absent.sql=release-evidence/absent.sql'],{encoding:'utf8'});assert.notEqual(missing.status,0);
});
test('原部署函数从空目录原子安装三个SQL副本且只读校验，缺失篡改/链接都不能通过',t=>{
 const {root,commit}=fixture(t);const work=join(root,'fixture');mkdirSync(work);const manifest=deploymentManifest(root,[],{commit,repositoryFiles:entries});const mf=join(root,'manifest.json');writeFileSync(mf,JSON.stringify(manifest));
 const bin=join(work,'mock-bin');mkdirSync(bin);const homes=join(work,'homes');mkdirSync(homes);for(const h of ['mmv','xian-m4'])mkdirSync(join(homes,h));
 const python=execFileSync('which',['python3'],{encoding:'utf8'}).trim();const marker=join(work,'SQL_EXECUTED');
 const shim=`#!${python}\nimport os,sys,shutil,subprocess\nfrom pathlib import Path\nmode=Path(sys.argv[0]).name\nif mode=='psql':Path(os.environ['SQL_EXECUTED_MARKER']).write_text('forbidden');sys.exit(99)\nargs=sys.argv[1:]\nif mode=='scp':\n src,dest=args[-2:];\n if os.environ.get('FAIL_SCP')=='1':sys.exit(75)\n host,relative=dest.split(':',1);p=Path(os.environ['MOCK_HOST_ROOT'])/host/relative.removeprefix('~/');shutil.copy2(src,p)\nelse:\n host,cmd=args[-2:];home=str(Path(os.environ['MOCK_HOST_ROOT'])/host);sys.exit(subprocess.call(['bash','-c',cmd],env=dict(os.environ,HOME=home)))\n`;
 for(const n of ['ssh','scp','psql']){writeFileSync(join(bin,n),shim);chmodSync(join(bin,n),0o755);}
 const source=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');const fn=source.slice(source.indexOf('push_atomic() {'),source.indexOf('# Commander 入口'));assert.ok(fn.includes('deploy_release_evidence()'),'actual attachment installer must exist');
 const script='set -euo pipefail\n'+fn+`\nREPO_ROOT=${JSON.stringify(root)}\nDEPLOY_MANIFEST=${JSON.stringify(mf)}\nRELEASE_EVIDENCE_FILES=(${JSON.stringify(sql+'='+deployed)})\ndeploy_release_evidence\n`;
 const r=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,MOCK_HOST_ROOT:homes,SQL_EXECUTED_MARKER:marker}});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.equal(existsSync(marker),false);
 const targets=[join(homes,'xian-m4/bin-harvest'),join(homes,'mmv/bin-harvest'),join(homes,'mmv/.openclaw/leadgen-scripts')];
 for(const target of targets){const p=join(target,deployed);assert.deepEqual(readFileSync(p),bytes);assert.equal(statSync(p).mode&0o777,0o600);assert.deepEqual(collectDeployment(target,manifest).files,manifest.files);
  rmSync(p);assert.throws(()=>collectDeployment(target,manifest));writeFileSync(p,'tampered');assert.throws(()=>collectDeployment(target,manifest),/digest/);rmSync(p);symlinkSync(join(root,sql),p);assert.throws(()=>collectDeployment(target,manifest),/链接|越界|symlink/);rmSync(p);writeFileSync(p,bytes,{mode:0o600});}
 // 真传输失败不能沿用旧stage或声称完成；测试只删自己的隔离FS。
 for(const target of targets)rmSync(target,{recursive:true,force:true});
 const failed=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,MOCK_HOST_ROOT:homes,SQL_EXECUTED_MARKER:marker,FAIL_SCP:'1'}});
 assert.notEqual(failed.status,0);for(const target of targets)assert.equal(existsSync(join(target,deployed)),false);
 assert.equal(existsSync(marker),false);
});
test('正式manifest调用、GP早期守卫及drift都必须包含同一附件声明',()=>{
 const deploy=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');assert.match(deploy,/^RELEASE_EVIDENCE_FILES=\(/m);assert.ok(deploy.includes(sql+'='+deployed));assert.equal((deploy.match(/"\$\{RELEASE_EVIDENCE_ARGS\[@\]\}"/g)||[]).length,2);
 assert.ok(deploy.indexOf('deploy_release_evidence\n')<deploy.indexOf('if [[ "${1:-}" == "--commander-only" ]]'));
 const smoke=readFileSync(new URL('../../../scripts/smoke/leadgen-split-smoke.sh',import.meta.url),'utf8');assert.ok(smoke.indexOf('deployment-release-evidence.test.mjs')<smoke.indexOf('env -u HOME'));
 const drift=readFileSync(new URL('../drift-check.sh',import.meta.url),'utf8');assert.match(drift,/parse_array RELEASE_EVIDENCE_FILES/);assert.ok(drift.includes('release-evidence'));
});
