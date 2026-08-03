# 真机车道假绿根治 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让安卓真机验证车道真正摸到手机（ADB 探测），并让环境未就绪一律红+报警（废除 envfail→success 包装），promote 证据②改 job 粒度互不连坐。

**Architecture:** 三个文件改动（smoke 脚本 / nightly workflow / promote workflow）+ 三个静态断言守卫测试（进 ci-l1 现有 glob）。TDD：commit-1 三个 failing test，commit-2 实现变绿。

**Tech Stack:** bash / GitHub Actions / 静态断言测试（envbind.test.sh 模式）

**上下文：** spec 见 `docs/superpowers/specs/2026-08-03-realmachine-envfail-red-design.md`；worktree=`/Users/administrator/worktrees/zenithjoy/cp-08031240-realmachine-envfail-red`（所有命令先 cd 到这里）。
**commit 规范：** 本地 commit 用纯 Conventional 格式（`test:`/`fix:`），`[CONFIG]` 前缀只放 PR 标题（squash 后进 main 触发 CI 路由）。

---

### Task 1: 三个 failing 守卫测试（commit-1）

**Files:**
- Create: `.github/workflows/scripts/__tests__/account-scan-realmachine-smoke.adb-discovery.test.sh`
- Create: `.github/workflows/scripts/__tests__/account-scan-realmachine-smoke.envfail-red.test.sh`
- Create: `.github/workflows/scripts/__tests__/account-scan-realmachine-smoke.promote-job-granularity.test.sh`

前缀 `account-scan-realmachine-smoke.*` 保证被 `ci-l1-process.yml:326` 现有 glob 接入，不改 glob。

- [ ] **Step 1: 写 adb-discovery 测试**

```bash
cat > .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.adb-discovery.test.sh << 'EOF'
#!/usr/bin/env bash
# account-scan-realmachine-smoke.adb-discovery.test.sh — TDD Red 阶段
#
# 背景（2026-08-03 真机对照实锤，decision 2f11ae25 配套）：
#   刀D 在 xian-rog runner 上跑时 PATH 无 adb，脚本默认 ADB=adb，
#   `"$ADB" devices 2>/dev/null` 静默失败被误报"无 Android 设备在线"envfail——
#   同机手动指定 scrcpy adb 全路径后整条链全绿（装 2.1.19→扫描 done→account_ids=2）。
#
# 结构性静态检查（CI 容器无真机；ubuntu runner 自带 adb，行为测试会被干扰，故用静态断言）：
#   1. ADB 未显式传入时必须有探测：glob scrcpy 路径优先（sort -V 取最新版），command -v 兜底
#   2. glob 探测必须先于 command -v（e2e-line02-android-collect.yml 已验证顺序；PATH 杂牌 adb 会互杀 server）
#   3. 探测全失败必须 envfail 独立文案"找不到 adb"（与"无设备在线"区分）
#   4. 设备检查前必须有 `"$ADB" version` 可用性校验（覆盖显式传入坏 ADB），独立文案"adb 不可用"
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"
echo "━━ adb-discovery 结构性测试 ━━"
[ -f "$SCRIPT" ] || { echo "❌ $SCRIPT 不存在"; exit 1; }
FAIL=0

GLOB_LINE=$(grep -n 'Genymobile\.scrcpy_' "$SCRIPT" | head -1 | cut -d: -f1)
CMDV_LINE=$(grep -n 'command -v adb' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -z "$GLOB_LINE" ]; then
  echo "❌ FAIL: 无 scrcpy adb glob 探测"; FAIL=1
else
  echo "✅ glob 探测存在 (line $GLOB_LINE)"
  if ! sed -n "${GLOB_LINE}p" "$SCRIPT" | grep -q 'sort -V'; then
    echo "❌ FAIL: glob 探测行缺 sort -V（3.10<3.2 字典序会取到旧版 adb）"; FAIL=1
  fi
  if [ -n "$CMDV_LINE" ] && [ "$CMDV_LINE" -lt "$GLOB_LINE" ]; then
    echo "❌ FAIL: command -v adb (line $CMDV_LINE) 先于 glob (line $GLOB_LINE)，顺序不对"; FAIL=1
  fi
fi
[ -n "$CMDV_LINE" ] || { echo "❌ FAIL: 无 command -v adb 兜底"; FAIL=1; }

grep -q 'envfail "runner 上找不到 adb"' "$SCRIPT" \
  || { echo "❌ FAIL: 缺'找不到 adb'独立 envfail 文案"; FAIL=1; }

VER_LINE=$(grep -n '"\$ADB" version' "$SCRIPT" | head -1 | cut -d: -f1)
DEV_LINE=$(grep -n '"\$ADB" devices' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -z "$VER_LINE" ]; then
  echo "❌ FAIL: 设备检查前无 adb version 可用性校验"; FAIL=1
elif [ -n "$DEV_LINE" ] && [ "$VER_LINE" -gt "$DEV_LINE" ]; then
  echo "❌ FAIL: adb version 校验 (line $VER_LINE) 在 devices 检查 (line $DEV_LINE) 之后"; FAIL=1
else
  echo "✅ adb version 校验先于 devices 检查"
fi
grep -q 'envfail "adb 不可用' "$SCRIPT" \
  || { echo "❌ FAIL: 缺'adb 不可用'独立 envfail 文案（应带 stderr）"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
EOF
chmod +x .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.adb-discovery.test.sh
```

- [ ] **Step 2: 写 envfail-red 测试**

```bash
cat > .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.envfail-red.test.sh << 'EOF'
#!/usr/bin/env bash
# account-scan-realmachine-smoke.envfail-red.test.sh — TDD Red 阶段
#
# decision 2f11ae25（invariant，用户拍板 2026-08-03）：envfail(exit 3) 必须 job 红+报警，
# 不准映射成 job success(infra-skip)。supersede sprint 07292330 合同"infra-skip 不计绿/红"条款。
# 断言 nightly-real-machine-staging.yml 刀D step：
#   1. 不存在 "-eq 3 → exit 0" 包装分支
#   2. exit "$CODE" 真实退出码保留
#   3. outputs.code 写入保留（nightly-report 靠它区分 envfail 标签）
#   4. nightly-report 红判定仍 key 在 result=failure（不依赖 code，容忍 code 为空）
set -uo pipefail
WF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/nightly-real-machine-staging.yml"
echo "━━ envfail-red 结构性测试 ━━"
[ -f "$WF" ] || { echo "❌ $WF 不存在"; exit 1; }
FAIL=0

# "-eq 3" 条件后 3 行内出现 exit 0 = 包装还在
WRAP=$(awk '/-eq 3/{found=NR} found && NR<=found+3 && /exit 0/{print NR; exit}' "$WF")
if [ -n "$WRAP" ]; then
  echo "❌ FAIL: 刀D 仍有 envfail(exit 3)→exit 0 包装 (line $WRAP)——违反 decision 2f11ae25"; FAIL=1
else
  echo "✅ 无 exit 3→exit 0 包装"
fi
grep -q 'exit "\$CODE"' "$WF" || { echo "❌ FAIL: exit \"\$CODE\" 真实退出码丢失"; FAIL=1; }
grep -q 'code=\$CODE.*GITHUB_OUTPUT' "$WF" || { echo "❌ FAIL: outputs.code 写入丢失"; FAIL=1; }
grep -q '"\$ACCOUNT_SCAN" = "failure"' "$WF" || { echo "❌ FAIL: nightly-report 红判定不再 key 在 result=failure"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
EOF
chmod +x .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.envfail-red.test.sh
```

- [ ] **Step 3: 写 promote-job-granularity 测试**

```bash
cat > .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.promote-job-granularity.test.sh << 'EOF'
#!/usr/bin/env bash
# account-scan-realmachine-smoke.promote-job-granularity.test.sh — TDD Red 阶段
#
# 用户拍板方案B（2026-08-03）：promote-all-prod 证据②从 workflow 级 conclusion 改 job 粒度——
# 真微信/真抖音 job 最近2晚绿=阻塞证据；真安卓红不阻塞但大字警告 summary（互不连坐）。
set -uo pipefail
WF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/promote-all-prod.yml"
echo "━━ promote 证据② job 粒度结构性测试 ━━"
[ -f "$WF" ] || { echo "❌ $WF 不存在"; exit 1; }
FAIL=0

grep -q '/jobs' "$WF" || { echo "❌ FAIL: 证据②未按 job 粒度查询(缺 /jobs API)"; FAIL=1; }
grep -q '真微信' "$WF" || { echo "❌ FAIL: 缺真微信 job 阻塞判定"; FAIL=1; }
grep -q '真抖音' "$WF" || { echo "❌ FAIL: 缺真抖音 job 阻塞判定"; FAIL=1; }
grep -q '真安卓' "$WF" || { echo "❌ FAIL: 缺真安卓 job 警告呈现"; FAIL=1; }
if grep -q '{c:\.conclusion' "$WF"; then
  echo "❌ FAIL: 仍在用 workflow 级 conclusion 判定（连坐模式）"; FAIL=1
fi
grep -q 'ANDROID_WARN' "$WF" || { echo "❌ FAIL: 真安卓应为警告不阻塞(缺 ANDROID_WARN 逻辑)"; FAIL=1; }
grep -q 'AGE_H' "$WF" && grep -q '36' "$WF" || { echo "❌ FAIL: 36h 新鲜度检查丢失"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
EOF
chmod +x .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.promote-job-granularity.test.sh
```

- [ ] **Step 4: 跑三个测试确认全红**

Run: `for t in .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.{adb-discovery,envfail-red,promote-job-granularity}.test.sh; do echo "== $t"; bash "$t"; echo "exit=$?"; done`
Expected: 三个都 `RED/FAIL`、exit=1（adb-discovery 缺探测；envfail-red 有包装；promote 无 /jobs）

- [ ] **Step 5: Commit（commit-1，测试 Red）**

```bash
git add .github/workflows/scripts/__tests__/
git commit -m "test(realmachine): 真机车道假绿三守卫 failing tests (decision 2f11ae25, task 3e6a9041)"
```

---

### Task 2: smoke 脚本 ADB 探测实现

**Files:**
- Modify: `.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh`（main() 开头 `ADB="${ADB:-adb}"` 行 + 环境自检段）

- [ ] **Step 1: 替换 ADB 默认值为探测逻辑**

把 `  ADB="${ADB:-adb}"` 这一行替换为：

```bash
  # ── ADB 解析（decision 2f11ae25 配套：裸 adb 不在 runner PATH 时静默失败被误报"无设备"）──
  # 未显式传入时探测：glob scrcpy 自带 adb 优先（e2e-line02-android-collect.yml 已验证顺序；
  # sort -V 防 3.10<3.2 字典序取旧版），command -v 兜底；全失败=独立 envfail 文案。
  if [ -z "${ADB:-}" ]; then
    ADB=$(ls /c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_*/scrcpy-*/adb.exe 2>/dev/null | sort -V | tail -1 || true)
    [ -n "$ADB" ] || ADB=$(command -v adb 2>/dev/null || true)
    [ -n "$ADB" ] || envfail "runner 上找不到 adb"
  fi
```

- [ ] **Step 2: 环境自检段加 adb version 校验**

在 `command -v jq ... || envfail "runner 缺 jq"` 之后、`"$ADB" devices` 检查之前插入：

```bash
  # 无论显式传入还是探测所得，先证 adb 本身可用（坏驱动/坏路径不该被误报成"无设备"）
  ADB_VER_ERR=$("$ADB" version 2>&1 >/dev/null) \
    || envfail "adb 不可用: ${ADB_VER_ERR:-unknown}（ADB=$ADB）"
```

- [ ] **Step 3: 跑 adb-discovery 测试确认变绿**

Run: `bash .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.adb-discovery.test.sh`
Expected: PASS, exit 0

---

### Task 3: nightly workflow envfail 一律红

**Files:**
- Modify: `.github/workflows/nightly-real-machine-staging.yml`（刀D 头部注释 + step run 块 + nightly-report 标签/文案）

- [ ] **Step 1: 改刀D 头部注释**（原"envfail不算红/job以success收尾"4行注释）替换为：

```yaml
  # ─── 真安卓 account-scan 真机验证车道 full check（刀D，2026-07-30 接入）───
  # envfail(exit 3,环境未就绪)与真机 bug 同级计红（decision 2f11ae25，supersede 07292330
  # 合同 infra-skip 条款）：exit_code 仍写 job output 供 nightly-report 区分标签，
  # 但 job 一律以真实退出码收尾——车道瘫痪必须红+报警，不准包装成绿。
```

- [ ] **Step 2: 改 step run 块**（删 `if [ "$CODE" -eq 3 ] ... exit 0` 包装）：

```yaml
        run: |
          chmod +x .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh
          set +e
          bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh
          CODE=$?
          set -e
          echo "code=$CODE" >> "$GITHUB_OUTPUT"
          exit "$CODE"
```

- [ ] **Step 3: nightly-report 标签改名 + issue 文案补充**

`ACCOUNT_SCAN_LABEL="infra-skip"` 改为 `ACCOUNT_SCAN_LABEL="envfail(环境未就绪)"`；
issue body `处理约定` 句尾追加：`account-scan=envfail(环境未就绪) 同样要处理——车道瘫痪不是噪音（decision 2f11ae25）。`

- [ ] **Step 4: 跑 envfail-red 测试确认变绿**

Run: `bash .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.envfail-red.test.sh`
Expected: PASS, exit 0

---

### Task 4: promote 证据② job 粒度（方案B）

**Files:**
- Modify: `.github/workflows/promote-all-prod.yml`（头部注释第20行 + 证据② step 的 RUNS 查询与判定块）

- [ ] **Step 1: 头部注释第20行**改为：
`#     ② 真机 nightly 最近 2 晚 真微信/真抖音 job 绿且最新 <36h（job 粒度；真安卓红不阻塞但大字警告）`

- [ ] **Step 2: 替换证据② 的查询判定块**（从 `RUNS=$(gh run list ...` 到 BAD 判定 `fi` 结束，替换为下面内容；其后 `LATEST=`/`AGE_H` 新鲜度块保持不变）：

```bash
          RUNS=$(gh run list --repo "$GITHUB_REPOSITORY" \
                   --workflow nightly-real-machine-staging.yml \
                   --status completed --limit 2 --json databaseId,createdAt \
                   --jq '[.[] | {id:.databaseId, t:.createdAt}]')
          COUNT=$(echo "$RUNS" | jq 'length')
          echo "nightly 最近完成记录: $RUNS"
          if [ "$COUNT" = "0" ]; then
            echo "::error::nightly 一次都没跑过——没有真机证据，不能 promote（或填 waive_nightly）"
            exit 1
          fi
          # job 粒度判定（用户拍板方案B，2026-08-03，互不连坐）：真微信/真抖音阻塞本 promote
          # （发的是中台后端+前端），真安卓 account-scan 红不阻塞（APK 走 COS 分发不经此
          # promote）但大字警告 summary——谁放行谁知情。
          FAIL=0; ANDROID_WARN=0
          for RID in $(echo "$RUNS" | jq -r '.[].id'); do
            JOBS=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RID/jobs" \
                     --jq '[.jobs[] | {n:.name, c:.conclusion}]')
            echo "run $RID jobs: $JOBS"
            for NAME in "真微信" "真抖音"; do
              C=$(echo "$JOBS" | jq -r --arg n "$NAME" '[.[] | select(.n | startswith($n))][0].c // "missing"')
              if [ "$C" != "success" ]; then
                echo "::error::run $RID 的 $NAME job 非绿（$C）——真机回归没过，不能 promote（先修红或填 waive_nightly）"
                FAIL=1
              fi
            done
            AC=$(echo "$JOBS" | jq -r '[.[] | select(.n | startswith("真安卓"))][0].c // "missing"')
            [ "$AC" = "success" ] || ANDROID_WARN=1
          done
          if [ "$ANDROID_WARN" = "1" ]; then
            {
              echo "## ⚠️ 真安卓 account-scan 车道近 2 晚有红"
              echo ""
              echo "不阻塞本次 promote（安卓 APK 走 COS 分发），但安卓真机验证车道当前不可信——谁放行谁知情（decision 2f11ae25 / 方案B）。"
            } >> "$GITHUB_STEP_SUMMARY"
            echo "⚠️ 真安卓车道近2晚有红：不阻塞，已大字记录 summary"
          fi
          [ "$FAIL" = "0" ] || exit 1
```

（最后成功 echo 改为 `echo "✅ nightly 证据齐：最近 ${COUNT} 次 真微信/真抖音 job 全绿，最新 ${AGE_H}h 前。"`）

- [ ] **Step 3: 跑 promote 测试确认变绿**

Run: `bash .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.promote-job-granularity.test.sh`
Expected: PASS, exit 0

---

### Task 5: 全量回归 + commit-2

- [ ] **Step 1: 跑全部 account-scan 测试（含既有 9 个）**

Run: `for t in .github/workflows/scripts/__tests__/account-scan-realmachine-smoke.*.test.sh; do echo "== $t"; bash "$t" || echo "FAILED: $t"; done`
Expected: 全部 PASS（对抗审查已核实既有测试均显式传 ADB=，探测被跳过不受影响）

- [ ] **Step 2: yaml 语法自检**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/nightly-real-machine-staging.yml')); yaml.safe_load(open('.github/workflows/promote-all-prod.yml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: Commit（commit-2，实现 Green）**

```bash
git add .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh .github/workflows/nightly-real-machine-staging.yml .github/workflows/promote-all-prod.yml
git commit -m "fix(realmachine): 刀D ADB探测+envfail一律红+promote证据②job粒度 (decision 2f11ae25, task 3e6a9041)"
```

---

### Task 6: proven-to-fire 变异自证（三个守卫各红一次）

- [ ] **Step 1: 变异① 删探测** — `sed -i.bak '/Genymobile\.scrcpy_/d' .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh` → 跑 adb-discovery 测试 → Expected: FAIL → 用 .bak 恢复并删 .bak
- [ ] **Step 2: 变异② 加回包装** — 在 workflow `echo "code=$CODE"` 行后临时插入 `-eq 3` + `exit 0` 分支 → 跑 envfail-red 测试 → Expected: FAIL → `git checkout -- .github/workflows/nightly-real-machine-staging.yml` 恢复
- [ ] **Step 3: 变异③ 还原连坐** — 把 promote 证据②的 `{id:.databaseId` 临时改回 `{c:.conclusion` → 跑 promote 测试 → Expected: FAIL → `git checkout -- .github/workflows/promote-all-prod.yml` 恢复
- [ ] **Step 4: 确认恢复后三测试全绿**，三次红的输出片段存到 scratchpad 备 PR 描述引用

---

### Task 7: Push + PR

- [ ] **Step 1: push**

```bash
git push -u origin cp-08031240-realmachine-envfail-red
```

- [ ] **Step 2: 开 PR**（标题 `[CONFIG] fix(realmachine): 真机车道假绿根治——ADB探测+envfail一律红+promote job粒度`；正文含：双根因、decision 2f11ae25 引用、**supersede sprint 07292330 合同 infra-skip 条款声明**、proven-to-fire 三段红输出、08-03 11:52 真机全绿基线对照、拍板方案B 记录；尾部 🤖 Generated with [Claude Code](https://claude.com/claude-code)）
