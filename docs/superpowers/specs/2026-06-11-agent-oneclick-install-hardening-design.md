# Agent 一键安装加固设计文档

**日期**: 2026-06-11  
**Journey**: 客户私域 AI 接管（Line 04, Brain id `bfeed805`）  
**Sprint**: `06112155-agent-oneclick-install-hardening`  
**类型**: Bug Fix / 加固（路径 A）

---

## 问题陈述

客户在自己电脑双击 `start.bat` 经常整个失败，且静默无提示。已知真实案例：
"讲述人(Narrator)都启动不起来，整个就失败了"。

## 根因分析（4 项）

### 根因 1：`start.bat` Step 0.5 早退阻断 preflight 自修
`start.bat` 在 step 0.5 调 `find_weixin.py --check-version`，版本不对直接 `exit /b 1`，告知用户手动装微信。但 `preflight.py`（step 6.9）已有完整自动安装/降级逻辑。早退把自修阻断了。

### 根因 2：`check_uia_narrator` 返回 `warn` 不阻断启动
`preflight.py` 的 `check_uia_narrator` 在两种情况下返回 `warn`（不是 `failed`）：
- Narrator.exe 不存在（LTSC/N 精简版/Ghost Windows）
- subprocess 启动 Narrator 抛异常

`warn` 不触发 `compute_exit_code` 返回 1，agent 照常启动 → UIA 树未暴露 → daemon 读不到消息 → 静默全挂。

### 根因 3：`install-autostart.ps1` 未从 `start.bat` 调用
脚本已写好、逻辑正确，但 `start.bat` 没有调用它，需用户手动执行额外步骤。

### 根因 4：`find_weixin.py` DOWNGRADE_URL 缺 `/wechat/` 子目录
只影响错误提示信息中的 URL，与 `preflight.py` 的实际下载 URL 不一致。

---

## 修复设计

### 修复 1：删除 `start.bat` step 0.5 早退
删除 lines 20-35（`WeChat version guard` 整个块）。preflight step 6.9 完全覆盖该功能且有自修能力。

### 修复 2：`preflight.py check_uia_narrator` 升级 `warn` → `failed`

精确边界：
- `dry_run=True` 或 `not _is_windows()` → 保持 `warn`（CI / mac 不阻断）
- Windows 真机：
  - `C:\Windows\System32\Narrator.exe` 不存在 → `failed` + 明确提示"LTSC/N 精简版已移除讲述人"
  - subprocess 启动抛异常 → `failed` + 修复指引（非管理员/组策略/完整版 Windows）
  - 激活成功但无主窗口 → `warn`（兼容"微信未登录"场景）

### 修复 3：`start.bat` 末尾注册自启
在 preflight 通过后（step 6.95 单实例守卫之前）插入：

```bat
REM Step 6.92: 注册开机自启（幂等，每次都跑确保任务计划条目存在）
if exist "%~dp0install-autostart.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" >nul 2>&1
    echo [autostart] 开机自启已注册（ZenithJoyAgent 任务计划）
)
```

### 修复 4：`find_weixin.py` DOWNGRADE_URL 补 `/wechat/`

```python
DOWNGRADE_URL = (
    "https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com"
    "/install-pack/wechat/WeChatWin_4.1.8.exe"
)
```

---

## 测试策略（TDD，commit 顺序强制）

### commit-1（failing tests）
新文件：`services/agent/wechat-rpa/tests/test_preflight_oneclick.py`

| 测试名 | 断言 |
|--------|------|
| `test_narrator_exe_missing_returns_failed` | mock `os.path.isfile` 对 Narrator.exe 路径返回 False，调 `check_uia_narrator(dry_run=False)` 在 Windows 模拟路径下 → status=`failed` |
| `test_narrator_subprocess_exception_returns_failed` | Narrator.exe 存在 + mock subprocess 抛 `RuntimeError` → status=`failed` |
| `test_narrator_subprocess_ok_no_window_returns_warn` | subprocess 成功 + mock `get_main_window` 返回 None → status=`warn` |
| `test_start_bat_contains_autostart_call` | 读 `install-pack/start.bat` 文本，断言含 `install-autostart.ps1` |
| `test_start_bat_no_early_version_exit` | 读 `start.bat` 文本，断言不含 `WeChat version guard` 早退块（`find_weixin.py --check-version` + `exit /b 1` 同行或相邻） |

### commit-2（implementation）
- `preflight.py` → 修复 `check_uia_narrator`
- `start.bat` → 删 step 0.5，加 step 6.92
- `find_weixin.py` → DOWNGRADE_URL
- `rsync -av --exclude='__pycache__' --exclude='*.pyc' services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/`

---

## 不包含

- 讲述人备用激活路径（另立 R&D sprint）
- SOP 文档更新（随 PR 附带，不影响测试）
- 多租户、转人工、云端 Plan B（另立 sprint）
