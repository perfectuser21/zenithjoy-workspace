# Smoke 棘轮闸实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ci-smoke-glob-runner.yml 从 report-only 升级为 PASS 基线棘轮闸（基线内红即阻断、基线外只报告、新脚本必进基线、删基线行须声明）。

**Architecture:** 三件套——基线文件（55 个当前 PASS 脚本）+ lint 脚本（PR 级两条棘轮规则）+ workflow 改造（runner 判定逻辑 + baseline-lint job + `Smoke Glob Gate Passed` 聚合 job，照抄 l1-passed 的 PR-only 模式）。另附存量债分类报告（只分类不修）。

**Tech Stack:** GitHub Actions（ubuntu-latest）、bash、gh CLI。无应用代码改动。

**Spec:** docs/superpowers/specs/2026-07-07-smoke-ratchet-gate-design.md

**注意（repo 死规矩）：** PR 标题必须带 `[CONFIG]` 前缀（改 .yml 的约定）。被测物是 CI 行为本身（integration 档），无 vitest 面；每个 task 的"测试"= 本地可执行的验证命令，最终红路径靠 Task 5 的 proven-to-fire 分支。

---

### Task 1: 基线文件

**Files:**
- Create: `.github/workflows/scripts/smoke-baseline.txt`

- [ ] **Step 1: 写入 55 行基线**

文件内容（一行一个，已排序，来源 = run 28861827802 实际 PASS 56 个减 manual-verify-douyin.sh）：

```
account-me-smoke.sh
acq-sse-smoke.sh
acquisition-sse-nginx-route-smoke.sh
admin-platform-sessions-pages-smoke.sh
agent-client-encapsulation-smoke.sh
agent-core-self-upgrade-smoke.sh
agent-form-smoke.sh
agent-module-e2e-smoke.sh
agent-self-heal-smoke.sh
clips-smoke.sh
cs-oneclick-setup-smoke.sh
dashboard-walking-skeleton-1-smoke.sh
deploy-version-selfcheck-smoke.sh
golden-path-4-smoke.sh
heartbeat-modules-smoke.sh
line02-dm-dispatch-smoke.sh
line04-client-wiring-smoke.sh
line04-cs-autosend-no-feishu-smoke.sh
line04-cs-memory-smoke.sh
line04-cs-tenant-isolation-smoke.sh
line04-delivery-selfcheck-throttle-smoke.sh
line04-group-by-header-source-smoke.sh
line04-per-cs-config-smoke.sh
line04-phase0-observability-smoke.sh
line04-real-wheel-source-smoke.sh
line04-scan-from-top-source-smoke.sh
line04-scroll-wheel-source-smoke.sh
line04-ship-version-sync-smoke.sh
line04-version-lock-closure-smoke.sh
line04-wheel-mousemove-source-smoke.sh
notion-sync-smoke.sh
offscreen-version-gate-smoke.sh
operator-page-medium-smoke.sh
p4-ws2-feishu-bitable-smoke.sh
path4-sprint-1-ws1-smoke.sh
path4-sprint-1-ws2-smoke.sh
path4-sprint-1-ws3-smoke.sh
path4-sprint-1-ws4-smoke.sh
path4-sprint-1-ws5-smoke.sh
preflight-delivery-selfcheck-smoke.sh
release-selfcontained-smoke.sh
require-core-2023-smoke.sh
rotation-normalize-smoke.sh
session-health-smoke.sh
sprint-2-1d-agent-uptime-smoke.sh
sprint-2-1e-install-pack-smoke.sh
staging-promote-smoke.sh
staging-promote-workflow-smoke.sh
staging-smoke.sh
wechat-cs-config-smoke.sh
wechat-cs-engine-smoke.sh
wechat-cs-hardening-smoke.sh
wechat-cs-per-account-ia-redesign-smoke.sh
wechat-rpa-real-agent-smoke.sh
ws2-three-template-builders-smoke.sh
```

- [ ] **Step 2: 验证行数与文件存在性**

```bash
cd <worktree根>
wc -l .github/workflows/scripts/smoke-baseline.txt   # 期望 55
while IFS= read -r b; do
  [ -f ".github/workflows/scripts/smoke/$b" ] || echo "MISSING: $b"
done < .github/workflows/scripts/smoke-baseline.txt   # 期望无输出
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scripts/smoke-baseline.txt
git commit -m "feat(ci): smoke 棘轮基线——55 个当前 PASS 脚本锁定为必绿名单"
```

---

### Task 2: lint-smoke-baseline.sh（PR 级棘轮规则）

**Files:**
- Create: `.github/workflows/scripts/lint-smoke-baseline.sh`

- [ ] **Step 1: 写脚本**

```bash
#!/usr/bin/env bash
# lint-smoke-baseline —— smoke 棘轮闸的两条 PR 规则（机器卡，不靠自觉）
#   规则 1（新债不欠）：PR 新增的 *-smoke.sh 必须同时加进 smoke-baseline.txt
#   规则 2（删行留痕）：smoke-baseline.txt 有删除行时，PR body 必须含 "BASELINE-REMOVE:" 理由
# 用法: lint-smoke-baseline.sh [origin/main]
# 环境: PR_BODY 由 workflow 注入（${{ github.event.pull_request.body }}）
set -euo pipefail

BASE_REF="${1:-origin/main}"
git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

BASELINE=".github/workflows/scripts/smoke-baseline.txt"
SMOKE_DIR=".github/workflows/scripts/smoke"
FAIL=0

# ── 规则 1：新增 smoke 脚本必须进基线 ──────────────────────────────
NEW_SCRIPTS=$(git diff --name-only --diff-filter=A "$BASE_REF"...HEAD -- "$SMOKE_DIR" \
  | grep -E '/[^/]+-smoke\.sh$' || true)
for f in $NEW_SCRIPTS; do
  name=$(basename "$f")
  if ! grep -qxF "$name" "$BASELINE"; then
    echo "::error::新增 smoke 脚本 $name 未加入 smoke-baseline.txt（新债不欠：新脚本必须从第一天起被棘轮闸守护）"
    FAIL=1
  fi
done

# ── 规则 2：基线删行必须声明理由 ──────────────────────────────────
REMOVED=$(git diff "$BASE_REF"...HEAD -- "$BASELINE" \
  | grep '^-' | grep -v '^---' | sed 's/^-//' | grep -v '^[[:space:]]*$' || true)
if [ -n "$REMOVED" ]; then
  if ! printf '%s' "${PR_BODY:-}" | grep -q 'BASELINE-REMOVE:'; then
    echo "::error::smoke-baseline.txt 有删除行但 PR body 缺 'BASELINE-REMOVE:' 理由声明。删除的行: $(echo "$REMOVED" | tr '\n' ' ')"
    FAIL=1
  fi
fi

[ "$FAIL" -eq 0 ] && echo "✅ lint-smoke-baseline 通过"
exit "$FAIL"
```

```bash
chmod +x .github/workflows/scripts/lint-smoke-baseline.sh
```

- [ ] **Step 2: 本地红/绿验证（在 worktree 里用临时 commit 模拟，验完撤销）**

```bash
cd <worktree根>
# 绿：当前分支（只加了 baseline 文件，无删行、无未登记新脚本）
bash .github/workflows/scripts/lint-smoke-baseline.sh origin/main
# 期望: "✅ lint-smoke-baseline 通过" 且 exit 0

# 红-规则1：临时加一个不进基线的新 smoke
echo 'exit 0' > .github/workflows/scripts/smoke/zz-fire-test-smoke.sh
git add .github/workflows/scripts/smoke/zz-fire-test-smoke.sh
git commit -m "tmp"
bash .github/workflows/scripts/lint-smoke-baseline.sh origin/main; echo "exit=$?"
# 期望: ::error:: 新增 smoke 脚本 zz-fire-test-smoke.sh 未加入... 且 exit=1
git reset --hard HEAD~1

# 红-规则2：临时删一行基线且 PR_BODY 为空
sed -i '' '1d' .github/workflows/scripts/smoke-baseline.txt
git add -A && git commit -m "tmp"
PR_BODY="" bash .github/workflows/scripts/lint-smoke-baseline.sh origin/main; echo "exit=$?"
# 期望: ::error:: ...缺 'BASELINE-REMOVE:'... 且 exit=1
# 绿-规则2：带声明则过
PR_BODY="BASELINE-REMOVE: 测试" bash .github/workflows/scripts/lint-smoke-baseline.sh origin/main; echo "exit=$?"
# 期望: exit=0
git reset --hard HEAD~1
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scripts/lint-smoke-baseline.sh
git commit -m "feat(ci): lint-smoke-baseline——新增 smoke 必进基线 + 基线删行须 BASELINE-REMOVE 声明"
```

---

### Task 3: workflow 改造（ci-smoke-glob-runner.yml）

**Files:**
- Modify: `.github/workflows/ci-smoke-glob-runner.yml`

- [ ] **Step 1: 改头部（name + 注释 + 去 continue-on-error）**

1. `name: Smoke Glob Runner (report-only)` → `name: Smoke Glob Gate`
2. 头部注释块整体替换为：

```yaml
# ───────────────────────────────────────────────────────────────────────────
# smoke glob-gate —— PASS 基线棘轮闸（前身 report-only，Issue a4699d21 的"下一步"）
#
# 规则：
#   - smoke-baseline.txt 内的脚本 = 必绿（FAIL 重试 1 次后仍败 → job 红）
#   - 基线外脚本 FAIL = 存量债，仅 ::warning:: 报告（见 docs/smoke-debt-report.md）
#   - 基线条目在磁盘缺失 / 落入 DENYLIST → job 红（防删/挪脚本绕闸）
#   - PR 级规则见 baseline-lint job（新脚本必进基线 / 删基线行须 BASELINE-REMOVE:）
#   - 聚合 required check：Smoke Glob Gate Passed（仅 pull_request 事件）
# ───────────────────────────────────────────────────────────────────────────
```

3. job 级 `# report-only：本 job 失败绝不阻塞合并` 注释和 `continue-on-error: true` 两行删掉。
4. job `name: Smoke Glob Runner (report-only)` → `name: Smoke Glob Runner`

- [ ] **Step 2: 替换 "Discover + run" 步骤**

步骤更名 `Discover + run all CI-capable smoke scripts (ratchet gate)`，`run:` 整体替换为（DENYLIST 与 is_denied 保持原样不动）：

```bash
set -uo pipefail
DIR=".github/workflows/scripts/smoke"
BASELINE=".github/workflows/scripts/smoke-baseline.txt"

# ── DENYLIST：真机/RPA smoke，CI 跑不了（原样保留） ──
DENYLIST="
wechat-auto-launch-smoke.sh
wechat-rpa-auto-reply-smoke.sh
wechat-cs-visible-delivery-smoke.sh
line04-preflight-smoke.sh
"

is_denied() {
  local n="$1"
  for d in $DENYLIST; do [ "$n" = "$d" ] && return 0; done
  return 1
}

in_baseline() { grep -qxF "$1" "$BASELINE"; }

# wechat-rpa-real-agent 内含 npm install + build，90s 偶发超时，单独放宽
script_timeout() {
  case "$1" in
    wechat-rpa-real-agent-smoke.sh) echo 240 ;;
    *) echo 90 ;;
  esac
}

run_one() { timeout "$(script_timeout "$1")" bash "$DIR/$1"; }

RESULTS=$(mktemp)
PASS=0; DEBT_FAIL=0; GATE_FAIL=0; SKIP=0
for f in "$DIR"/*.sh; do
  name=$(basename "$f")
  if is_denied "$name"; then
    if in_baseline "$name"; then
      echo "::error::基线脚本 $name 同时在 DENYLIST（绕闸状态），二选一：移出基线（BASELINE-REMOVE）或移出 DENYLIST"
      GATE_FAIL=$((GATE_FAIL+1))
    fi
    echo "::group::SKIP (denylist 真机/RPA) $name"; echo "skipped"; echo "::endgroup::"
    printf '%s\tSKIP\t-\n' "$name" >> "$RESULTS"
    SKIP=$((SKIP+1))
    continue
  fi
  echo "::group::RUN $name"
  chmod +x "$f"
  if run_one "$name"; then
    echo "→ PASS $name"
    printf '%s\tPASS\t0\n' "$name" >> "$RESULTS"
    PASS=$((PASS+1))
  else
    rc=$?
    if in_baseline "$name"; then
      echo "→ FAIL ($rc) $name [基线内，重试 1 次]"
      sleep 5
      if run_one "$name"; then
        echo "→ PASS (retry) $name"
        printf '%s\tPASS-RETRY\t0\n' "$name" >> "$RESULTS"
        PASS=$((PASS+1))
      else
        rc2=$?
        echo "::error::基线内 smoke $name FAIL (exit $rc2，含重试)——棘轮闸阻断"
        printf '%s\tGATE-FAIL\t%s\n' "$name" "$rc2" >> "$RESULTS"
        GATE_FAIL=$((GATE_FAIL+1))
      fi
    else
      echo "::warning::存量债 smoke $name FAIL (exit $rc)（不阻塞，清偿见 docs/smoke-debt-report.md）"
      printf '%s\tDEBT-FAIL\t%s\n' "$name" "$rc" >> "$RESULTS"
      DEBT_FAIL=$((DEBT_FAIL+1))
    fi
  fi
  echo "::endgroup::"
done

# 防删/挪脚本绕闸：基线条目必须在磁盘存在
BASELINE_TOTAL=0
while IFS= read -r b; do
  [ -z "$b" ] && continue
  BASELINE_TOTAL=$((BASELINE_TOTAL+1))
  if [ ! -f "$DIR/$b" ]; then
    echo "::error::基线条目 $b 在 $DIR 不存在（删/挪脚本必须走 BASELINE-REMOVE 流程）"
    GATE_FAIL=$((GATE_FAIL+1))
  fi
done < "$BASELINE"

TOTAL=$((PASS+DEBT_FAIL+GATE_FAIL))
{
  echo "# Smoke Glob Gate 报告（棘轮闸）"
  echo ""
  echo "- 候选执行（非 denylist）: **$TOTAL**"
  echo "- ✅ PASS: **$PASS**"
  echo "- 🔴 基线内 FAIL（阻断）: **$GATE_FAIL** / 基线共 $BASELINE_TOTAL"
  echo "- ⚠️ 存量债 FAIL（不阻断）: **$DEBT_FAIL**"
  echo "- ⏭️ SKIP（denylist 真机/RPA）: **$SKIP**"
  echo ""
  echo "## 阻断清单（基线内 FAIL）"
  awk -F'\t' '$2=="GATE-FAIL"{print "- 🔴 `"$1"` (exit "$3")"}' "$RESULTS" || true
  echo ""
  echo "## 存量债清单（不阻断）"
  awk -F'\t' '$2=="DEBT-FAIL"{print "- `"$1"` (exit "$3")"}' "$RESULTS" || true
  echo ""
  echo "> 棘轮规则：基线内必绿；存量债转绿后请把脚本名加进 smoke-baseline.txt（棘轮只进不退）。"
} >> "$GITHUB_STEP_SUMMARY"

echo "TOTAL=$TOTAL PASS=$PASS GATE_FAIL=$GATE_FAIL DEBT_FAIL=$DEBT_FAIL SKIP=$SKIP"
if [ "$GATE_FAIL" -gt 0 ]; then
  echo "::error::Smoke Glob Gate 阻断：$GATE_FAIL 个基线内脚本 FAIL"
  exit 1
fi
exit 0
```

- [ ] **Step 3: 追加 baseline-lint 与 gate 两个 job（文件末尾，与 smoke-glob-runner 平级）**

```yaml
  baseline-lint:
    name: Smoke Baseline Lint
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      PR_BODY: ${{ github.event.pull_request.body }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Run lint-smoke-baseline
        run: bash .github/workflows/scripts/lint-smoke-baseline.sh origin/main

  # 聚合 required check（照抄 ci-l1-process.yml l1-passed 模式：PR-only，
  # 不裸比 != success 以免把 push/schedule 下 skipped 的 baseline-lint 判红）
  gate:
    name: Smoke Glob Gate Passed
    needs: [smoke-glob-runner, baseline-lint]
    if: always() && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Check gates
        run: |
          check() {
            if [ "$2" != "success" ]; then echo "❌ $1: $2"; exit 1; fi
            echo "✅ $1"
          }
          check "smoke-glob-runner" "${{ needs.smoke-glob-runner.result }}"
          check "baseline-lint"     "${{ needs.baseline-lint.result }}"
```

- [ ] **Step 4: 本地静态验证**

```bash
# YAML 合法性
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci-smoke-glob-runner.yml')); print('YAML OK')"
# 确认 report-only 痕迹清干净
grep -n "report-only\|continue-on-error" .github/workflows/ci-smoke-glob-runner.yml
# 期望: 无 continue-on-error；注释里不再宣称 report-only（历史引用可留在 debt 报告里）
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci-smoke-glob-runner.yml
git commit -m "[CONFIG] feat(ci): smoke glob runner 升棘轮闸——基线内红即阻断+baseline-lint+Smoke Glob Gate Passed 聚合"
```

---

### Task 4: 存量债分类报告

**Files:**
- Create: `docs/smoke-debt-report.md`

- [ ] **Step 1: 从 run 日志生成 144 条分类**

```bash
LOG=/tmp/smoke-ratchet/full.log
gh run view 28861827802 --repo perfectuser21/zenithjoy-workspace --log > "$LOG" 2>/dev/null
# 每个 FAIL 脚本：抓 "→ FAIL (rc) name" 行 + 该脚本 ::group:: 内最后 3 行报错
# 分类启发式：
#   环境类: 匹配 "got 000|不可达|ECONNREFUSED|Connection refused|无法连接|health.*fail"
#   超时类: rc=124
#   断言类: 其余（expected.*got / FAIL: 业务断言 / 解压失败等）
python3 <<'PY'
import re, collections
log = open('/tmp/smoke-ratchet/full.log', encoding='utf-8', errors='replace').read()
# 去掉前缀列（gh log 是 "job\tstep\tts 内容"）
lines = [re.sub(r'^[^\t]*\t[^\t]*\t\S+ ', '', l) for l in log.splitlines()]
fails, buf = {}, []
for l in lines:
    buf.append(l)
    m = re.match(r'→ FAIL \((\d+)\) (\S+\.sh)', l)
    if m:
        rc, name = m.group(1), m.group(2)
        tail = [x for x in buf[-8:-1] if x.strip()][-3:]
        fails[name] = (rc, tail)
        buf = []
env_pat = re.compile(r'got 000|不可达|ECONNREFUSED|Connection refused|无法连接|health', re.I)
cats = collections.defaultdict(list)
for name, (rc, tail) in sorted(fails.items()):
    joined = ' '.join(tail)
    cat = '超时类' if rc == '124' else ('环境类' if env_pat.search(joined) else '断言类')
    cats[cat].append((name, rc, joined[:160]))
with open('docs/smoke-debt-report.md', 'w') as f:
    f.write('# Smoke 存量债分类报告（2026-07-07，run 28861827802）\n\n')
    f.write(f'存量债总数：{len(fails)}（基线外 FAIL，不阻断 CI；转绿一个加基线一个，棘轮只进不退）\n\n')
    f.write('| 类别 | 数量 | 处置方向 |\n|---|---|---|\n')
    f.write(f"| 环境类 | {len(cats['环境类'])} | CI 内补起依赖服务，或确认 CI 跑不了 → 进 DENYLIST |\n")
    f.write(f"| 断言类 | {len(cats['断言类'])} | 真 drift，按 Line 分批修复后加基线 |\n")
    f.write(f"| 超时类 | {len(cats['超时类'])} | 查慢因，放宽 per-script timeout 或修脚本 |\n\n")
    for cat in ('断言类', '环境类', '超时类'):
        f.write(f'\n## {cat}（{len(cats[cat])}）\n\n')
        for name, rc, excerpt in cats[cat]:
            f.write(f'- `{name}` (exit {rc}) — {excerpt}\n')
print('done,', len(fails), '条')
PY
```

- [ ] **Step 2: 人工抽查 10 条分类是否合理**（读生成的 md，抽查环境类/断言类各 5 条对照日志，错分的手动改类）

- [ ] **Step 3: 核对总数 = 144，Commit**

```bash
grep -c '^- `' docs/smoke-debt-report.md   # 期望 144
git add docs/smoke-debt-report.md
git commit -m "docs(ci): smoke 存量债分类报告——144 条按环境/断言/超时分类待清偿"
```

---

### Task 5: push + PR + proven-to-fire 验证（PR 开出后、merge 前）

- [ ] **Step 1: push + 开 PR**

PR 标题：`[CONFIG] feat(ci): smoke glob runner 升棘轮闸——PASS 基线阻断 + baseline-lint + 聚合 required 锚点`
PR body 必须含：三条 fire 验证占位（后补 run 链接）、基线 55 说明、`Smoke Glob Gate Passed` merge 后将加 required 的说明。

- [ ] **Step 2: 等本 PR CI——绿路径自证**

`Smoke Glob Gate Passed` 必须绿（55 基线全过 + baseline-lint 过）。

- [ ] **Step 3: fire-1（基线内破坏 → runner 红）**

```bash
git checkout -b fire1-smoke-gate origin/cp-07072252-smoke-ratchet-gate
printf '\nexit 1  # fire test\n' >> .github/workflows/scripts/smoke/wechat-cs-hardening-smoke.sh
git commit -am "fire-1: 故意破坏基线内 smoke 验证棘轮闸报红" && git push -u origin fire1-smoke-gate
gh pr create --title "[FIRE-TEST] 勿合并 fire-1" --body "验证棘轮闸，验完即关" --draft
# 期望: Smoke Glob Runner 红（::error:: 基线内 smoke ... 阻断），Smoke Glob Gate Passed 红
```

- [ ] **Step 4: fire-2（新脚本不进基线 → baseline-lint 红）**

```bash
git checkout -b fire2-smoke-gate origin/cp-07072252-smoke-ratchet-gate
echo 'exit 0' > .github/workflows/scripts/smoke/zz-fire2-smoke.sh
git add -A && git commit -m "fire-2: 新增 smoke 不进基线验证 lint 报红" && git push -u origin fire2-smoke-gate
gh pr create --title "[FIRE-TEST] 勿合并 fire-2" --body "验证 baseline-lint 规则1，验完即关" --draft
# 期望: Smoke Baseline Lint 红（新债不欠）
```

- [ ] **Step 5: fire-3（删基线行无声明 → baseline-lint 红）**

```bash
git checkout -b fire3-smoke-gate origin/cp-07072252-smoke-ratchet-gate
sed -i '' '1d' .github/workflows/scripts/smoke-baseline.txt
git commit -am "fire-3: 删基线行不带声明验证 lint 报红" && git push -u origin fire3-smoke-gate
gh pr create --title "[FIRE-TEST] 勿合并 fire-3" --body "验证 baseline-lint 规则2（本 body 故意不含那个关键词），验完即关" --draft
# 期望: Smoke Baseline Lint 红（缺 BASELINE-REMOVE:）
```

- [ ] **Step 6: 三红确认后，run 链接贴回主 PR body，关闭三个 fire PR + 删分支**

```bash
gh pr close <fire1> --delete-branch; gh pr close <fire2> --delete-branch; gh pr close <fire3> --delete-branch
```

- [ ] **Step 7: merge 后（人工/watchdog）——把聚合名加进 required checks**

```bash
gh api -X PATCH repos/perfectuser21/zenithjoy-workspace/branches/main/protection/required_status_checks \
  --input <(gh api repos/perfectuser21/zenithjoy-workspace/branches/main/protection/required_status_checks \
    | python3 -c "import json,sys; d=json.load(sys.stdin); d['contexts']=sorted(set(d['contexts']+['Smoke Glob Gate Passed'])); print(json.dumps({'strict': d['strict'], 'contexts': d['contexts']}))")
# 验证
gh api repos/perfectuser21/zenithjoy-workspace/branches/main/protection --jq '.required_status_checks.contexts'
# 期望: 含 "Smoke Glob Gate Passed" 共 7 项
```
