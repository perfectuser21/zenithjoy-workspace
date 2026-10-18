import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LIB = path.join(__dirname, "..", "deploy-phone-adb-remote-lib.sh");

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-checkout-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function runCheck(repoDir) {
  // 用 spawnSync 而非 execFileSync：execFileSync 成功时只返回 stdout，
  // 无法验证"成功路径是否意外往 stderr 输出了内容"；spawnSync 无论成败都会真实回传 stderr。
  const result = spawnSync(
    "bash",
    ["-c", `source "${LIB}" && check_clean_checkout "${repoDir}"`],
    { encoding: "utf8" },
  );
  return {
    code: result.status,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  };
}

test("干净工作区 → return 0，无输出", () => {
  const dir = makeTempRepo();
  const result = runCheck(dir);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr, "");
});

test("repo_dir 不是 git 仓库 → return 1，stderr 带中文 ABORT 提示（不泄漏 git 原生英文报错）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-checkout-test-notgit-"));
  const result = runCheck(dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查/);
  assert.doesNotMatch(result.stderr, /fatal: not a git repository/);
});

test("有未提交改动 → return 1，stderr 带 ABORT 提示", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
  const result = runCheck(dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查/);
});

test("只有未跟踪新文件(无已跟踪改动) → return 0，不阻拦部署", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");
  const result = runCheck(dir);
  assert.equal(result.code, 0);
});

test("未跟踪新文件 + 已跟踪文件改动同时存在 → 仍然 return 1", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
  const result = runCheck(dir);
  assert.equal(result.code, 1);
});

const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function deploymentFixture(t){
 const repo=fs.realpathSync(makeTempRepo()),base=fs.mkdtempSync(path.join(os.tmpdir(),'deploy-worktrees-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 git(repo,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const sha=git(repo,'rev-parse','HEAD');git(repo,'update-ref','refs/remotes/origin/main',sha);
 git(repo,'checkout','-qb','cp-user-work');fs.writeFileSync(path.join(repo,'a.txt'),'user dirty bytes\n');fs.writeFileSync(path.join(repo,'untracked.txt'),'keep me\n');
 return {repo,base:fs.realpathSync(base),sha};
}
function prepare(f,sha=f.sha){return spawnSync('bash',['-c','source "$1"; prepare_deployment_checkout "$2" "$3" "$4"','test',LIB,f.repo,sha,f.base],{encoding:'utf8'});}
test('真实脏非main原仓创建并复用固定SHA detached部署树，原分支与字节不变',t=>{
 const f=deploymentFixture(t),before=git(f.repo,'status','--porcelain');
 const first=prepare(f);assert.equal(first.status,0,first.stderr);const target=first.stdout.trim();assert.equal(target,path.join(f.base,f.sha));
 assert.equal(git(target,'rev-parse','HEAD'),f.sha);assert.equal(spawnSync('git',['-C',target,'symbolic-ref','-q','HEAD']).status,1);assert.equal(git(target,'status','--porcelain'),'');
 assert.equal(prepare(f).stdout.trim(),target);assert.equal(git(f.repo,'branch','--show-current'),'cp-user-work');assert.equal(git(f.repo,'status','--porcelain'),before);assert.equal(fs.readFileSync(path.join(f.repo,'a.txt'),'utf8'),'user dirty bytes\n');
});
test('旧run与错误origin在创建目录前拒绝，脏原仓保留',t=>{
 const f=deploymentFixture(t);assert.notEqual(prepare(f,'b'.repeat(40)).status,0);assert.equal(fs.existsSync(path.join(f.base,'b'.repeat(40))),false);
 git(f.repo,'remote','set-url','origin','https://github.com/other/repo.git');assert.notEqual(prepare(f).status,0);assert.equal(fs.existsSync(path.join(f.base,f.sha)),false);
});
test('复用树有tracked/untracked漂移拒绝，绝不reset或删除',t=>{
 const f=deploymentFixture(t);assert.equal(prepare(f).status,0);const target=path.join(f.base,f.sha);
 fs.writeFileSync(path.join(target,'a.txt'),'deployment drift');assert.notEqual(prepare(f).status,0);assert.equal(fs.readFileSync(path.join(target,'a.txt'),'utf8'),'deployment drift');
 fs.writeFileSync(path.join(target,'a.txt'),'hello\n');fs.writeFileSync(path.join(target,'foreign'),'retain');assert.notEqual(prepare(f).status,0);assert.equal(fs.readFileSync(path.join(target,'foreign'),'utf8'),'retain');
});
test('伪装目标：软链、其它Git common目录或非detached树一律拒绝',t=>{
 const f=deploymentFixture(t),other=fs.realpathSync(makeTempRepo());t.after(()=>fs.rmSync(other,{recursive:true,force:true}));const target=path.join(f.base,f.sha);
 fs.symlinkSync(other,target);assert.notEqual(prepare(f).status,0);fs.unlinkSync(target);
 git(other,'worktree','add','--detach',target);assert.notEqual(prepare(f).status,0);git(other,'worktree','remove',target);
 assert.equal(prepare(f).status,0);git(target,'checkout','-qb','cp-foreign-branch');assert.notEqual(prepare(f).status,0);
});

test('same fixed deployment checkout accepts only verified generated Skills and clean pinned cache on retry',t=>{
 const f=deploymentFixture(t),source=path.join(f.base,'source');fs.mkdirSync(path.join(source,'distribution'),{recursive:true});
 const payload='fixed runtime skill\n',destination='.skills-runtime/android-publish/SKILL.md';
 const sha256=bytes=>execFileSync('python3',['-c','import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'],{input:bytes,encoding:'utf8'}).trim();
 const loader='import argparse,pathlib,hashlib,json\np=argparse.ArgumentParser();p.add_argument("command");p.add_argument("--workspace");p.add_argument("--source");a=p.parse_args();w=pathlib.Path(a.workspace);s=pathlib.Path(a.source);c=json.loads((s/"distribution/catalog.json").read_text());e=c["profiles"]["zenithjoy"]["files"][0];assert hashlib.sha256((w/e["path"]).read_bytes()).hexdigest()==e["sha256"]\n';
 fs.writeFileSync(path.join(source,'distribution/skills_source.py'),loader);fs.writeFileSync(path.join(source,'manual.md'),payload);
 const entry={path:destination,source:'manual.md',sha256:sha256(payload),mode:'100644'};
 fs.writeFileSync(path.join(source,'distribution/catalog.json'),JSON.stringify({version:1,profiles:{zenithjoy:{files:[entry]}}}));
 git(source,'init','-q','-b','cp-fixture');git(source,'config','core.hooksPath','/dev/null');git(source,'add','.');git(source,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','source');
 const revision=git(source,'rev-parse','HEAD');fs.mkdirSync(path.join(f.repo,'scripts'));fs.copyFileSync(path.join(__dirname,'../../../../scripts/skills-source.py'),path.join(f.repo,'scripts/skills-source.py'));
 fs.writeFileSync(path.join(f.repo,'.skills-source.json'),JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',revision,profile:'zenithjoy',loader_sha256:sha256(loader)}));
 fs.writeFileSync(path.join(f.repo,'.gitignore'),'.skills-source/\n.skills-runtime/\n.skills-source-state.json\nforeign/\n');
 git(f.repo,'add','scripts/skills-source.py','.skills-source.json','.gitignore');git(f.repo,'commit','-qm','pin skills');f.sha=git(f.repo,'rev-parse','HEAD');git(f.repo,'update-ref','refs/remotes/origin/main',f.sha);
 const first=prepare(f);assert.equal(first.status,0,first.stderr);const target=first.stdout.trim();
 git(f.base,'clone','-q',source,path.join(target,'.skills-source'));
 fs.mkdirSync(path.join(target,'.skills-runtime/android-publish'),{recursive:true});fs.writeFileSync(path.join(target,destination),payload);
 fs.writeFileSync(path.join(target,'.skills-source-state.json'),JSON.stringify({revision,files:{[destination]:entry.sha256}}));
 const retry=prepare(f);assert.equal(retry.status,0,retry.stderr);assert.equal(retry.stdout.trim(),target);
 fs.writeFileSync(path.join(target,destination),'dirty generated skill');assert.notEqual(prepare(f).status,0);fs.writeFileSync(path.join(target,destination),payload);
 fs.writeFileSync(path.join(target,'.skills-source/manual.md'),'dirty source cache');assert.notEqual(prepare(f).status,0);fs.writeFileSync(path.join(target,'.skills-source/manual.md'),payload);
 fs.mkdirSync(path.join(target,'foreign'));fs.writeFileSync(path.join(target,'foreign/ignored'),'must remain');assert.notEqual(prepare(f).status,0);
 assert.equal(fs.readFileSync(path.join(target,'foreign/ignored'),'utf8'),'must remain');
});
