# GP2 安卓智能获客 smoke 守卫修复（P0批次）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复安卓智能获客(line02) golden path smoke 三处守卫失效问题：真机采集 nightly checkout 出境网络必超时、glob CI 车道漏 `TOAPIS_API_KEY` 导致 GP2 主 smoke 长期真红被当存量债吞掉、真机 Seg3 质量闸的 `xargs` trim 写法会剥掉 JSON 双引号导致 `JSON.parse` 必炸。

**Architecture:** 三个独立子修复打包进一个 PR。checkout 网络修复照抄已验证生效的 PR#1596 模式（sparse-checkout + 临时 HK exit-node）；glob 车道补密钥后需要真实触发一次 workflow_dispatch 验证再决定是否进棘轮闸；xargs bug 抽出一个可复用的 `trim_json_stdin` 函数并配一个绑定该函数的回归测试，先证明现状会炸、修完转绿。

**Tech Stack:** GitHub Actions workflow YAML、bash、node（内联 `node -e`）。

## Global Constraints

- 所有 commit message 用简体中文
- 分支：`cp-08042256-gp2-android-smoke-p0-fix`（已创建，worktree 路径 `/Users/administrator/worktrees/zenithjoy/cp-08042256-gp2-android-smoke-p0-fix`）
- 新增 smoke 脚本（文件名以 `-smoke.sh` 结尾）必须在同一提交里加入 `.github/workflows/scripts/smoke-baseline.txt`，否则 `baseline-lint` job 会红（规则见 `lint-smoke-baseline.sh`）
- `golden-path-2-smoke.sh` 加入 baseline 前必须先用 `workflow_dispatch` 实测在 glob-runner 环境下 32 步全绿，不能凭猜测加
- 不改动任何生产业务代码（apps/api、services/agent-android），只改 CI workflow 配置和真机 smoke 脚本的 trim 写法

---

### Task 1: 修复 `xargs` 剥 JSON 引号 bug（逻辑接缝，TDD）

**Files:**
- Create: `.github/workflows/scripts/smoke/lib/trim-json.sh`
- Create: `.github/workflows/scripts/smoke/trim-json-lib-smoke.sh`
- Modify: `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh:183-185`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`

**Interfaces:**
- Produces: `trim_json_stdin()` — bash 函数，从 stdin 读取文本，去除首尾空白后原样输出到 stdout（不做 shell 分词/去引号）。定义在 `lib/trim-json.sh`，`source` 后即可调用。

- [ ] **Step 1: 写 `.github/workflows/scripts/smoke/lib/trim-json.sh`**

```bash
#!/usr/bin/env bash
# trim_json_stdin — 去除 JSON 文本首尾空白，不破坏引号/内容。
#
# 用于替代 `| xargs` 做 trim：xargs（不带参数）执行标准 shell-word-splitting +
# quote-removal 语义，会把 JSON 里的双引号全部剥掉——2026-08-04
# line02-android-collect-realmachine-smoke.sh 真机 Seg3 质量闸复现：
# echo '[{"nickname":"张三"}]' | tr -d '\n' | xargs 输出 [{nickname:张三}]，
# 后续 JSON.parse 必然抛异常。sed 只做首尾空白裁剪，不触碰内容。
trim_json_stdin() {
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}
```

- [ ] **Step 2: 写回归测试 `.github/workflows/scripts/smoke/trim-json-lib-smoke.sh`**

```bash
#!/usr/bin/env bash
# trim-json-lib-smoke.sh — trim_json_stdin 回归测试
#
# 背景：2026-08-04 审计发现 line02-android-collect-realmachine-smoke.sh 的 Seg3
# 语义质量闸用 `tr -d '\n' | xargs` 做 trim，xargs 的 shell-word-splitting 语义会
# 剥掉 JSON 双引号，导致后续 JSON.parse 必炸。本测试锁定两件事：
#   (1) 复现 xargs 写法确实会破坏 JSON（防止未来有人误以为 xargs trim 是安全的）
#   (2) trim_json_stdin（新写法）不破坏 JSON，JSON.parse 能正确解析
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/trim-json.sh"

SAMPLE='[{"nickname":"张三","comment_text":"求报价"}]'

# (1) 复现根因：xargs 写法确实破坏 JSON
XARGS_RESULT=$(echo "$SAMPLE" | tr -d '\n' | xargs)
if echo "$XARGS_RESULT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{ JSON.parse(d.trim()); });
" 2>/dev/null; then
  echo "❌ FAIL: xargs 写法本应破坏 JSON（用于锁定已知 bug 复现前提），但 JSON.parse 意外成功——说明复现前提已失效，需要重新核实场景"
  exit 1
fi
echo "✅ 复现确认: tr -d '\\n' | xargs 破坏 JSON 引号（JSON.parse 失败），符合已知 bug"

# (2) 验证 trim_json_stdin 保留 JSON 引号，JSON.parse 正确解析
TRIM_RESULT=$(echo "$SAMPLE" | tr -d '\n' | trim_json_stdin)
PARSED_NICKNAME=$(echo "$TRIM_RESULT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  const arr = JSON.parse(d.trim());
  console.log(arr[0].nickname);
});
")
[ "$PARSED_NICKNAME" = "张三" ] || { echo "❌ FAIL: trim_json_stdin 后 JSON.parse 解析 nickname 期望 '张三'，实得 '$PARSED_NICKNAME'"; exit 1; }
echo "✅ PASS: trim_json_stdin 保留 JSON 引号，JSON.parse 正确解析 nickname=张三"
```

- [ ] **Step 3: 赋可执行权限，本地跑一次验证测试本身逻辑正确（此时 `line02-android-collect-realmachine-smoke.sh` 尚未改，不影响本测试——本测试只依赖新建的 lib，不依赖主脚本）**

```bash
chmod +x .github/workflows/scripts/smoke/lib/trim-json.sh \
         .github/workflows/scripts/smoke/trim-json-lib-smoke.sh
bash .github/workflows/scripts/smoke/trim-json-lib-smoke.sh
```

Expected: 两行 `✅` 输出，exit code 0（这一步测的是新 lib 本身正确，不是"先失败后修复"的 TDD 红灯——因为 lib 是全新代码，天然从写出来就是对的；真正的"先证明会炸"体现在测试内部第 (1) 段对旧 xargs 写法的复现断言，这段无论何时跑都应该稳定复现 bug）

- [ ] **Step 4: 修 `line02-android-collect-realmachine-smoke.sh` 第 183-185 行，改用 `trim_json_stdin`**

在脚本靠前位置（第 27 行 `set -uo pipefail` 之后）加一行 source：

```bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/trim-json.sh"
```

把原来的：
```bash
  LEADS_JSON=$(ssh hk-vps "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -t -c \
    \"SELECT json_agg(json_build_object('nickname', nickname, 'comment_text', comment_text, 'sec_uid', sec_uid, 'profile_url', profile_url)) \
      FROM zenithjoy.acquisition_leads WHERE collect_task_id = '$TASK' AND tenant_id = '$TENANT'\"" | tr -d '\n' | xargs)
```

改成：
```bash
  LEADS_JSON=$(ssh hk-vps "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -t -c \
    \"SELECT json_agg(json_build_object('nickname', nickname, 'comment_text', comment_text, 'sec_uid', sec_uid, 'profile_url', profile_url)) \
      FROM zenithjoy.acquisition_leads WHERE collect_task_id = '$TASK' AND tenant_id = '$TENANT'\"" | tr -d '\n' | trim_json_stdin)
```

- [ ] **Step 5: shellcheck / bash -n 语法自检**

```bash
bash -n .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
bash -n .github/workflows/scripts/smoke/lib/trim-json.sh
bash -n .github/workflows/scripts/smoke/trim-json-lib-smoke.sh
```

Expected: 无输出、exit code 0（语法合法）

- [ ] **Step 6: 把新脚本加入 `smoke-baseline.txt`（否则 `baseline-lint` job 会红）**

`trim-json-lib-smoke.sh` 按文件名字母序插入（`t` 开头，插在文件末尾附近合适位置，用 `grep -n` 找准确插入点后用 Edit 工具插入，不要用 `>>` 追加破坏排序）：

```bash
grep -n "^toutiao\|^t" .github/workflows/scripts/smoke-baseline.txt | tail -5
```
根据实际排序情况用 Edit 精确插入 `trim-json-lib-smoke.sh` 一行。

- [ ] **Step 7: 提交**

```bash
git add .github/workflows/scripts/smoke/lib/trim-json.sh \
        .github/workflows/scripts/smoke/trim-json-lib-smoke.sh \
        .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh \
        .github/workflows/scripts/smoke-baseline.txt
git commit -m "$(cat <<'EOF'
fix(ci): 修复Seg3质量闸xargs剥JSON引号bug

line02-android-collect-realmachine-smoke.sh 用 tr -d '\n' | xargs 做JSON trim，
xargs的shell分词语义会把JSON双引号全部剥掉，导致真机采到matched视频触发Seg3
质量闸时JSON.parse必炸。改用不破坏内容的sed trim（抽成可复用的trim_json_stdin
函数），配回归测试trim-json-lib-smoke.sh锁定：既复现旧xargs写法确实会炸，也验证
新写法能正确解析。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `e2e-line02-android-collect.yml` checkout 出境网络兜底（环境接缝，配置修复）

**Files:**
- Modify: `.github/workflows/e2e-line02-android-collect.yml:110-111`（`android-collect-smoke` job 的 checkout 步骤）

**Interfaces:**
- Consumes: 无（独立配置改动）

- [ ] **Step 1: 照抄 PR#1596（commit b096db80）已验证生效的模式，把第 110-111 行的裸 checkout 改成三步**

原来（第 110-111 行）：
```yaml
    steps:
      - uses: actions/checkout@v4
```

改成：
```yaml
    steps:
      # xian-rog 到 github.com 的出境网络存在两层独立问题（pc4/staging 车道
      # PR#1590/#1592/#1596/#1602 已验证并修复的同一根因）：出境带宽被 GFW 统计限速到
      # ~10KB/s；间歇性 TCP 连接失败（"Failed to connect to github.com port 443"，
      # 内置重试落空）。sparse-checkout 解决体积问题，HK exit-node 临时开关解决建连
      # 问题；--exit-node-allow-lan-access 保证真机 USB/局域网访问不受影响，checkout
      # 完立即关闭不常驻占用。
      - name: 临时开 HK exit-node 保证 checkout 能连上 github.com
        shell: bash
        run: |
          "/c/Program Files/Tailscale/tailscale.exe" set --exit-node=100.86.118.99 --exit-node-allow-lan-access || true

      - uses: actions/checkout@v4
        with:
          sparse-checkout: |
            .github/workflows/scripts/smoke
          sparse-checkout-cone-mode: false

      - name: 关闭 exit-node（不常驻占用）
        if: always()
        shell: bash
        run: |
          "/c/Program Files/Tailscale/tailscale.exe" set --exit-node= || true
```

- [ ] **Step 2: 语法自检**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e-line02-android-collect.yml'))" && echo "YAML 语法合法"
```

Expected: `YAML 语法合法`

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/e2e-line02-android-collect.yml
git commit -m "$(cat <<'EOF'
fix(ci): 安卓采集真机nightly checkout加HK exit-node+sparse-checkout修出境网络超时

e2e-line02-android-collect.yml的android-collect-smoke job跑在xian-rog
(wechat-capable)，checkout自07-16起nightly连红——出境带宽被GFW限速+间歇性TCP
连接失败，与pc4/staging车道PR#1590/#1592/#1596/#1602完全同源（08-03/08-04
run 30850569351等实锤复现）。照抄PR#1596已验证生效的模式：sparse-checkout
缩小体积+临时HK exit-node兜底建连。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 记录本步验证方式（推迟到 Task 4 统一执行）**

本改动是环境接缝，无法本地验证，proven-to-fire 证据 = Task 4 里对该 workflow 做一次 `workflow_dispatch` 触发并观察 checkout 步骤是否不再报网络错误。

---

### Task 3: `ci-smoke-glob-runner.yml` 补 `TOAPIS_API_KEY` + 实测验证 + 视情况进棘轮闸

**Files:**
- Modify: `.github/workflows/ci-smoke-glob-runner.yml:81`（`smoke-glob-runner` job env 块）
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（仅在 Step 3 实测全绿后追加）

**Interfaces:**
- Consumes: 无

- [ ] **Step 1: 在第 81 行 `FAKE_AGENT_BASE: http://localhost:5200` 后加一行**

```yaml
      FAKE_AGENT_BASE: http://localhost:5200
      # golden-path-2-smoke.sh Step 8c/23b 真调判定依赖（同 ci-l4-e2e-smoke.yml 第90行）
      TOAPIS_API_KEY: ${{ secrets.TOAPIS_API_KEY }}
```

- [ ] **Step 2: 语法自检**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-smoke-glob-runner.yml'))" && echo "YAML 语法合法"
```

Expected: `YAML 语法合法`

- [ ] **Step 3: 提交（先不动 baseline，等 CI 实测结果）**

```bash
git add .github/workflows/ci-smoke-glob-runner.yml
git commit -m "$(cat <<'EOF'
fix(ci): glob车道补TOAPIS_API_KEY——GP2主smoke此前每次死Step8c被当存量债吞掉

ci-smoke-glob-runner.yml的smoke-glob-runner job env缺TOAPIS_API_KEY（仅
ci-l4-e2e-smoke.yml有），导致golden-path-2-smoke.sh每次PR都在Step8c因
no_api_key真红，但因该脚本不在smoke-baseline.txt棘轮闸内被当存量债只报
warning不阻断（08-04 main run 30905835428实证：exit 8 FAIL被吞）。glob车道
上GP2的Step9-32从未真正执行过。补密钥后待CI实测全32步绿再决定是否进baseline。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 记录本步后续验证方式（推迟到 Task 4 统一执行）**

补密钥是否让 `golden-path-2-smoke.sh` 在 glob-runner 环境下 32 步全绿，需要一次真实 CI 运行才能确认（`SERVER_LOG` 默认值 `/tmp/apps-api.log` 与 glob-runner 的 apps/api 启动重定向路径一致，理论上兼容，但未实测过，不能凭理论加 baseline）。这一步的验证和后续 baseline 追加动作放进 Task 4。

---

### Task 4: 推送验证 + 视 CI 结果决定 baseline + 记录 P0-4 观察结果 + 开 PR

**Files:**
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（若 Task 3 验证全绿则在此追加 `golden-path-2-smoke.sh`）
- 无其他新文件（本任务是验证 + 收尾）

- [ ] **Step 1: 推送分支**

```bash
git push -u origin cp-08042256-gp2-android-smoke-p0-fix
```

- [ ] **Step 2: 手动触发 `ci-smoke-glob-runner.yml` 的 workflow_dispatch，在本分支上验证 `golden-path-2-smoke.sh` 是否 32 步全绿**

```bash
gh workflow run ci-smoke-glob-runner.yml --ref cp-08042256-gp2-android-smoke-p0-fix
```

等待运行完成（`gh run watch` 或轮询 `gh run list --workflow=ci-smoke-glob-runner.yml --branch=cp-08042256-gp2-android-smoke-p0-fix --limit 1`），然后检查该 run 日志里 `golden-path-2-smoke.sh` 的结果：

```bash
RUN_ID=$(gh run list --workflow=ci-smoke-glob-runner.yml --branch=cp-08042256-gp2-android-smoke-p0-fix --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN_ID" --log 2>/dev/null | grep -E "golden-path-2-smoke.sh" | tail -10
```

- [ ] **Step 3: 根据 Step 2 结果分支处理**

**若 `golden-path-2-smoke.sh` 32 步全绿（`PASS golden-path-2-smoke.sh`）：**

把脚本名加入 `smoke-baseline.txt`（按字母序插入 `golden-path-4-smoke.sh` 之前）：

```bash
grep -n "^golden-path" .github/workflows/scripts/smoke-baseline.txt
```

用 Edit 工具在 `golden-path-4-smoke.sh` 那一行之前插入 `golden-path-2-smoke.sh` 一行，然后：

```bash
git add .github/workflows/scripts/smoke-baseline.txt
git commit -m "$(cat <<'EOF'
fix(ci): golden-path-2-smoke.sh实测glob车道32步全绿，进smoke-baseline.txt棘轮闸

补TOAPIS_API_KEY后<run URL>实测确认32步全通过。进baseline后此后FAIL会真正
阻断CI，不再被当存量债吞掉。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

**若未全绿（仍有某步失败）：**

不加入 baseline。记录失败的具体 Step 和报错到 PR 描述里，作为已知缺口留给下一轮修复（不在本 PR 强行修完所有连带问题，参照 PrepPRD「范围边界」）。

- [ ] **Step 4: 手动触发 `e2e-line02-android-collect.yml` 验证 checkout 网络修复**

```bash
gh workflow run e2e-line02-android-collect.yml --ref cp-08042256-gp2-android-smoke-p0-fix -f scenario=collect
```

等待运行，检查 checkout 步骤是否报网络错误：

```bash
RUN_ID=$(gh run list --workflow=e2e-line02-android-collect.yml --branch=cp-08042256-gp2-android-smoke-p0-fix --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN_ID" --log 2>/dev/null | grep -E "Recv failure|Failed to connect to github|##\[error\]" | head -10
```

- [ ] **Step 5: 记录 P0-4 观察结果（不修代码，只记录判断）**

根据 Step 4 结果判断：
- 若 checkout 不再报错、脚本本体开始执行（即使后续因设备侧 envfail exit3 失败）→ 说明 checkout 确实是此前瓶颈之一，P0-4 的"至少让 checkout 不再是瓶颈"目标达成，记录进 PR 描述。
- 若仍是 envfail exit3（设备侧 initAgent 未跑）→ 说明设备侧问题独立于 checkout，需要另立 issue（不在本 PR 范围内修）。
- 若 checkout 依然网络失败 → 说明本次修复未能解决问题，需要回到 Task 2 重新排查（这种情况下不应该合并本 PR 声称"已修复"，要如实说明）。

- [ ] **Step 6: 等常规 PR 触发的其它必需 CI（L4/L3/Core Regression 等）跑完，全绿后开 PR**

```bash
gh pr create --title "fix(ci): GP2安卓获客smoke三处守卫失效修复（checkout网络/glob车道漏key/xargs剥JSON引号）" --body "$(cat <<'EOF'
## Summary
- 修复 e2e-line02-android-collect.yml checkout 出境网络超时（sparse-checkout+HK exit-node，同PR#1596模式）
- 修复 ci-smoke-glob-runner.yml 缺 TOAPIS_API_KEY 导致 golden-path-2-smoke.sh 长期真红被当存量债吞掉
- 修复 line02-android-collect-realmachine-smoke.sh Seg3 质量闸 xargs 剥JSON引号 bug（改用 sed trim + 回归测试锁定）
- <此处填 Task 4 Step 3/5 的实测结果>

## 关联
memory: handoff_0804_gp2_android_smoke_audit_18_findings.md
PrepPRD: sprints/08042253-gp2-android-smoke-p0-fix/prep-prd.md
设计: docs/superpowers/specs/2026-08-04-gp2-android-smoke-p0-fix-design.md

## Test plan
- [x] trim-json-lib-smoke.sh 回归测试（复现xargs bug + 验证sed修复）已 commit 进 repo
- [x] checkout 修复已用 workflow_dispatch 实测验证
- [x] golden-path-2-smoke.sh 在 glob-runner 环境实测（结果见上）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: 交给 engine-ship + engine-pr-watchdog 收尾（不在本计划内展开，plan 执行完成后按 /dev skill 路径 A 规程自动接力）**
