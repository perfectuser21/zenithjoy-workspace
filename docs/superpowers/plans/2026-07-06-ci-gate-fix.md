# CI 可信化修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消灭三处"红着没人管"的 CI（两个坏 YAML workflow + 真机闸非 required），并加 L1 机械闸防坏 YAML 再犯。

**Architecture:** commit-1（Red）= L1 YAML 解析闸 + selfcheck 纯函数 failing test；commit-2（Green）= 修 preflight-hardening 顶格 here-string、删 cleanup workflow + 37 个 .prd/.task 残留、selfcheck 找窗口状态机、wechat-cs-e2e 重构出 `WeChat CS Gate Passed` 聚合 job。合并后 PATCH branch protection 把该 context 设为 required。

**Tech Stack:** GitHub Actions YAML / bash / Python(pyyaml, pytest) / PowerShell(here-string) / gh api。

Spec: `docs/superpowers/specs/2026-07-06-ci-gate-fix-design.md`

---

### Task 1: commit-1（Red）— L1 YAML 解析闸 + selfcheck 纯函数 failing test

**Files:**
- Create: `.github/workflows/scripts/lint-workflow-yaml-parse.py`
- Modify: `.github/workflows/ci-l1-process.yml`（新 job + gate needs + gate 检查块）
- Test: `services/agent/wechat-rpa/tests/test_selfcheck_gate_state.py`

- [ ] **Step 1: 写 lint 脚本**

`.github/workflows/scripts/lint-workflow-yaml-parse.py`：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L1 机械闸：.github/workflows/ 下所有 workflow 文件必须可被 YAML 解析。

背景（2026-07-06 实证）：agent-preflight-hardening-e2e.yml / cleanup-merged-artifacts.yml
因 run 块内顶格行破坏 block scalar，GitHub 无法解析 → 每次 push 生成无 job 的红 run，
且 paths 过滤失效，21/21 全红无人管。坏 YAML 必须在 PR 阶段拦下。
"""
import glob
import sys

import yaml

def main() -> int:
    paths = sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"))
    if not paths:
        print("FAIL: 未找到任何 workflow 文件（脚本跑错目录？）")
        return 1
    bad = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                yaml.safe_load(fh)
        except yaml.YAMLError as exc:
            bad.append((path, str(exc)))
    for path, err in bad:
        print(f"FAIL {path}\n{err}\n")
    if bad:
        print(f"{len(bad)} 个 workflow YAML 解析失败：坏文件会让每次 push 秒红且 paths 过滤失效")
        return 1
    print(f"OK: {len(paths)} 个 workflow YAML 全部可解析")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 本地跑 lint，亲眼看它红（proven-to-fire 证据）**

Run: `cd /Users/administrator/worktrees/zenithjoy/session-156c53a2 && python3 .github/workflows/scripts/lint-workflow-yaml-parse.py; echo "exit=$?"`
Expected: 输出两个 FAIL（agent-preflight-hardening-e2e.yml line 176-177 / cleanup-merged-artifacts.yml line 51-52），`exit=1`。**把这段输出保存下来，进 PR 描述。**
若出现第三个 FAIL 文件：停下，把它也纳入 commit-2 修复清单。

- [ ] **Step 3: ci-l1-process.yml 加 job**（插在 `lint-contract-test-immutability` job 之后、`# ─── Gate job` 注释之前）：

```yaml
  lint-workflow-yaml-parse:
    name: Lint — Workflow YAML Parse
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: All workflow files must parse as YAML
        run: |
          python3 -m pip install --quiet pyyaml
          python3 .github/workflows/scripts/lint-workflow-yaml-parse.py
```

- [ ] **Step 4: 把 job 加进 L1 gate**

`ci-l1-process.yml:370-372` 的 needs 数组末尾加 `lint-workflow-yaml-parse`：

```yaml
    needs: [verify-dev-workflow, pr-title, ci-config-audit, secrets-scan, frontend-browser-dod-check,
            lint-test-pairing, lint-test-quality, lint-tdd-commit-order, lint-no-fake-test, lint-feature-has-smoke,
            lint-agent-version-bump, lint-wechat-rpa-runner, lint-contract-test-immutability, lint-workflow-yaml-parse]
```

gate 的 run 脚本里（最后一个 `needs.*.result` 检查块之后、`if [ "$FAILED" = true ]` 之前）加：

```bash
          if [ "${{ needs.lint-workflow-yaml-parse.result }}" != "success" ]; then
            echo "FAIL: Workflow YAML Parse (${{ needs.lint-workflow-yaml-parse.result }})"
            FAILED=true
          fi
```

- [ ] **Step 5: 写 selfcheck 纯函数 failing test**

`services/agent/wechat-rpa/tests/test_selfcheck_gate_state.py`：

```python
# -*- coding: utf-8 -*-
"""selfcheck_bubbles 找窗口状态机纯函数（2026-07-06 CI 闸修复）。

背景：rog 微信 UIA 死区 ~40h 期间 gate 报「no wechat window — 微信没跑或没登录」，
把「进程在但 UIA 死区」和「微信真没跑」混为一谈，运营无法按 reason 行动。
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools")))

from selfcheck_bubbles import (  # noqa: E402
    FIND_WINDOW_RETRIES,
    FIND_WINDOW_RETRY_DELAY_S,
    classify_no_window,
)


def test_no_process_classified():
    code, msg = classify_no_window(process_running=False)
    assert code == "NO_PROCESS"
    assert "Weixin.exe" in msg


def test_uia_dead_classified():
    code, msg = classify_no_window(process_running=True)
    assert code == "UIA_DEAD"
    assert "UIA" in msg


def test_retry_budget_covers_transient_startup():
    # 有界重试至少覆盖 1 分钟瞬态（微信启动/树重建），但别无限等
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S >= 60
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S <= 180
```

- [ ] **Step 6: 跑 test 确认 Red**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_selfcheck_gate_state.py -v 2>&1 | tail -5`
Expected: FAIL/ERROR，`ImportError: cannot import name 'classify_no_window'`。

- [ ] **Step 7: Commit-1**

```bash
git add .github/workflows/scripts/lint-workflow-yaml-parse.py .github/workflows/ci-l1-process.yml services/agent/wechat-rpa/tests/test_selfcheck_gate_state.py
git commit -m "[CONFIG] test(ci): L1 加 workflow YAML 解析闸(对现存2个坏文件proven-to-fire红) + selfcheck 状态机 failing test"
```

---

### Task 2: 修 agent-preflight-hardening-e2e.yml（顶格 here-string）

**Files:**
- Modify: `.github/workflows/agent-preflight-hardening-e2e.yml:175-179`

- [ ] **Step 1: 把 E2E-3 here-string 的 4 个顶格行缩进到 10 空格（块基准缩进）**

现状（L175-179，L176-179 顶格 → 跳出 `run: |` 块）：

```yaml
              Set-Content "$tmpDir\wechat-rpa\preflight.py" @"
import sys
print('[preflight] FAIL: mock failure — testing blocking behavior')
sys.exit(1)
"@
```

改为（内容行与终结符都在文件列 10 = YAML strip 后列 0，PowerShell here-string 终结符必须行首，python mock 文件必须无前导空格——两个约束同时满足）：

```yaml
              Set-Content "$tmpDir\wechat-rpa\preflight.py" @"
          import sys
          print('[preflight] FAIL: mock failure - testing blocking behavior')
          sys.exit(1)
          "@
```

注意：顺手把 `—`（em-dash）换成 ASCII `-`——该 run 块是 pwsh，遵守 #1050 的「Windows PowerShell run 块全 ASCII」教训（中文/全角只留在 YAML 注释）。

- [ ] **Step 2: 本地验证 YAML 已可解析**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/agent-preflight-hardening-e2e.yml'))" && echo PARSE-OK`
Expected: `PARSE-OK`

- [ ] **Step 3: 本地预跑 Linux 侧断言（防止修活 YAML 后内容性红）**

Run:
```bash
cd services/agent/wechat-rpa && PUBLIC=/tmp python3 preflight.py --dry-run >/dev/null 2>&1; python3 -c "
import json
r = json.load(open('/tmp/zj-preflight.json', encoding='utf-8'))
checks = r['checks']
assert len(checks) == 8, f'期望8项，实际{len(checks)}'
assert not [x for x in checks if x['name'] == 'lock_update']
print('OK: 8项检测')
" && python3 -m pytest tests/test_preflight_lock.py -q 2>&1 | tail -2
```
Expected: `OK: 8项检测` + pytest 全 pass。若断言挂 → 该步骤断言与当前代码漂移，按当前代码真相修断言（不改产品代码），并在 PR 描述注明。

- [ ] **Step 4: 不单独 commit（并入 Task 5 的 commit-2）**

---

### Task 3: 删 cleanup-merged-artifacts.yml + 37 个残留

**Files:**
- Delete: `.github/workflows/cleanup-merged-artifacts.yml`
- Delete: main 上全部 `git ls-files | grep -E '^\.(prd|task)-'`（37 个）

- [ ] **Step 1: 删除**

```bash
git rm -q .github/workflows/cleanup-merged-artifacts.yml
git ls-files | grep -E '^\.(prd|task)-' | xargs git rm -q
git status --short | head -5
```
Expected: 38 个 D。理由（进 commit message）：该 workflow 生来即坏从未跑通；其「直推 main」设计与分支保护不兼容，修 YAML 也会换方式红；残留全是 2026-05 遗产、生成来源已不存在。

- [ ] **Step 2: 不单独 commit（并入 Task 5 的 commit-2）**

---

### Task 4: selfcheck_bubbles.py 找窗口状态机（Green）

**Files:**
- Modify: `services/agent/tools/selfcheck_bubbles.py`

- [ ] **Step 1: 模块顶部（`TARGET = "文件传输助手"` 之后）加常量与纯函数**

```python
# 找窗口有界重试：覆盖微信启动/树重建瞬态（≥60s），但别无限等（≤180s）
FIND_WINDOW_RETRIES = 6
FIND_WINDOW_RETRY_DELAY_S = 12.0


def classify_no_window(process_running: bool) -> tuple:
    """重试耗尽仍找不到 mmui 主窗口时，把「微信没跑」和「UIA 死区」分开报。

    2026-07-06 实证：rog UIA 死区 ~40h（微信启动时 SPI 标志未置位→树不构建），
    期间 gate 笼统报「微信没跑或没登录」误导运营（微信明明登录着）。
    """
    if not process_running:
        return ("NO_PROCESS", "Weixin.exe 未运行 - 请在 runner 机启动并登录微信")
    return (
        "UIA_DEAD",
        "微信进程在但 UIA 找不到主窗口(mmui) - UIA 死区(启动时无障碍标志未置位)，"
        "需重启微信/等待 listener 自愈(issue e6203ac4)",
    )


def _weixin_process_running() -> bool:
    import subprocess
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Weixin.exe"],
            capture_output=True, text=True, timeout=15,
        ).stdout or ""
        return "Weixin.exe" in out
    except Exception:
        return True  # 查不出进程时保守当作在跑 → 走 UIA_DEAD 分支（宁可报死区不误报没跑）


def _find_mmui_window(desktop_cls):
    for w in desktop_cls(backend="uia").windows():
        try:
            cls = w.element_info.class_name or ""
        except Exception:
            continue
        if "mmui" in cls.lower():
            return w
    return None
```

- [ ] **Step 2: main() 里替换找窗口段（原 L58-70）**

原：

```python
        mw = None
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name or ""
            except Exception:
                continue
            if "mmui" in cls.lower():
                mw = w
                break
        if mw is None:
            result["err"] = "no wechat window (mmui) — 微信没跑或没登录"
            _write(result)
            return 1
```

改为：

```python
        mw = _find_mmui_window(Desktop)
        if mw is None:
            # 有界重试：先设 SPI 屏幕阅读器标志（幂等），再等树/窗口就绪
            try:
                listen_chat._activate_uia()
            except Exception:
                pass
            for i in range(FIND_WINDOW_RETRIES):
                time.sleep(FIND_WINDOW_RETRY_DELAY_S)
                mw = _find_mmui_window(Desktop)
                if mw is not None:
                    print(f"[bubble-gate] window found after retry {i + 1}")
                    break
        if mw is None:
            code, msg = classify_no_window(_weixin_process_running())
            result["err"] = f"no wechat window (mmui) [{code}] {msg}"
            _write(result)
            return 1
```

（保留 `no wechat window (mmui)` 前缀，workflow 日志检索习惯不变。gate 只观察不重启微信——自愈归 listen_chat，另 PR。）

- [ ] **Step 3: 跑 test 确认 Green**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_selfcheck_gate_state.py tests/ -q 2>&1 | tail -3`
Expected: 新增 3 个用例 pass，存量 pytest 无破坏。

- [ ] **Step 4: 不单独 commit（并入 Task 5 的 commit-2）**

---

### Task 5: wechat-cs-e2e.yml 重构（path-aware + 聚合 gate）+ commit-2

**Files:**
- Modify: `.github/workflows/wechat-cs-e2e.yml`

- [ ] **Step 1: 触发段去 paths 过滤**（L11-18 pull_request 只留 branches）：

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

同时在文件头注释补一行：`# required context = "WeChat CS Gate Passed"（path-aware：不相关 PR 三个 job skip、gate 秒绿不占 rog）`

- [ ] **Step 2: jobs: 下新增第一个 job `changes`**：

```yaml
  changes:
    name: changes — 变更路径检测
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      agent_or_api: ${{ steps.filter.outputs.agent_or_api }}
      agent: ${{ steps.filter.outputs.agent }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: filter
        shell: bash
        run: |
          if [ "${{ github.event_name }}" != "pull_request" ]; then
            echo "agent_or_api=true" >> "$GITHUB_OUTPUT"
            echo "agent=true" >> "$GITHUB_OUTPUT"
            echo "non-PR event: run all"
            exit 0
          fi
          BASE="${{ github.event.pull_request.base.sha }}"
          HEAD="${{ github.event.pull_request.head.sha }}"
          FILES=$(git diff --name-only "$BASE" "$HEAD")
          echo "$FILES"
          AGENT=false; AGENT_OR_API=false
          if echo "$FILES" | grep -qE '^(services/agent/|\.github/workflows/wechat-cs-e2e\.yml)'; then AGENT=true; fi
          if echo "$FILES" | grep -qE '^(services/agent/|apps/api/|\.github/workflows/wechat-cs-e2e\.yml)'; then AGENT_OR_API=true; fi
          echo "agent=$AGENT" >> "$GITHUB_OUTPUT"
          echo "agent_or_api=$AGENT_OR_API" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: 三个业务 job 挂条件**

- `middleware-chain:`（job1）加：
  ```yaml
    needs: changes
    if: needs.changes.outputs.agent_or_api == 'true'
  ```
- `agent-windows:`（job2）与 `bubble-read-gate:`（job3）各加：
  ```yaml
    needs: changes
    if: needs.changes.outputs.agent == 'true'
  ```

- [ ] **Step 4: 文件末尾加聚合 gate job**：

```yaml
  # ─── Gate job（required context，与 L1/L2 Gate Passed 同款）─────────────────
  wechat-cs-gate:
    name: WeChat CS Gate Passed
    needs: [changes, middleware-chain, agent-windows, bubble-read-gate]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: WeChat CS Gate
        run: |
          echo "changes=${{ needs.changes.result }} job1=${{ needs.middleware-chain.result }} job2=${{ needs.agent-windows.result }} job3=${{ needs.bubble-read-gate.result }}"
          if [ "${{ needs.changes.result }}" != "success" ]; then
            echo "FAIL: changes 检测未成功"; exit 1
          fi
          for r in "${{ needs.middleware-chain.result }}" "${{ needs.agent-windows.result }}" "${{ needs.bubble-read-gate.result }}"; do
            case "$r" in
              success|skipped) ;;
              *) echo "FAIL: 有 job 结果为 $r"; exit 1 ;;
            esac
          done
          echo "WeChat CS Gate Passed"
```

- [ ] **Step 5: 本地全量验证**

Run:
```bash
python3 .github/workflows/scripts/lint-workflow-yaml-parse.py
cd services/agent/wechat-rpa && python3 -m pytest tests/ -q 2>&1 | tail -2
```
Expected: lint `OK: 58 个 workflow YAML 全部可解析`（59-1 删除）；pytest 全 pass。

- [ ] **Step 6: Commit-2**

```bash
git add -A
git commit -m "[CONFIG] fix(ci): 修preflight-hardening顶格here-string+删cleanup坏闸与37残留+selfcheck状态机+WeChat真机闸path-aware聚合gate"
```

---

### Task 6: push + PR + 盯 CI

- [ ] **Step 1: push 并开 PR**

```bash
git push -u origin cp-07061020-ci-gate-fix
gh pr create --title "[CONFIG] fix(ci): 根治两个坏YAML workflow+L1加YAML解析闸+WeChat真机闸required化(path-aware)" --body "$(cat <<'EOF'
## 本 PR 把 Path 4 的支撑闸（dev_pipeline）从「40+次红无人管」推到「required 可信」

### 根因与修复（0706 实证，详见 docs/superpowers/specs/2026-07-06-ci-gate-fix-design.md）
1. **agent-preflight-hardening-e2e.yml**：E2E-3 PowerShell here-string 内容顶格跳出 run 块 → YAML 解析失败 → 每 push 秒红（paths 过滤失效）。修：4 行缩进到块基准（strip 后仍是行首，PS/python 两侧约束同时满足）。
2. **cleanup-merged-artifacts.yml**：生来即坏（创建 commit 即含顶格 commit message 行），且「直推 main」设计与分支保护根本不兼容 → 删除 workflow + 一次性清掉它欠下的 37 个 .prd-*/.task-* 残留（全部 2026-05 遗产，来源已消失）。
3. **L1 新增 Lint — Workflow YAML Parse**：全部 workflow 必须可解析，纳入 L1 Process Gate Passed。**proven-to-fire**：修复前本地跑对上述两文件报红（见下）。
4. **WeChat CS Hardening — E2E**：新增 changes 检测 + `WeChat CS Gate Passed` 聚合 job（path-aware：不碰 services/agent|apps/api 的 PR 三 job skip、gate 秒绿不占 rog）。合并后把该 context 加进 branch protection required（40+ 次红全被无视的根治）。
5. **selfcheck_bubbles.py**：找窗口加 SPI 激活+有界重试（6×12s），耗尽后区分 `NO_PROCESS`（微信没跑）/`UIA_DEAD`（进程在但 UIA 死区，rog 0704-0706 实锤 40h）。gate 只观察不自愈——listener 自愈是 issue e6203ac4（另 PR）。

### proven-to-fire 证据（commit-1 时本地）
<粘贴 Task 1 Step 2 的两个 FAIL 输出>

### 关联
Brain Task 1a45c0e9 / Issues f194490f（本 PR）+ e6203ac4（后续 PR：listen_chat UIA 死区自愈）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: 确认本 PR 触发了重构后的 workflow 真跑**

Run: `gh pr checks <PR#> --watch` 或 `gh run list --branch cp-07061020-ci-gate-fix --limit 10`
Expected: `WeChat CS Gate Passed` 出现且随 job1/2/3 结果给结论（本 PR 碰 services/agent → 三 job 全跑，job3 上 rog 真机）；`Agent Preflight Hardening E2E` 正常出 job 级 run；L1 里 `Lint — Workflow YAML Parse` 绿。
若 job3 因 rog 状态红：先用 memory `wechat_selfcheck_proven_to_fire_method` 的探针确认机器态，机器真死区 → 是诚实红，通知用户处理机器，不改代码强行绿。

---

### Task 7: 合并后 — required 化 + 验证

- [ ] **Step 1: PATCH branch protection（合并后才做，避免存量 PR 卡 expected）**

```bash
REPO=$(git remote get-url origin | sed 's/.*github.com[:/]//;s/\.git//')
gh api -X PATCH "repos/$REPO/branches/main/protection/required_status_checks" \
  --input - <<'EOF'
{"strict": false, "contexts": ["L3 Code Gate Passed", "L4 E2E Gate Passed", "L4 Runtime Gate Passed", "Integration Gate Passed", "L2 Consistency Gate Passed", "WeChat CS Gate Passed"]}
EOF
```
注意：先 `gh api repos/$REPO/branches/main/protection/required_status_checks --jq .strict` 读当前 strict 值原样回填，不擅自改。
403 → 输出给用户的手动步骤：GitHub → Settings → Branches → main → Require status checks → 勾 `WeChat CS Gate Passed`。

- [ ] **Step 2: 验证**

Run: `gh api "repos/$REPO/branches/main/protection" --jq '.required_status_checks.contexts'`
Expected: 6 个 context 含 `WeChat CS Gate Passed`。

- [ ] **Step 3: 回写台账**
- Brain issue f194490f → resolved（备注 PR 号 + required 化完成）。
- memory/skill 台账更新由 engine-ship / harness-report 流程带走。
