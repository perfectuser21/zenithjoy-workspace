# Agent 一键安装加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `start.bat` 三大静默失败场景：微信版本不对无法自修、讲述人激活失败无报错、开机自启需手动注册。

**Architecture:** 纯修改现有文件，无新组件。TDD：commit-1 写 5 个 failing tests，commit-2 修代码让 tests 变绿。修改后 rsync 同步到 build-modules。

**Tech Stack:** Python 3.11 (pytest, unittest.mock), Windows BAT, PowerShell

---

### Task 1：写 failing tests（commit-1）

**Files:**
- Create: `services/agent/wechat-rpa/tests/test_preflight_oneclick.py`

- [ ] **Step 1: 创建测试文件（内容全部写进去，一次性创建）**

工作目录：worktree `/Users/administrator/perfect21/zenithjoy-06112155-hardening`

```python
# services/agent/wechat-rpa/tests/test_preflight_oneclick.py
"""
test_preflight_oneclick.py — Agent 一键安装加固回归测试。

验证 4 个修复点：
  1. check_uia_narrator: Narrator.exe 不存在 → failed（非 dry_run 且 is_windows 时）
  2. check_uia_narrator: subprocess 抛异常 → failed（非 dry_run 且 is_windows 时）
  3. check_uia_narrator: subprocess 成功但无主窗口 → warn（兼容"微信未登录"场景）
  4. start.bat 包含 install-autostart.ps1 调用
  5. start.bat 不再包含早退的版本守卫块

跨平台纪律：所有 Windows-only 路径用 monkeypatch/mock 模拟。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
INSTALL_PACK_DIR = os.path.abspath(os.path.join(HERE, "../../install-pack"))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import preflight  # noqa: E402
from preflight import check_uia_narrator  # noqa: E402

NARRATOR_PATH = r"C:\Windows\System32\Narrator.exe"


# ──────────────────────────────────────────────────────────────────────────────
# 测试 1：Narrator.exe 不存在 → failed（Windows 真机路径）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_exe_missing_returns_failed(monkeypatch):
    """Narrator.exe 不存在时（LTSC/N 精简版）→ status=failed，并给出明确提示。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    # 只对 Narrator.exe 路径返回 False，其他路径不影响
    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return False
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "failed", (
        f"期望 failed，实际 {result['status']!r}。detail: {result['detail']}"
    )
    assert "Narrator" in result["detail"], "错误提示应包含 Narrator"


# ──────────────────────────────────────────────────────────────────────────────
# 测试 2：subprocess 启动 Narrator 抛异常 → failed（Windows 真机路径）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_subprocess_exception_returns_failed(monkeypatch):
    """Narrator.exe 存在但 subprocess 启动失败 → status=failed，并给修复指引。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)

    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return True
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    # subprocess.run 抛 RuntimeError 模拟 Narrator 启动失败
    import subprocess as _subprocess

    def fake_run(cmd, **kwargs):
        if "Narrator" in " ".join(str(c) for c in cmd):
            raise RuntimeError("进程启动失败：组策略禁用了讲述人")
        return MagicMock(returncode=0)

    monkeypatch.setattr(_subprocess, "run", fake_run)
    # 确保 time.sleep 不等待
    import time as _time
    monkeypatch.setattr(_time, "sleep", lambda _: None)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "failed", (
        f"期望 failed，实际 {result['status']!r}。detail: {result['detail']}"
    )
    # 应包含修复指引（非管理员/组策略/完整版）
    detail_lower = result["detail"].lower()
    assert any(kw in detail_lower for kw in ("管理员", "组策略", "完整", "narrator")), (
        f"detail 缺少修复指引：{result['detail']}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 3：subprocess 成功但无主窗口 → warn（微信未登录兼容场景）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_subprocess_ok_no_window_returns_warn(monkeypatch):
    """Narrator 激活成功，但微信未登录时暂无主窗口 → status=warn（不阻断，登录后生效）。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)

    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return True
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    import subprocess as _subprocess
    monkeypatch.setattr(_subprocess, "run", lambda *a, **kw: MagicMock(returncode=0))
    import time as _time
    monkeypatch.setattr(_time, "sleep", lambda _: None)

    # 模拟 find_weixin.get_main_window 返回 None（微信未登录）
    fake_fw = MagicMock()
    fake_fw.get_main_window = MagicMock(return_value=None)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: None)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "warn", (
        f"期望 warn（微信未登录，登录后生效），实际 {result['status']!r}。detail: {result['detail']}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 4：start.bat 包含 install-autostart.ps1 调用
# ──────────────────────────────────────────────────────────────────────────────

def test_start_bat_contains_autostart_call():
    """start.bat 必须包含对 install-autostart.ps1 的调用（不再需要用户手动跑）。"""
    bat_path = os.path.join(INSTALL_PACK_DIR, "start.bat")
    assert os.path.isfile(bat_path), f"找不到 start.bat：{bat_path}"
    content = Path(bat_path).read_text(encoding="utf-8", errors="ignore")
    assert "install-autostart.ps1" in content, (
        "start.bat 必须包含对 install-autostart.ps1 的调用（开机自启应自动注册）"
    )
    # 必须是 powershell 调用，不能只是注释
    import re
    assert re.search(r"powershell.*install-autostart\.ps1", content, re.IGNORECASE), (
        "start.bat 缺少 `powershell ... install-autostart.ps1` 真实调用行"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 5：start.bat 不再有早退的版本守卫块
# ──────────────────────────────────────────────────────────────────────────────

def test_start_bat_no_early_version_exit():
    """
    start.bat 不应再有"版本不对就 exit /b 1"的早退块。
    preflight.py step 6.9 已有完整版本检测+自修，早退块会阻断自修。
    """
    bat_path = os.path.join(INSTALL_PACK_DIR, "start.bat")
    assert os.path.isfile(bat_path), f"找不到 start.bat：{bat_path}"
    content = Path(bat_path).read_text(encoding="utf-8", errors="ignore")
    # 早退块的特征：同时含 --check-version 和 exit /b 1
    import re
    has_check_version = "--check-version" in content
    has_early_exit = bool(re.search(r"find_weixin\.py.*--check-version", content))
    assert not has_early_exit, (
        "start.bat 仍包含 find_weixin.py --check-version 早退块，"
        "需删除（preflight step 6.9 已处理版本守卫+自修）"
    )
```

- [ ] **Step 2: 在 mac（本机）运行测试，确认 5 个都 FAIL**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
python -m pytest services/agent/wechat-rpa/tests/test_preflight_oneclick.py -v 2>&1 | tail -20
```

期望：前 3 个测试 PASS 或 FAIL（mac 上 _is_windows()=False 所以 1/2/3 实际会拿到 warn——这是正常的；**测试 4 和 5 必须 FAIL** 因为 start.bat 还没改）。

> 注意：测试 1/2/3 在 mac 上 `_is_windows()=False`，`dry_run=False` 分支进不了 Windows 路径，实际会返回 `warn`——这在 mac 是预期行为。关键是测试 4/5（文本检查）在任何平台都应先 FAIL。

- [ ] **Step 3: commit-1（failing tests）**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
git add services/agent/wechat-rpa/tests/test_preflight_oneclick.py
git commit -m "test(wechat-rpa): [RED] 一键安装加固回归测试（讲述人失败明确报错/自启自动注册/版本守卫早退移除）"
```

---

### Task 2：修复 `preflight.py check_uia_narrator`（commit-2 第一部分）

**Files:**
- Modify: `services/agent/wechat-rpa/preflight.py` — `check_uia_narrator` 函数（行 638–684）

- [ ] **Step 1: 替换 `check_uia_narrator` 函数体**

找到现有函数（638 行附近）并替换为：

```python
def check_uia_narrator(dry_run: bool = False) -> Dict[str, str]:
    """7. UIA/讲述人激活：静默激活后能否读到主窗口。"""
    name = CHECK_NAMES[6]
    if dry_run or not _is_windows():
        return make_check(
            name, "warn", "dry-run/非 Windows 跳过讲述人激活（仅 Windows 真机有效）。"
        )

    # 检查 Narrator.exe 是否存在（LTSC/N/精简版 Windows 可能已移除）
    narrator_path = r"C:\Windows\System32\Narrator.exe"
    if not os.path.isfile(narrator_path):
        return make_check(
            name,
            "failed",
            "未找到 Narrator.exe（C:\\Windows\\System32\\Narrator.exe）。"
            "当前系统（LTSC/N 精简版/Ghost）已移除讲述人，无法激活 UIAutomation 控件树，"
            "微信 RPA 不可用。请使用完整版 Windows 10/11 家庭版/专业版。",
        )

    try:
        import subprocess

        subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Start-Process Narrator"],
            capture_output=True, timeout=15,
        )
        time.sleep(2)
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Stop-Process -Name Narrator -Force -ErrorAction SilentlyContinue"],
            capture_output=True, timeout=15,
        )
        time.sleep(1)
    except Exception as exc:  # noqa: BLE001
        return make_check(
            name,
            "failed",
            f"讲述人激活失败（{exc}）。无法激活 UIAutomation 控件树，微信 RPA 不可用。"
            "请确认：1) 非管理员身份运行 start.bat；"
            "2) 组策略未禁用讲述人（gpedit.msc 搜索 Narrator）；"
            "3) Windows 为完整版（非 LTSC/N 精简版）。",
        )

    # 激活后验证 UIA 树可读（登录态下才有主窗口；未登录属正常，不在此判失败）
    try:
        from find_weixin import get_main_window

        mw = get_main_window()
        if mw is not None:
            return make_check(name, "ok", "讲述人激活成功，UIAutomation 控件树可读（检测到微信主窗口）。")
        return make_check(
            name,
            "warn",
            "讲述人已激活，但暂未读到微信主窗口（可能未登录/微信未启动），"
            "登录后即可生效。",
        )
    except Exception as exc:  # noqa: BLE001
        return make_check(
            name, "warn", f"激活后读主窗口异常（{exc}）。请确认 pywinauto 与微信登录态。"
        )
```

- [ ] **Step 2: 运行既有 preflight 测试确保没有回归**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
python -m pytest services/agent/wechat-rpa/tests/test_preflight.py -v 2>&1 | tail -20
```

期望：全部 PASS（所有既有测试使用 dry_run=True 或测试纯函数，不受此改动影响）

---

### Task 3：修复 `start.bat`（commit-2 第二部分）

**Files:**
- Modify: `services/agent/install-pack/start.bat`

- [ ] **Step 1: 删除 Step 0.5 早退块（lines 20-35）**

找到以下内容并删除整个块：

```bat
REM Step 0.5: WeChat version guard — must be 4.1.8.x or lower (4.1.9+ broke UIA tree)
REM Blocking: wrong version = no agent start. Tells user to download 4.1.8 from COS.
if exist "%~dp0python-embedded\python.exe" if exist "%~dp0wechat-rpa\find_weixin.py" (
    "%~dp0python-embedded\python.exe" "%~dp0wechat-rpa\find_weixin.py" --check-version
    if errorlevel 1 (
        echo.
        echo  ============================================================
        echo   [ERROR] WeChat version not supported.
        echo   See the message above for the correct download URL.
        echo   Install WeChat 4.1.8, then re-run start.bat.
        echo  ============================================================
        echo.
        pause
        exit /b 1
    )
)
```

删除后在原位置留一行注释说明：

```bat
REM Step 0.5: WeChat version guard 已迁移进 preflight.py（step 6.9），由 preflight 自动检测+自修，此处不再早退。
```

- [ ] **Step 2: 在 step 6.9 preflight 通过后、step 6.95 单实例守卫之前，插入 step 6.92 自启注册**

找到以下内容（step 6.95 前）：

```bat
REM Step 6.95: Single-instance guard — kill any existing zenithjoy-agent.exe before starting
```

在其**前面**插入：

```bat
REM Step 6.92: 注册开机自启（幂等，每次都跑，确保任务计划条目存在）
REM install-autostart.ps1 用 RunLevel Limited + ONLOGON，不需要管理员。
if exist "%~dp0install-autostart.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" >nul 2>&1
    echo [autostart] 开机自启已注册（ZenithJoyAgent 任务计划）
) else (
    echo [autostart] install-autostart.ps1 不存在，跳过（旧版安装包）
)

```

- [ ] **Step 3: 运行 start.bat 相关的文本测试验证**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
python -m pytest services/agent/wechat-rpa/tests/test_preflight_oneclick.py::test_start_bat_contains_autostart_call services/agent/wechat-rpa/tests/test_preflight_oneclick.py::test_start_bat_no_early_version_exit -v 2>&1
```

期望：2 个测试 PASS

---

### Task 4：修复 `find_weixin.py` DOWNGRADE_URL（commit-2 第三部分）

**Files:**
- Modify: `services/agent/wechat-rpa/find_weixin.py` — DOWNGRADE_URL 常量（行 29-32）

- [ ] **Step 1: 修复 DOWNGRADE_URL**

找到：

```python
DOWNGRADE_URL = (
    "https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com"
    "/install-pack/WeChatWin_4.1.8.exe"
)
```

替换为：

```python
DOWNGRADE_URL = (
    "https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com"
    "/install-pack/wechat/WeChatWin_4.1.8.exe"
)
```

- [ ] **Step 2: 验证版本守卫单测通过**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
python -m pytest services/agent/wechat-rpa/tests/test_version_guard.py -v 2>&1 | tail -15
```

期望：全部 PASS

---

### Task 5：全量测试 + rsync build-modules + commit-2

**Files:**
- Sync: `services/agent/build-modules/line04/wechat-rpa/` ← `services/agent/wechat-rpa/`

- [ ] **Step 1: 跑全量 wechat-rpa 测试**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
python -m pytest services/agent/wechat-rpa/tests/ -v --tb=short 2>&1 | tail -30
```

期望：全部 PASS（包括新的 `test_preflight_oneclick.py` 5 个测试）

> 如有 FAIL，先修代码，再重跑，确认全绿后才继续。

- [ ] **Step 2: rsync 同步到 build-modules（固化纪律）**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
rsync -av --exclude='__pycache__' --exclude='*.pyc' \
    services/agent/wechat-rpa/ \
    services/agent/build-modules/line04/wechat-rpa/
```

期望输出：列出同步的文件（preflight.py / find_weixin.py / tests/test_preflight_oneclick.py 等）

- [ ] **Step 3: 验证 build-modules 与源目录一致**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
diff -r \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    services/agent/wechat-rpa/ \
    services/agent/build-modules/line04/wechat-rpa/ \
    && echo "✅ build-modules in sync" || echo "❌ build-modules diverged"
```

期望：`✅ build-modules in sync`

- [ ] **Step 4: commit-2（所有修复 + build-modules 同步）**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
git add \
    services/agent/wechat-rpa/preflight.py \
    services/agent/wechat-rpa/find_weixin.py \
    services/agent/install-pack/start.bat \
    services/agent/build-modules/line04/wechat-rpa/preflight.py \
    services/agent/build-modules/line04/wechat-rpa/find_weixin.py \
    services/agent/build-modules/line04/wechat-rpa/tests/test_preflight_oneclick.py \
    docs/superpowers/specs/2026-06-11-agent-oneclick-install-hardening-design.md \
    docs/superpowers/plans/2026-06-11-agent-oneclick-install-hardening.md
git commit -m "fix(agent): 一键安装加固 — 讲述人失败明确报错/preflight自修版本/自启自动注册/DOWNGRADE_URL补路径"
```

---

### Task 6：push + PR

- [ ] **Step 1: push 分支**

```bash
cd /Users/administrator/perfect21/zenithjoy-06112155-hardening
git push -u origin cp-06112155-agent-oneclick-hardening
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "fix(agent): 一键安装加固 — 讲述人/版本自修/自启/URL修复 (#754 候选)" \
  --body "$(cat <<'EOF'
## 本 PR 把 Path 4 的 Step 1（一键安装）推进：讲述人失败从静默全挂 → 明确报错

### 修复的 4 个根因
1. **start.bat Step 0.5 早退** — 删除早退块，preflight step 6.9 自修版本（已有 auto-install/downgrade）
2. **check_uia_narrator 返回 warn** — Narrator.exe 不存在或 subprocess 失败 → `failed`，不再静默继续
3. **开机自启需手动注册** — preflight 通过后自动调 `install-autostart.ps1`（幂等）
4. **DOWNGRADE_URL 缺 /wechat/ 子目录** — 修复错误信息 URL 与实际下载 URL 不一致

### 测试
- 新增 `test_preflight_oneclick.py` 5 个回归测试（TDD commit-1/commit-2 顺序）
- 全量 `wechat-rpa/tests/` 绿色通过
- build-modules/line04 已 rsync 同步

### 验收（真机待 xian-pc/rog 验证）
- 微信缺失/版本错 → 自动下载+静默装+锁版本+复检
- Narrator 不可用（LTSC/组策略）→ 明确报错 `failed` 并退出，不静默全挂
- start.bat 跑完已注册开机自启（schtasks 可查 ZenithJoyAgent）
- 体检报告正确打印（preflight 已有此功能）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 等待 CI 完成**

```bash
gh pr checks --watch
```

期望：所有 check 绿色（含 `ci-l4-runtime` build-modules in-sync 检查）

---

## 自检（Self-Review）

**Spec 覆盖：**
- ✅ 根因 1（Step 0.5 早退）→ Task 3 Step 1
- ✅ 根因 2（Narrator warn→failed）→ Task 2
- ✅ 根因 3（autostart 未调用）→ Task 3 Step 2
- ✅ 根因 4（DOWNGRADE_URL）→ Task 4
- ✅ TDD commit 顺序 → Task 1（commit-1 failing）+ Task 5 Step 4（commit-2 fix）
- ✅ rsync build-modules → Task 5 Step 2-3
- ✅ CI/push/PR → Task 6

**Placeholder 扫描：** 无 TBD / TODO / 缺代码块 ✅

**类型一致性：** `check_uia_narrator`、`_is_windows`、`make_check`、`NARRATOR_PATH` 在测试和实现中命名一致 ✅
