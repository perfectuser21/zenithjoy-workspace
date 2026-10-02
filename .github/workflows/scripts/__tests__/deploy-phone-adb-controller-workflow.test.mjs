import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, "..", "..", "deploy-phone-adb-controller.yml");

// 注意：这份测试故意不依赖 `yaml` 包（不做结构化解析），只对文件原始文本做正则/字符串匹配。
// 原因：本文件由 ci-l3-code.yml 的 openclaw-scripts-test job 直接 node --test，
// 那个 job 的设计原则是"无需装依赖，几秒钟跑完"（不跑 npm ci）。引入 `import YAML from "yaml"`
// 会让这个 job 在 import 阶段就失败——修法是把测试改成不依赖 yaml，而不是给这个 job 加 npm ci。

test("workflow 文件存在", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), `workflow 文件不存在: ${WORKFLOW_PATH}`);
});

test("push trigger 的 paths 命中 services/phone-adb-controller/**", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    yamlText,
    /paths:\s*\n\s*-\s*["']?services\/phone-adb-controller\/\*\*["']?/,
    "push.paths 必须包含 services/phone-adb-controller/**",
  );
  assert.match(yamlText, /branches:\s*\[main\]|branches:\s*\n\s*-\s*main/, "push.branches 必须包含 main");
});

test("含 workflow_dispatch 手动触发入口", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /workflow_dispatch:/, "缺少 workflow_dispatch，dev 阶段无法手动 dry-run");
});

test("使用 tailscale/github-action@v3 接入 tailnet，复用同名 secrets", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /uses:\s*tailscale\/github-action@v3/, "必须用 tailscale/github-action@v3（与 deploy-us-vps.yml 同版本）");
  assert.match(yamlText, /secrets\.TAILSCALE_AUTHKEY/, "必须复用已有的 TAILSCALE_AUTHKEY secret");
  assert.match(yamlText, /secrets\.US_MAC_TAILSCALE_IP/, "必须复用已有的 US_MAC_TAILSCALE_IP secret");
  assert.match(yamlText, /secrets\.US_MAC_SSH_KEY/, "必须复用已有的 US_MAC_SSH_KEY secret");
  assert.match(yamlText, /secrets\.US_MAC_USER/, "必须复用已有的 US_MAC_USER secret");
});

test("远程执行块调用 deploy.sh 和 drift-check.sh", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /services\/phone-adb-controller\/deploy\.sh/, "必须调用现有 deploy.sh，不能重新实现部署逻辑");
  assert.match(yamlText, /services\/phone-adb-controller\/drift-check\.sh/, "必须调用现有 drift-check.sh 做后验");
});

test("远程执行块 source 了工作区干净判定 lib 并在不干净时 exit 非零", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /deploy-phone-adb-remote-lib\.sh/, "必须 source Task 1 写的判定 lib，不能内联重复逻辑");
  assert.match(yamlText, /check_clean_checkout/, "必须调用 check_clean_checkout 函数");
});

test("成功和失败都调用 notify-bark.js 通知", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const matches = yamlText.match(/notify-bark\.js/g) || [];
  assert.ok(matches.length >= 2, `notify-bark.js 至少要出现2次(成功路径+失败路径)，实际: ${matches.length}`);
});

test("失败兜底 job 存在（if: failure()）", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /if:\s*failure\(\)/, "必须有一个 if: failure() 的兜底通知 job（主 job 内部的 bark 调用可能因为 SSH 连不上而根本没机会跑）");
});

test("deploy.sh 和 drift-check.sh 调用都重定向 stdin（防 heredoc 假绿回归，C1）", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    yamlText,
    /deploy\.sh\s*<\/dev\/null/,
    "deploy.sh 调用必须加 </dev/null，否则会吃掉heredoc剩余内容导致后续步骤被跳过但job仍是绿的(C1)",
  );
  assert.match(
    yamlText,
    /drift-check\.sh\s*<\/dev\/null/,
    "drift-check.sh 调用必须加 </dev/null，同上",
  );
});

test("成功判定断言 drift-check 输出里真的含 DRIFT_CHECK OK（防第二种假绿，N3）", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    yamlText,
    /grep -q ["']DRIFT_CHECK OK["']/,
    "成功通知前必须校验 DRIFT_LOG 里包含 DRIFT_CHECK OK，不能只看 drift-check.sh 的退出码（必须是 grep -q \"DRIFT_CHECK OK\" 这个判断语句本身，不能只匹配裸字符串，否则判断语句被删掉换成 true 之类的，测试还是绿的）",
  );
});

test("DEPLOY_FAIL_DETAIL赋值带 || true(防set -e下grep空匹配杀脚本回归)", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    yamlText,
    /grep '❌' \| head -3 \| tr '\\n' ';' \|\| true\)"/,
    "DEPLOY_FAIL_DETAIL赋值末尾必须有 || true，否则deploy.sh输出里没有❌时(最常见失败场景之一，比如某台机器连不上)set -e会直接杀死整个脚本，导致连专属Bark告警都发不出去",
  );
});

test('主线部署消费已成功的Implementation impact同run证据且凭据不进artifact',()=>{
 const text=fs.readFileSync(WORKFLOW_PATH,'utf8');
 assert.match(text,/workflow_run:/);assert.match(text,/Implementation impact/);assert.match(text,/implementation_run_id/);
 assert.match(text,/phone-deploy-evidence\.mjs/);assert.match(text,/deployment-prepare\.mjs/);
 assert.doesNotMatch(text,/secrets\.CECELIA_INTERNAL_TOKEN/,'Brain token必须留在mmv已有镜像');
 assert.ok(text.indexOf('phone-deploy-evidence.mjs')<text.indexOf('uses: tailscale/github-action'),'证据身份先于目标网络操作');
});
