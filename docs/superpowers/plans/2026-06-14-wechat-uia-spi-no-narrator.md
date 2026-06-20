# 微信 RPA SPI 替代讲述人 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把微信 4.0 UIA 激活从"启动 Windows 讲述人"换成"ctypes 设 SPI_SETSCREENREADER 系统标志"，消除讲述人满屏框+朗读声。

**Architecture:** 只换 `_activate_uia()` / `check_uia_narrator()` 的实现体（函数名、调用点、注册键 `uia_narrator` 不变），文案去"讲述人"。源改动 1:1 镜像到 build-modules/line04，bump line04 module 1.0.28→1.0.29 并重打包。仅对微信 4.1.8.x 有效（版本守卫不动）。

**Tech Stack:** Python 3.11 embedded, ctypes(user32.SystemParametersInfoW), pywinauto, unittest/pytest。所有改动需双树同步（CI module-version-sync 回归）。

工作目录：`/Users/administrator/perfect21/zenithjoy/.claude/worktrees/cp-06141107-wechat-uia-spi-no-narrator`（所有命令从此根目录跑）。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `services/agent/wechat-rpa/listen_chat.py` | 监听循环 + `_activate_uia` | 改函数体 |
| `services/agent/wechat-rpa/preflight.py` | 开机自检第7项 `check_uia_narrator` | 改函数体+文案，删 Narrator.exe 硬检查 |
| `services/agent/wechat-rpa/send_chat.py` | 发送 + 错误 detail | 改 1 处文案 |
| `services/agent/wechat-rpa/tests/test_spi_activation.py` | 新回归测试 | 新建 |
| `services/agent/wechat-rpa/tests/test_preflight_oneclick.py` | 旧 Narrator 回归测试 | 改写为 SPI 行为 |
| `services/agent/build-modules/line04/wechat-rpa/*` | 构建副本 | 镜像上述 4 个源文件 |
| `services/agent/modules/line04/manifest.json` | 版本 | 1.0.28→1.0.29 |
| dist-modules tarball | 分发包 | 重打包 |

---

### Task 1: listen_chat._activate_uia 改用 SPI 标志

**Files:**
- Create: `services/agent/wechat-rpa/tests/test_spi_activation.py`
- Modify: `services/agent/wechat-rpa/listen_chat.py:1040-1075`

- [ ] **Step 1: 写 failing test**

```python
# services/agent/wechat-rpa/tests/test_spi_activation.py
"""回归：_activate_uia 必须用 SPI_SETSCREENREADER 系统标志激活 UIA，
绝不启动 Windows 讲述人 Narrator.exe（满屏框+朗读声根源）。"""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

WECHAT_RPA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _import_listen_chat():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls",
                 "requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod
    if "listen_chat" in sys.modules:
        del sys.modules["listen_chat"]
    import listen_chat as lc
    return lc


class TestSpiActivation(unittest.TestCase):
    def setUp(self):
        self.lc = _import_listen_chat()

    def test_activate_uia_sets_screenreader_flag(self):
        fake_windll = MagicMock()
        with patch("ctypes.windll", fake_windll, create=True), \
             patch.object(self.lc, "_log"):
            self.lc._activate_uia()
        fake_windll.user32.SystemParametersInfoW.assert_called_once()
        args = fake_windll.user32.SystemParametersInfoW.call_args.args
        self.assertEqual(args[0], 0x0047, "首参必须是 SPI_SETSCREENREADER")
        self.assertIs(args[1], True, "第二参必须 True（开启屏幕阅读器模式）")

    def test_activate_uia_never_launches_narrator(self):
        fake_windll = MagicMock()
        with patch("ctypes.windll", fake_windll, create=True), \
             patch.object(self.lc, "subprocess") as fake_sub, \
             patch.object(self.lc, "_log"):
            self.lc._activate_uia()
        for call in fake_sub.run.call_args_list:
            joined = " ".join(str(a) for a in call.args) + str(call.kwargs)
            self.assertNotIn("Narrator", joined, "绝不允许启动讲述人")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_spi_activation.py -v`
Expected: FAIL（旧实现调 Start-Process Narrator，test_activate_uia_never_launches_narrator 断言失败 / SystemParametersInfoW 未被调）

- [ ] **Step 3: 改 listen_chat.py 的 `_activate_uia` 函数体**

把 `services/agent/wechat-rpa/listen_chat.py` 第 1040-1075 行整个函数替换为：

```python
def _activate_uia() -> None:
    """设置系统屏幕阅读器标志，激活微信 4.0 的 UIAutomation provider（替代讲述人）。

    微信 4.0 把 UI 自绘在 MMUIRenderSubWindowHW 上，只有"屏幕阅读器模式"被打开后才暴露
    mmui::MainWindow 那棵可读控件树。旧实现靠启动 Windows 讲述人来打开这个开关，但讲述人
    会在屏幕上画满跟随焦点的高亮框 + 朗读声，严重干扰客户机使用。

    新实现直接用 ctypes 调 SystemParametersInfo 设 SPI_SETSCREENREADER 标志——这才是讲述人
    背后真正打开"屏幕阅读器模式"的系统开关。纯系统调用，无窗口/无框/无声；标志在进程退出后
    持久保持，也不会反向招起讲述人。已在 xian-pc 真机验证：不开讲述人即读到 mmui::MainWindow
    + 92 控件。仅对微信 4.1.8.x 有效（4.1.10+ 控件树被腾讯移除，讲述人和本标志都救不了）。
    """
    try:
        import ctypes

        SPI_SETSCREENREADER = 0x0047
        SPIF_SENDCHANGE = 0x0002
        ctypes.windll.user32.SystemParametersInfoW(
            SPI_SETSCREENREADER, True, None, SPIF_SENDCHANGE
        )
        _log("UIA 激活（屏幕阅读器系统标志已设，无需讲述人）完成")
    except Exception as exc:
        _log(f"UIA 激活失败: {exc}")
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_spi_activation.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 跑全量 wechat-rpa 测试，确认没回归**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/ -q`
Expected: 仅 test_preflight_oneclick.py 可能红（Task 2 处理），其余绿

- [ ] **Step 6: commit**

```bash
git add services/agent/wechat-rpa/tests/test_spi_activation.py services/agent/wechat-rpa/listen_chat.py
git commit -m "fix(wechat-cs): _activate_uia 改用 SPI_SETSCREENREADER 标志替代讲述人"
```

---

### Task 2: preflight.check_uia_narrator 改 SPI + 更新旧回归测试

**Files:**
- Modify: `services/agent/wechat-rpa/preflight.py:653-704`
- Modify: `services/agent/wechat-rpa/tests/test_preflight_oneclick.py`

- [ ] **Step 1: 改写 test_preflight_oneclick.py 三个 Narrator 测试为 SPI 行为（failing first）**

把 `test_preflight_oneclick.py` 里针对 check_uia_narrator 的 3 个测试改为：

```python
# 测试 1：非 Windows / dry_run → warn（短路）
def test_uia_dry_run_warn():
    result = check_uia_narrator(dry_run=True)
    assert result["status"] == "warn"

# 测试 2：设 SPI 标志成功但微信未登录（无主窗口）→ warn，且文案不含"讲述人"
def test_uia_spi_no_window_warn(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    fake_windll = MagicMock()
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: None, raising=False)
    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "warn"
    assert "讲述人" not in result["detail"]

# 测试 3：设 SPI 标志 + 读到主窗口 → ok
def test_uia_spi_ok(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    fake_windll = MagicMock()
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "ok"
    fake_windll.user32.SystemParametersInfoW.assert_called_once()
```

> 注：删掉原"Narrator.exe 不存在→failed""subprocess Narrator 抛异常→failed"两个旧测试。文件顶部确保 `import preflight`、`from preflight import check_uia_narrator`、`from unittest.mock import MagicMock` 都在；preflight 顶部若未 `import ctypes` 需在实现里加。

- [ ] **Step 2: 跑确认失败**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_preflight_oneclick.py -v`
Expected: FAIL（旧实现还在起 Narrator / 还有 Narrator.exe 检查）

- [ ] **Step 3: 改 preflight.py 的 check_uia_narrator（653-704）**

确保文件顶部有 `import ctypes`（没有则加）。把函数替换为：

```python
def check_uia_narrator(dry_run: bool = False) -> Dict[str, str]:
    """7. UIA 激活：设系统屏幕阅读器标志后能否读到微信主窗口（替代讲述人）。"""
    name = CHECK_NAMES[6]
    if dry_run or not _is_windows():
        return make_check(
            name, "warn", "dry-run/非 Windows 跳过 UIA 激活（仅 Windows 真机有效）。"
        )

    try:
        SPI_SETSCREENREADER = 0x0047
        SPIF_SENDCHANGE = 0x0002
        ctypes.windll.user32.SystemParametersInfoW(
            SPI_SETSCREENREADER, True, None, SPIF_SENDCHANGE
        )
        time.sleep(1)
    except Exception as exc:  # noqa: BLE001
        return make_check(
            name,
            "failed",
            f"屏幕阅读器标志设置失败（{exc}）。无法激活 UIAutomation 控件树，微信 RPA 不可用。"
            "请确认 Windows 为完整版且未被组策略限制无障碍 API。",
        )

    try:
        from find_weixin import get_main_window

        mw = get_main_window()
        if mw is not None:
            return make_check(
                name, "ok",
                "屏幕阅读器模式已开（无需讲述人），UIAutomation 控件树可读（检测到微信主窗口）。",
            )
        return make_check(
            name, "warn",
            "屏幕阅读器标志已设，但暂未读到微信主窗口（可能未登录/微信未启动），登录后即可生效。",
        )
    except Exception as exc:  # noqa: BLE001
        return make_check(
            name, "warn", f"激活后读主窗口异常（{exc}）。请确认 pywinauto 与微信登录态。"
        )
```

- [ ] **Step 4: 跑确认通过**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_preflight_oneclick.py tests/test_preflight.py -v`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add services/agent/wechat-rpa/preflight.py services/agent/wechat-rpa/tests/test_preflight_oneclick.py
git commit -m "fix(wechat-cs): preflight 第7项自检改 SPI 标志，删 Narrator.exe 硬依赖"
```

---

### Task 3: send_chat.py 文案去讲述人

**Files:**
- Modify: `services/agent/wechat-rpa/send_chat.py:~108`

- [ ] **Step 1: 改文案**

把 `send_chat.py` 中 `"未找到 mmui::MainWindow（微信未登录或讲述人解锁失效）"` 改为
`"未找到 mmui::MainWindow（微信未登录或 UIA 屏幕阅读器标志失效）"`。

- [ ] **Step 2: grep 确认 wechat-rpa 源里不再启动讲述人**

Run: `grep -rn "Start-Process Narrator" services/agent/wechat-rpa/`
Expected: 无输出（exit 1）

- [ ] **Step 3: commit**

```bash
git add services/agent/wechat-rpa/send_chat.py
git commit -m "fix(wechat-cs): send_chat 错误文案去讲述人，改 UIA 标志措辞"
```

---

### Task 4: 镜像到 build-modules/line04 + bump 版本 + 重打包

**Files:**
- Modify: `services/agent/build-modules/line04/wechat-rpa/{listen_chat.py,preflight.py,send_chat.py}` 及 `tests/{test_spi_activation.py,test_preflight_oneclick.py}`
- Modify: `services/agent/modules/line04/manifest.json:3`
- Modify: `services/agent/build-modules/line04/manifest.json`
- Rebuild: dist-modules line04 tarball

- [ ] **Step 1: 把 4 个源文件 1:1 复制到 build 副本**

```bash
cp services/agent/wechat-rpa/listen_chat.py services/agent/build-modules/line04/wechat-rpa/listen_chat.py
cp services/agent/wechat-rpa/preflight.py services/agent/build-modules/line04/wechat-rpa/preflight.py
cp services/agent/wechat-rpa/send_chat.py services/agent/build-modules/line04/wechat-rpa/send_chat.py
cp services/agent/wechat-rpa/tests/test_spi_activation.py services/agent/build-modules/line04/wechat-rpa/tests/test_spi_activation.py
cp services/agent/wechat-rpa/tests/test_preflight_oneclick.py services/agent/build-modules/line04/wechat-rpa/tests/test_preflight_oneclick.py
```

- [ ] **Step 2: bump 版本 1.0.28 → 1.0.29**

改 `services/agent/modules/line04/manifest.json` 的 `"version": "1.0.28"` → `"1.0.29"`。
改 `services/agent/build-modules/line04/manifest.json` 的 version 同步为 `"1.0.29"`。

- [ ] **Step 3: 同步 required_version 断言（若存在硬编码版本号）**

Run: `grep -rn "1\.0\.28" services/agent/src services/agent/modules apps/api/tests .github/workflows/scripts/smoke 2>/dev/null | grep -v node_modules`
对命中的 heartbeat required_version / smoke 断言 / 测试断言，把 1.0.28 改 1.0.29（仅限确实表示 line04 当前要求版本的位置；不确定的保持不动并在 commit message 注明）。

- [ ] **Step 4: 重打包 dist tarball**

Run: `bash services/agent/scripts/build-line-module.sh line04` （若脚本参数不同，先 `bash services/agent/scripts/build-line-module.sh --help` 或读脚本头部用法）
Expected: 生成/更新 `services/agent/dist-modules/line04-v1.0.29.tar.gz`（或脚本约定的输出路径）

- [ ] **Step 5: 跑 build 副本测试确认同步无误**

Run: `cd services/agent/build-modules/line04/wechat-rpa && python -m pytest tests/test_spi_activation.py tests/test_preflight_oneclick.py -q`
Expected: PASS

- [ ] **Step 6: commit**

```bash
git add services/agent/build-modules/line04 services/agent/modules/line04/manifest.json services/agent/dist-modules
git commit -m "build(line04): 同步 SPI 改动到 build-modules + bump v1.0.29 重打包"
```

---

### Task 5: 全量校验 + module-version-sync 回归

**Files:** 无（验证）

- [ ] **Step 1: 跑 wechat-rpa 全量测试**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/ -q`
Expected: all PASS

- [ ] **Step 2: 跑 agent TS 侧版本同步回归（若本地可跑）**

Run: `cd services/agent && npm test --silent 2>&1 | tail -20` 或针对性
`cd apps/api && npx vitest run tests/regression/module-version-sync.test.ts 2>&1 | tail -20`
Expected: PASS（双树 + manifest 版本一致）。失败则按报错补齐遗漏的同步点。

- [ ] **Step 3: 终检 grep 全仓源码无残留讲述人启动**

Run: `grep -rn "Start-Process Narrator" services/agent/wechat-rpa services/agent/build-modules/line04 ; echo done`
Expected: 仅 "done"，无 Narrator 命中

- [ ] **Step 4: 若有未提交变更则 commit**

```bash
git add -A && git commit -m "test(wechat-cs): SPI 改动全量校验 + 版本同步对齐" || echo "无新增变更"
```

---

## 部署后验收（CI 外，人工/脚本）
- xian-pc（微信 4.1.8.107）部署 v1.0.29 → `Stop-Process Narrator` 杀掉讲述人 → 跑监听 → 确认仍读到 mmui::MainWindow 控件树、屏幕零框零声。

## 自审记录
- 覆盖 spec 全部 5 节：Task1=§改动1, Task2=§改动2+测试, Task3=§改动3, Task1新建=§改动4, Task4=§改动5双树+版本+打包, Task5=测试策略/module-version-sync。
- 无 TBD/占位；签名一致（_activate_uia / check_uia_narrator / SystemParametersInfoW / SPI_SETSCREENREADER=0x47）。
- 旧 test_preflight_oneclick 的 Narrator 断言会因本改动失效 → Task2 显式改写（已识别）。
