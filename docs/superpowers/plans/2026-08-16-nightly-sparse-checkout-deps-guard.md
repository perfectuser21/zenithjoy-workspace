# nightly wechat-bubble sparse-checkout 依赖守卫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 nightly 真机 wechat-bubble 车道重新拉到 `services/agent/wechat-rpa`（修 17 晚 ModuleNotFoundError），并用 CI lint 守卫保证 selfcheck_bubbles.py 的 sys.path 依赖目录永远在该 job 的 sparse-checkout 列表里。

**Architecture:** 一个解析型 bash+内嵌 python 的 lint 脚本（读 workflow 的 sparse 块 + 读脚本的 `os.path.join(_HERE, "..", "<dir>")`），一个 `run_case` 风格的 `.test.sh`（红→绿），workflow 加一行目录，ci-l1-process.yml 四处接线。TDD：commit-1 = lint + test（对真实 workflow 报红），commit-2 = 修 workflow + 接线（全绿）。

**Tech Stack:** bash（`set -euo pipefail`）、python3 标准库（不依赖 pyyaml）、GitHub Actions `actions/checkout@v4` sparse-checkout（非 cone 模式，前缀匹配）。

Spec：`docs/superpowers/specs/2026-08-16-nightly-sparse-checkout-deps-guard-design.md`

---

## 文件结构

- Create `.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh` — 守卫本体（解析 + 比对 + 退出码）
- Create `.github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh` — 守卫的 3 case 行为测试
- Modify `.github/workflows/nightly-real-machine-staging.yml:57-58` — sparse 列表加 `services/agent/wechat-rpa`
- Modify `.github/workflows/ci-l1-process.yml` — ①test 列表加新 test ②新增 lint job ③`l1-passed.needs` 加 job ④gate 汇总块加 job

---

### Task 1（commit-1，Red）：lint 脚本 + 行为测试；对真实 workflow 判红

**Files:**
- Create: `.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh`
- Create: `.github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh`

- [ ] **Step 1: 写行为测试（先于实现）**

`.github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh`：

```bash
#!/usr/bin/env bash
# lint-nightly-sparse-checkout-deps.test.sh — 守卫行为测试（proven-to-fire）
#
# 3 case（run_case 风格同 lint-smoke-mock-honesty.test.sh）：
#   A: fixture workflow 只 sparse `services/agent/tools`，fixture 脚本依赖 ../wechat-rpa → 期望 lint 红
#   B: fixture 列表补上 `services/agent/wechat-rpa` → 期望 lint 绿
#   C: 真实仓库 workflow + 真实 selfcheck_bubbles.py → 期望绿（commit-1 阶段这条会红——就是 TDD Red）
#
# 用法: bash lint-nightly-sparse-checkout-deps.test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LINT="$REPO_ROOT/.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh"

PASSED=0; FAILED=0

# run_case <名字> <expect_fail 0|1> <sparse 列表内容(多行, 每行一个目录)>
run_case() {
  local name="$1" expect_fail="$2" sparse_dirs="$3"
  local TMPDIR; TMPDIR=$(mktemp -d)
  mkdir -p "$TMPDIR/.github/workflows" "$TMPDIR/services/agent/tools"
  # fixture 脚本：与真实 selfcheck_bubbles.py 相同形态的 sys.path 注入
  cat > "$TMPDIR/services/agent/tools/selfcheck_bubbles.py" <<'PY'
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT_RPA = os.path.abspath(os.path.join(_HERE, "..", "wechat-rpa"))
if _WECHAT_RPA not in sys.path:
    sys.path.insert(0, _WECHAT_RPA)
PY
  # fixture workflow：只保留 wechat-bubble job 骨架 + sparse 块
  {
    echo "name: fixture"
    echo "on: workflow_dispatch"
    echo "jobs:"
    echo "  wechat-bubble:"
    echo "    runs-on: [self-hosted, wechat-capable]"
    echo "    steps:"
    echo "      - uses: actions/checkout@v4"
    echo "        with:"
    echo "          sparse-checkout: |"
    printf '%s\n' "$sparse_dirs" | sed 's/^/            /'
    echo "          sparse-checkout-cone-mode: false"
    echo "      - name: run"
    echo "        run: python selfcheck_bubbles.py"
  } > "$TMPDIR/.github/workflows/nightly-fixture.yml"

  set +e
  ( cd "$TMPDIR" && bash "$LINT" ".github/workflows/nightly-fixture.yml" "services/agent/tools/selfcheck_bubbles.py" ) > /tmp/lint-nscd-out.txt 2>&1
  local rc=$?
  set -e
  rm -rf "$TMPDIR"

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] (期望报红，实得 exit=$rc)"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] (期望放行，实得 exit=$rc)"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got_exit=$rc"; cat /tmp/lint-nscd-out.txt; FAILED=$((FAILED+1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  lint-nightly-sparse-checkout-deps.sh 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$LINT" ]; then
  echo "❌ RED（预期）: $LINT 不存在 —— 尚未实现"
  exit 1
fi

# A: 只拉 tools，脚本依赖 ../wechat-rpa → 必须红（PR#1596 原始 bug 复现）
run_case "missing-wechat-rpa" 1 'services/agent/tools'

# B: 补上 wechat-rpa → 绿
run_case "has-wechat-rpa" 0 'services/agent/tools
services/agent/wechat-rpa'

# C: 真实仓库文件 → 绿（修复合入前这条就是 TDD Red）
set +e
( cd "$REPO_ROOT" && bash "$LINT" ) > /tmp/lint-nscd-real.txt 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ]; then
  echo "  PASS [real-repo] (真实 workflow 覆盖了全部依赖目录)"; PASSED=$((PASSED+1))
else
  echo "  FAIL [real-repo] 真实 workflow 缺依赖目录 (exit=$rc)"; cat /tmp/lint-nscd-real.txt; FAILED=$((FAILED+1))
fi

echo ""; echo "lint-nightly-sparse-checkout-deps: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
```

- [ ] **Step 2: 跑测试确认它红（lint 不存在）**

Run: `cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa && bash .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh; echo rc=$?`
Expected: 输出 `❌ RED（预期）: ... 不存在`，`rc=1`

- [ ] **Step 3: 写 lint 脚本**

`.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh`：

```bash
#!/usr/bin/env bash
# lint-nightly-sparse-checkout-deps.sh
#
# 回归守卫：nightly 真机 wechat-bubble job 的 sparse-checkout 列表必须覆盖
# selfcheck_bubbles.py 通过 sys.path 注入的全部仓内依赖目录。
#
# 背景（2026-08-16，issue #1639 / Brain task 3cec9be4）：PR#1596（07-30）为解决 rog 出境网络
# 慢把该 job 改成 sparse-checkout 只拉 services/agent/tools；而 selfcheck_bubbles.py:28-30 把
# ../wechat-rpa 插进 sys.path 并 import listen_chat/find_weixin → 目录没拉下来 → 每晚
# ModuleNotFoundError("No module named 'listen_chat'")，连红 17 晚，Line04 真机健康信号全盲。
# 本守卫把"脚本依赖了什么目录"和"workflow 拉了什么目录"两边机械对账，任何一边改动都在 PR 当场报红。
#
# 用法：bash lint-nightly-sparse-checkout-deps.sh [workflow文件] [脚本文件]
# 默认：.github/workflows/nightly-real-machine-staging.yml  services/agent/tools/selfcheck_bubbles.py
# 退出码：0 通过 / 1 失败

set -euo pipefail

WF="${1:-.github/workflows/nightly-real-machine-staging.yml}"
SCRIPT="${2:-services/agent/tools/selfcheck_bubbles.py}"
JOB="${LINT_SPARSE_JOB:-wechat-bubble}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Lint — nightly sparse-checkout 依赖对账"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$WF" ]; then
  echo "::error::守卫目标 workflow 不存在: $WF"
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "::error::守卫目标脚本不存在: $SCRIPT"
  exit 1
fi

python3 - "$WF" "$SCRIPT" "$JOB" <<'PY'
import os, re, sys

wf, script, job = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(wf, encoding="utf-8").read().split("\n")

def indent(s):
    return len(s) - len(s.lstrip(" "))

# 1) 定位 jobs.<job>: 块
job_start = None
for i, ln in enumerate(lines):
    if indent(ln) == 2 and ln.strip() == f"{job}:":
        job_start = i
        break
if job_start is None:
    print(f"::error file={wf}::找不到 job `{job}:`（缩进 2 空格）——守卫对象改名了？请同步 LINT_SPARSE_JOB")
    sys.exit(1)
job_end = len(lines)
for i in range(job_start + 1, len(lines)):
    ln = lines[i]
    if ln.strip() == "" or ln.lstrip().startswith("#"):
        continue
    if indent(ln) <= 2:
        job_end = i
        break
job_block = lines[job_start:job_end]

# 2) 抠出 sparse-checkout: | 块下面的目录列表
sparse = []
in_sparse = False
sparse_indent = None
for ln in job_block:
    s = ln.strip()
    if not in_sparse:
        if s.startswith("sparse-checkout:"):
            in_sparse = True
            sparse_indent = indent(ln)
            # 同行 inline 值（如 sparse-checkout: services/agent/tools）也接受
            rest = s[len("sparse-checkout:"):].strip()
            if rest and rest != "|":
                sparse.append(rest.strip("'\""))
                in_sparse = False
        continue
    if s == "" or s.startswith("#"):
        continue
    if indent(ln) <= sparse_indent:
        in_sparse = False
        continue
    sparse.append(s.strip("'\"").rstrip("/"))
if not sparse:
    print(f"::error file={wf}::job `{job}` 没有 sparse-checkout 块（或为空）——若已改回整仓 checkout 请删除本守卫的调用")
    sys.exit(1)

# 3) 解析脚本里的 sys.path 依赖：os.path.join(_HERE, "..", "<dir>") 形态
src = open(script, encoding="utf-8").read()
script_dir = os.path.dirname(script).rstrip("/")            # services/agent/tools
required = {script_dir}
for m in re.finditer(r'os\.path\.join\(\s*_HERE\s*,\s*((?:"[^"]+"\s*,?\s*)+)\)', src):
    parts = [p.strip().strip('"') for p in m.group(1).split(",") if p.strip()]
    d = os.path.normpath(os.path.join(script_dir, *parts))
    required.add(d)

# 4) 对账：每个依赖目录必须被某个 sparse 项前缀覆盖（非 cone 模式 = 路径前缀）
def covered(d):
    return any(d == s or d.startswith(s + "/") for s in sparse)

missing = sorted(d for d in required if not covered(d))
print(f"sparse 列表: {sparse}")
print(f"脚本依赖目录: {sorted(required)}")
if missing:
    for d in missing:
        print(f"::error file={wf}::job `{job}` 的 sparse-checkout 未覆盖 {script} 依赖的目录 `{d}`")
    print("")
    print("为什么有这条规则：PR#1596 把该 job 改成 sparse-checkout 后漏了 services/agent/wechat-rpa，")
    print("selfcheck_bubbles.py import listen_chat 必炸，nightly 连红 17 晚（issue #1639）。")
    print("修法：在该 job 的 sparse-checkout 列表加上缺的目录，或改脚本不再依赖它。")
    sys.exit(1)
print("✅ sparse-checkout 覆盖了脚本全部依赖目录")
PY
```

- [ ] **Step 4: 加执行位并跑测试——期望 A/B 绿、C 红（真实 workflow 还没修）**

Run: `cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa && chmod +x .github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh && bash .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh; echo rc=$?`
Expected: `PASS [missing-wechat-rpa]`、`PASS [has-wechat-rpa]`、`FAIL [real-repo] ... 未覆盖 ... services/agent/wechat-rpa`、`PASSED=2 FAILED=1`、`rc=1`（这就是亲眼见红）

- [ ] **Step 5: 单独对真实 workflow 跑 lint，留红证据**

Run: `cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa && bash .github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh; echo rc=$?`
Expected: `::error file=.github/workflows/nightly-real-machine-staging.yml::job \`wechat-bubble\` 的 sparse-checkout 未覆盖 ... \`services/agent/wechat-rpa\``，`rc=1`

- [ ] **Step 6: Commit（Red）**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa
git add .github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh
git commit -m "test(ci): nightly sparse-checkout 依赖守卫 lint + 行为测试（Red：真实 workflow 漏 wechat-rpa 判红）[3cec9be4]"
```

---

### Task 2（commit-2，Green）：修 workflow + 接线 ci-l1

**Files:**
- Modify: `.github/workflows/nightly-real-machine-staging.yml:57-58`
- Modify: `.github/workflows/ci-l1-process.yml`（4 处）

- [ ] **Step 1: workflow sparse 列表加目录**

把（wechat-bubble job 内，约 57-59 行）
```yaml
          sparse-checkout: |
            services/agent/tools
          sparse-checkout-cone-mode: false
```
改为
```yaml
          sparse-checkout: |
            services/agent/tools
            services/agent/wechat-rpa
          sparse-checkout-cone-mode: false
```
并在其上方紧邻的注释块末尾追加：
```yaml
      # selfcheck_bubbles.py 通过 sys.path 依赖 ../wechat-rpa（import listen_chat/find_weixin），
      # sparse 列表必须含 services/agent/wechat-rpa（07-30~08-16 漏拉连红 17 晚，issue #1639）；
      # 由 lint-nightly-sparse-checkout-deps.sh 机械对账守卫。
```

- [ ] **Step 2: 跑 lint + 测试，期望全绿**

Run: `cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa && bash .github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh && bash .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh; echo rc=$?`
Expected: `✅ sparse-checkout 覆盖了脚本全部依赖目录`；测试 `PASSED=3 FAILED=0`；`rc=0`

- [ ] **Step 3: ci-l1-process.yml 接线（4 处）**

(a) `test-realmachine-verify-lane` 的 for 列表（约 326-330 行）在 `lint-realmachine-unverified-ratchet.test.sh` 之前加一行：
```yaml
                   .github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh \
```
(b) 在 `lint-wechat-rpa-runner:` job 之后新增：
```yaml
  lint-nightly-sparse-checkout-deps:
    if: github.event_name == 'pull_request'
    name: Lint — Nightly Sparse-Checkout Deps
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - name: Run lint-nightly-sparse-checkout-deps
        run: bash .github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh
```
(c) `l1-passed.needs` 里 `lint-wechat-rpa-runner,` 之后加 `lint-nightly-sparse-checkout-deps,`。
(d) gate 汇总块，在 `lint-wechat-rpa-runner` 那段 `if` 之后加：
```yaml
          if [ "${{ needs.lint-nightly-sparse-checkout-deps.result }}" != "success" ]; then
            echo "FAIL: Lint Nightly Sparse-Checkout Deps (${{ needs.lint-nightly-sparse-checkout-deps.result }})"
            FAILED=true
          fi
```

- [ ] **Step 4: 本地校验 YAML 仍可解析 + 接线计数**

Run: `cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa && python3 .github/workflows/scripts/lint-workflow-yaml-parse.py && grep -c "lint-nightly-sparse-checkout-deps" .github/workflows/ci-l1-process.yml`
Expected: yaml-parse 通过；grep 计数 ≥ 5（test 列表 1 + job 名 1 + run 行 1 + needs 1 + 汇总 if/echo 2）

- [ ] **Step 5: Commit（Green）**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-nightly-sparse-wechat-rpa
git add .github/workflows/nightly-real-machine-staging.yml .github/workflows/ci-l1-process.yml
git commit -m "[CONFIG] fix(ci): nightly wechat-bubble sparse-checkout 补 services/agent/wechat-rpa + 守卫接线 ci-l1（连红 17 晚根治，#1639）[3cec9be4]"
```

---

### Task 3：push + PR + 合并后验证

- [ ] **Step 1: push 并开 PR**（finishing Option 2 / engine-ship 负责；PR body 写：根因、复现、守卫 proven-to-fire 证据（Task1 Step5 的红输出）、GP 锚 `line04/passive_reception keep-green`、issue #1639）
- [ ] **Step 2: CI 全绿后合并；合并后 `gh workflow run nightly-real-machine-staging.yml`，确认 wechat-bubble job 日志不再出现 `No module named 'listen_chat'`（进入真正气泡门逻辑；气泡门本身成败以真机为准，不属本 PR）**
