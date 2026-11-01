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

test("发布由主线Pilot release verification完成触发，不抢在证据前裸push",()=>{
 const text=fs.readFileSync(WORKFLOW_PATH,'utf8');
 assert.match(text,/workflow_run:/);assert.match(text,/workflows: \[Pilot release verification\]/);assert.match(text,/types: \[completed\]/);assert.match(text,/branches: \[main\]/);
 assert.doesNotMatch(text,/^  push:/m);
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
  assert.match(yamlText, /services\/phone-adb-controller\/deployment-prepare\.mjs/);
  const wrapper=fs.readFileSync(path.join(__dirname,"../../../../services/phone-adb-controller/deployment-prepare.mjs"),"utf8");
  assert.match(wrapper, /spawn\('bash',\[join\(root,'services\/phone-adb-controller\/deploy\.sh'\)/, "wrapper必须调用现有deploy.sh");
  const backend=fs.readFileSync(path.join(__dirname,"../../../../services/phone-adb-controller/deployment-backend.mjs"),"utf8");
  assert.match(backend,/runDriftCheck\('bash',\[join\(HERE,'drift-check\.sh'\)\]/,"drift必须在事务提交前运行");
  assert.match(backend,/DRIFT_REF:sha,DRIFT_SKIP_FETCH:'1'/);
});

test("远程执行块 source 固定SHA lib并使用独立checkout，原仓不reset", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(yamlText, /deploy-phone-adb-remote-lib\.sh/, "必须 source Task 1 写的判定 lib，不能内联重复逻辑");
  assert.match(yamlText, /prepare_deployment_checkout "\$REPO" "\$DEPLOY_SHA"/);
  assert.match(yamlText, /cd "\$DEPLOY_CHECKOUT"/);
  assert.doesNotMatch(yamlText, /reset --hard|CURRENT_BRANCH=/);
  assert.ok(yamlText.indexOf('rev-parse origin/main')<yamlText.indexOf('source "$LIB_TMP"'));
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
    /DEPLOY_ENTRY=\(node "\$TOOL_CHECKOUT\/services\/phone-adb-controller\/deployment-prepare\.mjs"\)/,
    "普通候选和晋级入口仍固定为 deployment-prepare.mjs",
  );
  assert.match(
    yamlText,
    /if \[\[ "\$DEPLOY_MODE" == maintenance-install \|\| "\$DEPLOY_MODE" == maintenance-recover \]\]; then\s+DEPLOY_ENTRY=\(python3 "\$TOOL_CHECKOUT\/services\/phone-adb-controller\/deployment-guard\.py" "\$\{DEPLOY_ENTRY\[@\]\}"\)/,
    "安全模式必须在同一正式入口外层继承部署租锁",
  );
  assert.match(
    yamlText,
    /DEPLOY_LOG=\$\("\$\{DEPLOY_ENTRY\[@\]\}"[^\n]*<\/dev\/null/,
    "正式入口调用必须加 </dev/null，否则会吃掉 heredoc 剩余内容导致假绿(C1)",
  );
  const helper=fs.readFileSync(path.join(__dirname,"../../../../services/phone-adb-controller/deployment-drift.mjs"),"utf8");
  assert.match(helper,/stdio:\['ignore','pipe','pipe'\]/,"事务内drift也不能消费外层stdin");
});

test("事务内drift保留真实退出码和成功回执行为回归",async()=>{
  const {runDriftCheck}=await import('../../../../services/phone-adb-controller/deployment-drift.mjs');
  assert.throws(()=>runDriftCheck(process.execPath,['-e',"console.log('copied')"],process.env),/真实成功回执/);
  assert.throws(()=>runDriftCheck(process.execPath,['-e',"console.log('DRIFT_CHECK OK');process.exit(1)"],process.env));
  assert.match(runDriftCheck(process.execPath,['-e',"console.log('DRIFT_CHECK OK')"],process.env),/DRIFT_CHECK OK/);
});

test("DEPLOY_FAIL_DETAIL赋值带 || true(防set -e下grep空匹配杀脚本回归)", () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    yamlText,
    /grep '❌' \| head -3 \| tr '\\n' ';' \|\| true\)"/,
    "DEPLOY_FAIL_DETAIL赋值末尾必须有 || true，否则deploy.sh输出里没有❌时(最常见失败场景之一，比如某台机器连不上)set -e会直接杀死整个脚本，导致连专属Bark告警都发不出去",
  );
});

test('主线部署消费已成功的Pilot release verification同run证据且凭据不进artifact',()=>{
 const text=fs.readFileSync(WORKFLOW_PATH,'utf8');
 assert.match(text,/workflow_run:/);assert.match(text,/Pilot release verification/);assert.match(text,/implementation_run_id/);
 assert.match(text,/phone-deploy-evidence\.mjs/);assert.match(text,/deployment-prepare\.mjs/);
 assert.doesNotMatch(text,/secrets\.CECELIA_INTERNAL_TOKEN/,'Brain token必须留在mmv已有镜像');
 assert.ok(text.indexOf('phone-deploy-evidence.mjs')<text.indexOf('uses: tailscale/github-action'),'证据身份先于目标网络操作');
});

test('控制SSH运输绑定候选和门禁工具SHA，两者必须是已合并主线版本',()=>{
 const text=fs.readFileSync(WORKFLOW_PATH,'utf8');
 assert.match(text,/DEPLOY_SHA: \$\{\{ steps\.evidence\.outputs\.sha \}\}/);
 assert.match(text,/CI_BUNDLE_B64='%s'/);assert.match(text,/Buffer\.from\(fs\.readFileSync\(0,"utf8"\),"base64"\)/);
 assert.match(text,/merge-base --is-ancestor "\$DEPLOY_SHA" origin\/main/);
 assert.match(text,/merge-base --is-ancestor "\$TOOL_SHA" origin\/main/);
 assert.match(text,/show "\$TOOL_SHA:\.github\/workflows\/scripts\/deploy-phone-adb-remote-lib\.sh"/);
 assert.match(text,/bash -s -- "\$DEPLOY_SHA" "\$IMPLEMENTATION_RUN_ID" "\$GITHUB_RUN_ID" "\$GITHUB_RUN_ATTEMPT"/);
 assert.doesNotMatch(text,/upload-artifact|CECELIA_INTERNAL_TOKEN=/);
});

test('正式拓扑文案与通知只声明M4手机和MMV，不要求零手机M1',()=>{
 const text=fs.readFileSync(WORKFLOW_PATH,'utf8');
 assert.doesNotMatch(text,/xian-m1|推三机|部署三机|三台物理/);
 assert.match(text,/已部署到mmv\+xian-m4并通过drift-check/);
});
