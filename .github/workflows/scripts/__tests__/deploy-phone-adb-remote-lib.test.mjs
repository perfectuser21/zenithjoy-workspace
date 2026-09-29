import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  try {
    const out = execFileSync(
      "bash",
      ["-c", `source "${LIB}" && check_clean_checkout "${repoDir}"`],
      { encoding: "utf8" },
    );
    return { code: 0, stderr: "", stdout: out };
  } catch (e) {
    return { code: e.status, stderr: e.stderr ? e.stderr.toString() : "", stdout: e.stdout ? e.stdout.toString() : "" };
  }
}

test("干净工作区 → return 0，无输出", () => {
  const dir = makeTempRepo();
  const result = runCheck(dir);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "");
});

test("有未提交改动 → return 1，stderr 带 ABORT 提示", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
  const result = runCheck(dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查/);
});

test("有未跟踪新文件 → return 1", () => {
  const dir = makeTempRepo();
  fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");
  const result = runCheck(dir);
  assert.equal(result.code, 1);
});
