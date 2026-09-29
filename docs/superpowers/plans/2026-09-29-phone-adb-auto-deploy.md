# 智能获客(phone-adb-controller) 自动部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** push 到 main 且改动命中 `services/phone-adb-controller/**` 时，自动把代码部署到 mmv/xian-m4/xian-m1 三台真机并验证生效，全程无需人工点击。

**Architecture:** 新增一个 GitHub Actions workflow，复用仓库已有的 `tailscale/github-action@v3` + SSH 到 mmv 的连接模式（与 `deploy-us-vps.yml`/`promote-prod-hk.yml` 同构），SSH 会话里跑仓库已有的 `services/phone-adb-controller/deploy.sh`（推三机）+ `drift-check.sh`（后验），再用仓库已有的 `notify-bark.js` 发送成功/失败通知。

**Tech Stack:** GitHub Actions（ubuntu-latest）、Tailscale、SSH、Bash、Node.js（`node --test`）、`yaml` npm 包（已是依赖）、`actionlint`（本机已装于 `/opt/homebrew/bin/actionlint`）。

## Global Constraints

- 不新建 secret：`TAILSCALE_AUTHKEY`、`US_MAC_TAILSCALE_IP`、`US_MAC_SSH_KEY`、`US_MAC_USER` 全部复用 `deploy-us-vps.yml` 已用的同名 repo secrets。
- 不改动 `services/phone-adb-controller/deploy.sh`、`drift-check.sh`、`notify-bark.js` 本身的行为。
- 不建 self-hosted runner，不建 staging 环境（决策 `639800cc`：这三台物理机本身就是生产，无 staging）。
- 部署前发现 mmv 本地 checkout 不干净 → 直接中止并告警，绝不 `git reset --hard` 静默覆盖。
- 所有新增文件的 commit message 遵循 Conventional Commits。
- 所有输出/日志/注释使用简体中文（沿用仓库现有 `.sh`/`.yml` 文件的注释语言习惯）。

---

## 文件结构总览

- 新建 `.github/workflows/scripts/deploy-phone-adb-remote-lib.sh` — 唯一有独立判断逻辑的部分（"工作区是否干净"判定），可脱离 GitHub Actions 单独测试。
- 新建 `.github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs` — 对上面这个 lib 的单元测试。
- 新建 `.github/workflows/deploy-phone-adb-controller.yml` — 主 workflow：trigger + tailscale 接入 + SSH 远程执行（source 上面的 lib + 调 deploy.sh/drift-check.sh + bark 通知）+ 失败兜底通知 job。
- 新建 `.github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs` — 对 workflow YAML 本身结构的断言测试（trigger paths、secrets 引用、action 版本）。

---

### Task 1: 工作区干净判定的可测试 lib 函数

**Files:**
- Create: `.github/workflows/scripts/deploy-phone-adb-remote-lib.sh`
- Test: `.github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs`

**Interfaces:**
- Produces: shell 函数 `check_clean_checkout <repo_dir>`——`repo_dir` 工作区干净（`git status --short` 输出为空）时 return 0 且不打印任何内容；不干净时 return 1 且把 `ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查` 写到 stderr。

- [ ] **Step 1: 写失败测试**

创建 `.github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs`：

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "deploy-phone-adb-remote-lib.sh");

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-checkout-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
node --test .github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs 2>&1 | tail -20
```

预期：报错找不到 `.github/workflows/scripts/deploy-phone-adb-remote-lib.sh`（文件不存在）或 `check_clean_checkout: command not found`。

- [ ] **Step 3: 写最小实现**

创建 `.github/workflows/scripts/deploy-phone-adb-remote-lib.sh`：

```bash
#!/bin/bash
# deploy-phone-adb-remote-lib.sh —— phone-adb-controller 自动部署 workflow 的远端判断逻辑
# 从 .github/workflows/deploy-phone-adb-controller.yml 的 SSH 远程 heredoc 里 source，
# 也可独立跑单测（见 __tests__/deploy-phone-adb-remote-lib.test.mjs）。

# check_clean_checkout REPO_DIR
#   REPO_DIR 工作区干净(无未提交/未跟踪改动) -> return 0，无输出
#   不干净 -> return 1，stderr 打印 ABORT 提示（自动部署绝不 git reset --hard 静默覆盖本地改动）
check_clean_checkout() {
  local repo_dir="$1"
  if [[ -n "$(git -C "$repo_dir" status --short)" ]]; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  return 0
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
node --test .github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs 2>&1 | tail -20
```

预期：3 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
chmod +x .github/workflows/scripts/deploy-phone-adb-remote-lib.sh
git add .github/workflows/scripts/deploy-phone-adb-remote-lib.sh .github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs
git commit -m "feat(ci): 新增phone-adb自动部署的工作区干净判定lib+单测

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: workflow YAML 结构断言测试（先写测试，此时应失败因为 workflow 文件不存在）

**Files:**
- Test: `.github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs`

**Interfaces:**
- Consumes: 无（纯读文件+解析 YAML）
- Produces: 无（这是纯断言测试，为 Task 3 的 workflow 文件划定必须满足的结构契约）

- [ ] **Step 1: 写失败测试**

创建 `.github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs`：

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
node --test .github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs 2>&1 | tail -30
```

预期：第一个测试就因为 `ENOENT`（找不到 `deploy-phone-adb-controller.yml`）失败，后续测试跟着失败。

- [ ] **Step 3: Commit（测试先行，此时是红的，正常提交，Task 3 会让它变绿）**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
git add .github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs
git commit -m "test(ci): 钉phone-adb自动部署workflow的结构契约(先红)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 完整 workflow 文件（让 Task 2 的测试变绿）

**Files:**
- Create: `.github/workflows/deploy-phone-adb-controller.yml`

**Interfaces:**
- Consumes: Task 1 的 `check_clean_checkout`（sourced 进 SSH 远程 heredoc）；Task 2 定义的结构契约（本任务的产出必须让那些测试全绿）
- Produces: 无（这是终端交付物，没有后续任务依赖它的接口）

- [ ] **Step 1: 写 workflow 文件**

创建 `.github/workflows/deploy-phone-adb-controller.yml`：

```yaml
name: Deploy phone-adb-controller to mmv+xian-m4+xian-m1

# ───────────────────────────────────────────────────────────────────────────
# 背景（0929）：services/phone-adb-controller/ 的代码合并到 main 之后，此前完全靠人肉记得
# 手动跑 deploy.sh 才会真的出现在跑它的三台机器（mmv 本机 + 西安 xian-m4/xian-m1）上——
# DoD 审计批次4(PR #2006) merge 6 小时后三机仍是旧代码就是实锤。决策 639800cc：
# 合并自动直推三机，不加人工确认闸（这三台物理机本身就是生产，没有等价的 staging 手机）。
#
# 连接模式完全复用 deploy-us-vps.yml / promote-prod-hk.yml 已验证过的
# tailscale/github-action + SSH 到 mmv，不新建任何连接通道。
# mmv 自己已配置好到 xian-m4/xian-m1 的 SSH 别名，deploy.sh 从 mmv 上跑就能推三机。
# ───────────────────────────────────────────────────────────────────────────

on:
  push:
    branches: [main]
    paths:
      - "services/phone-adb-controller/**"
  workflow_dispatch: {}

jobs:
  deploy:
    name: 部署到 mmv + xian-m4 + xian-m1
    runs-on: ubuntu-latest

    steps:
      - name: 接入 Tailscale
        uses: tailscale/github-action@v3
        with:
          authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
          version: latest

      - name: Tailnet 诊断（status/ping/port22）
        env:
          SSH_HOST: ${{ secrets.US_MAC_TAILSCALE_IP }}
        run: |
          echo "── tailscale status"
          sudo tailscale status | head -20 || true
          echo "── 目标 $SSH_HOST 是否在 peers"
          sudo tailscale status | grep -F "$SSH_HOST" || echo "⚠️ 目标 IP 不在 peers 列表"
          echo "── tailscale ping"
          sudo tailscale ping -c 3 --timeout 5s "$SSH_HOST" || echo "⚠️ tailscale ping 不通"

      - name: SSH 到 mmv 部署三机 + drift-check + Bark 通知
        env:
          SSH_KEY: ${{ secrets.US_MAC_SSH_KEY }}
          SSH_HOST: ${{ secrets.US_MAC_TAILSCALE_IP }}
          SSH_USER: ${{ secrets.US_MAC_USER }}
          DEPLOY_SHA: ${{ github.sha }}
        timeout-minutes: 15
        run: |
          KEY_FILE=$(mktemp)
          printf '%s\n' "$SSH_KEY" > "$KEY_FILE"
          chmod 600 "$KEY_FILE"

          ssh -o StrictHostKeyChecking=no \
              -o ConnectTimeout=30 \
              -o ServerAliveInterval=60 \
              -i "$KEY_FILE" \
              -p 22 \
              "${SSH_USER}@${SSH_HOST}" \
              bash -s -- "$DEPLOY_SHA" << 'REMOTE_EOF'
          set -euo pipefail
          DEPLOY_SHA="$1"
          REPO="$HOME/perfect21/zenithjoy-workspace"
          BARK="$HOME/.openclaw/leadgen-scripts/notify-bark.js"

          b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
          notify() {
            # notify TITLE BODY [level]
            node "$BARK" "$(b64 "$1")" "$(b64 "$2")" "${3:-timeSensitive}" || true
          }

          # shellcheck source=/dev/null
          source "$REPO/.github/workflows/scripts/deploy-phone-adb-remote-lib.sh"

          if ! check_clean_checkout "$REPO"; then
            notify "phone-adb自动部署已跳过" "mmv本地checkout不干净,需人工检查(sha=${DEPLOY_SHA:0:8})"
            exit 1
          fi

          echo "=== [1/3] git sync → ${DEPLOY_SHA} ==="
          git -C "$REPO" fetch --force --prune origin main
          git -C "$REPO" reset --hard "$DEPLOY_SHA"

          echo "=== [2/3] deploy.sh（推 mmv + xian-m4 + xian-m1）==="
          cd "$REPO"
          if ! DEPLOY_LOG=$(bash services/phone-adb-controller/deploy.sh 2>&1); then
            echo "$DEPLOY_LOG"
            notify "phone-adb自动部署失败" "deploy.sh语法检查失败(sha=${DEPLOY_SHA:0:8}): $(echo "$DEPLOY_LOG" | grep '❌' | head -3 | tr '\n' ';')"
            exit 1
          fi
          echo "$DEPLOY_LOG"

          echo "=== [3/3] drift-check.sh 后验 ==="
          if ! DRIFT_LOG=$(bash services/phone-adb-controller/drift-check.sh 2>&1); then
            echo "$DRIFT_LOG"
            notify "phone-adb自动部署后验失败" "drift-check未通过(sha=${DEPLOY_SHA:0:8}): $(echo "$DRIFT_LOG" | tail -3 | tr '\n' ';')"
            exit 1
          fi
          echo "$DRIFT_LOG"

          notify "phone-adb自动部署成功" "已部署到mmv+xian-m4+xian-m1并通过drift-check(sha=${DEPLOY_SHA:0:8})" "active"
          echo "✅ 全部完成"
          REMOTE_EOF

          rm -f "$KEY_FILE"

  notify-connect-failure:
    name: SSH/Tailscale 连接失败兜底通知
    runs-on: ubuntu-latest
    needs: [deploy]
    if: failure()
    steps:
      - name: 接入 Tailscale（复用同一 authkey，仅为了能发通知，不重跑部署）
        uses: tailscale/github-action@v3
        with:
          authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
          version: latest
      - name: SSH 到 mmv 发送 Bark 告警（deploy job 内部因连不上/超时而没机会自己发通知时兜底）
        env:
          SSH_KEY: ${{ secrets.US_MAC_SSH_KEY }}
          SSH_HOST: ${{ secrets.US_MAC_TAILSCALE_IP }}
          SSH_USER: ${{ secrets.US_MAC_USER }}
        run: |
          KEY_FILE=$(mktemp)
          printf '%s\n' "$SSH_KEY" > "$KEY_FILE"
          chmod 600 "$KEY_FILE"
          TITLE_B64=$(printf '%s' "phone-adb自动部署workflow失败" | base64 | tr -d '\n')
          BODY_B64=$(printf '%s' "deploy job本身失败(可能是tailnet/SSH连不上),见GitHub Actions run日志" | base64 | tr -d '\n')
          ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -i "$KEY_FILE" \
              "${SSH_USER}@${SSH_HOST}" \
              "node \$HOME/.openclaw/leadgen-scripts/notify-bark.js '$TITLE_B64' '$BODY_B64'" || true
          rm -f "$KEY_FILE"
```

- [ ] **Step 2: 运行 Task 2 的结构测试确认全绿**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
node --test .github/workflows/scripts/__tests__/deploy-phone-adb-controller-workflow.test.mjs 2>&1 | tail -30
```

预期：所有测试 PASS。若 `on.push.paths` 或 secrets 名称断言失败，回去核对 YAML 缩进/字段名（YAML 解析对缩进敏感）。

- [ ] **Step 3: actionlint 语法校验**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
actionlint .github/workflows/deploy-phone-adb-controller.yml
```

预期：无输出（无错误）。若报 SC2086 之类 shellcheck 警告，逐条确认是否需要加引号修复（heredoc 内的变量已基本加了引号）。

- [ ] **Step 4: 跑 Task 1 的单测确认没有被这次改动破坏**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
node --test .github/workflows/scripts/__tests__/deploy-phone-adb-remote-lib.test.mjs 2>&1 | tail -20
```

预期：3 个测试仍然 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
git add .github/workflows/deploy-phone-adb-controller.yml
git commit -m "feat(ci): phone-adb-controller merge main自动部署三机(决策639800cc)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: 手动 dry-run 验证 + DoD 收尾

**Files:**
- 无新文件，纯验证动作

**Interfaces:**
- Consumes: Task 3 产出的完整 workflow 文件
- Produces: 无

- [ ] **Step 1: push 分支后，用 GitHub CLI 手动触发一次 workflow_dispatch 验证全链路**

```bash
cd /Users/administrator/worktrees/zenithjoy-workspace/phone-adb-auto-deploy
git push -u origin HEAD
gh workflow run deploy-phone-adb-controller.yml --repo perfectuser21/zenithjoy-workspace --ref "$(git branch --show-current)"
```

- [ ] **Step 2: 等待并检查这次手动跑的结果**

```bash
sleep 15
RUN_ID=$(gh run list --repo perfectuser21/zenithjoy-workspace --workflow deploy-phone-adb-controller.yml --branch "$(git branch --show-current)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo perfectuser21/zenithjoy-workspace --exit-status
```

预期：跑通（因为这个分支此时的 `services/phone-adb-controller/` 内容与 main 一致，`check_clean_checkout` 应该通过，`deploy.sh`/`drift-check.sh` 应该照常成功——这实际上是本次改动第一次真实验证全链路，如果失败要看日志定位是 SSH 连接问题还是脚本本身问题）。

- [ ] **Step 3: 确认收到 Bark 通知**

跟主理人确认手机上是否收到"phone-adb自动部署成功"的 Bark 推送。若没收到但 workflow 显示成功，检查是 `notify-bark.js` 本身的 `~/.credentials/bark.env` 配置问题（不属于本次改动范围，但要如实报告，不能算"完成"）。

- [ ] **Step 4: 最终检查清单**

- [ ] `node --test .github/workflows/scripts/__tests__/*.test.mjs` 全绿
- [ ] `actionlint .github/workflows/deploy-phone-adb-controller.yml` 无输出
- [ ] 手动 `workflow_dispatch` 跑通一次，drift-check 通过
- [ ] Bark 通知实际收到
- [ ] CI（该 PR 自身触发的常规 CI）全绿
