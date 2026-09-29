import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, "..", "..", "deploy-phone-adb-controller.yml");

function loadWorkflow() {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  return YAML.parse(text);
}

test("workflow 文件存在且是合法 YAML", () => {
  const doc = loadWorkflow();
  assert.ok(doc, "解析结果不应为空");
});

test("push trigger 的 paths 命中 services/phone-adb-controller/**", () => {
  const doc = loadWorkflow();
  // YAML 里的裸 key `on` 会被 JS YAML 解析成布尔 key `true`，这里两种都兼容取一下
  const on = doc.on ?? doc[true];
  assert.ok(on, "缺少 on 触发器定义");
  assert.ok(on.push, "缺少 push 触发器");
  assert.ok(Array.isArray(on.push.paths), "push.paths 必须是数组");
  assert.ok(
    on.push.paths.includes("services/phone-adb-controller/**"),
    `push.paths 必须包含 services/phone-adb-controller/**，实际: ${JSON.stringify(on.push.paths)}`,
  );
  assert.ok(on.push.branches?.includes("main"), "push.branches 必须包含 main");
});

test("含 workflow_dispatch 手动触发入口", () => {
  const doc = loadWorkflow();
  const on = doc.on ?? doc[true];
  assert.ok("workflow_dispatch" in on, "缺少 workflow_dispatch，dev 阶段无法手动 dry-run");
});

test("使用 tailscale/github-action@v3 接入 tailnet，复用同名 secrets", () => {
  const doc = loadWorkflow();
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
  const doc = loadWorkflow();
  const jobs = Object.values(doc.jobs || {});
  const hasFailureJob = jobs.some((j) => String(j.if || "").includes("failure()"));
  assert.ok(hasFailureJob, "必须有一个 if: failure() 的兜底通知 job（主 job 内部的 bark 调用可能因为 SSH 连不上而根本没机会跑）");
});
