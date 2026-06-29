#!/usr/bin/env python3
"""
preflight.py — Agent 开机环境自检 + 自愈层（Path 4 微信 RPA 前置体检）。

面对千万台杂乱客户机，agent 启动时先跑这套"体检"：逐项 **检测 → 能修的自动修 →
修不了的给明确提示**，最后产出报告（打印 + 写本地 JSON + best-effort 上报中台，
让运营在 Dashboard 远程看，不用 SSH 进客户机）。

8 个检测项（7 项主序 + elevation 追加在末尾；每项 detect → fix → 修不了 prompt）：
  1. OS/交互会话    —— 是 Windows + 有活动桌面会话（不可自愈）
  2. 微信安装        —— Weixin.exe 在不在；不在 → 下载 4.1.8 静默装
  3. 微信版本        —— 锁 4.1.8.x：< 4.1.8 或 >= 4.1.9（含 4.1.10+）→ 卸载 + 装 4.1.8；仅 4.1.8.x → ok
  4. 微信登录态      —— 未登录 → 拉起微信 + 提示扫码
  5. Python+pywinauto—— import 测试；失败 → 提示重装 agent
  6. UIA 激活        —— 设屏幕阅读器标志后能否读到主窗口
  7. 中台连通        —— GET <middleware>/health；不通 → 提示查网络
  （锁更新 check_lock_update 已删——实测锁不住且 4.1.10 UIA 客服照样能发，2026-06-24）

跨平台纪律：pywinauto / windll / subprocess 真实自愈动作全在 **函数体内** import +
try/except 包裹；**顶层 import 在 mac/linux 也能成功**（供 CI 单测）。mac 上 windll
不可用 → 优雅降级为 warn/failed，绝不崩。自愈动作全部幂等、可重复跑。

CLI：
  python preflight.py [--middleware-url URL] [--dry-run]
  --dry-run：只检测不自愈、不下载、不卸载（给 CI / mac 跑）。
  退出码：全 ok 或仅 warn → 0；有 failed → 非0（start.bat 可自行决定是否仍继续）。
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Windows GBK 控制台无法编码 emoji（✅ ⚠️ ❌），强制 UTF-8 输出避免 UnicodeEncodeError 崩溃
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

# find_weixin 顶层零 pywinauto/windll import，安全复用其纯函数与寻址 API。
from find_weixin import (  # noqa: E402
    MIN_BLOCKED_VERSION,
    MIN_REQUIRED_VERSION,
    WEIXIN_EXE_DEFAULT,
    _parse_version,
    get_weixin_version,
)

# ─── 常量 ────────────────────────────────────────────────────────────────────

# 微信 4.1.8 安装包下载源（按序尝试：先我们 COS 加速，再官方回退）。
WECHAT_DOWNLOAD_URLS = (
    "https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe",
    "https://dldir1v6.qq.com/weixin/Universal/Windows/WeChatWin_4.1.8.exe",
)

# 微信 4.x 官方安装根目录（版本号子目录名会变，自愈时用递归搜文件）。
WEIXIN_INSTALL_ROOT = r"C:\Program Files\Tencent\Weixin"

# 下载体积下限：正常 4.1.8 安装包 >100MB，低于此视为下载残缺。
MIN_DOWNLOAD_SIZE = 100 * 1024 * 1024

# 本地报告落盘路径（运营 SSH 直接读；与 listen_chat 的 zj-*.log 同目录习惯）。
PUBLIC_DIR = os.environ.get("PUBLIC", r"C:\Users\Public")
PREFLIGHT_JSON_PATH = os.path.join(PUBLIC_DIR, "zj-preflight.json")

# 下载到的安装包临时落点。
_INSTALLER_TMP = os.path.join(PUBLIC_DIR, "WeChatWin_4.1.8.exe")

# 状态 → 人类可读图标。
_STATUS_ICON = {"ok": "✅", "fixed": "🔧", "warn": "⚠️", "failed": "❌"}

# 检测项的稳定名称（报告/看板按此对齐）。
# 注意：elevation 追加在末尾（保证既有按下标引用的检测项不串位），
# 但在 run_all_checks 的执行序列里排在 os_session 之后靠前（它影响后面 UIA/登录项成败）。
# 2026-06-24：lock_update（锁微信 4.1.8 + 禁自动更新四层锁）已整套删除——实测锁不住
# （客户机重启微信自动升 4.1.10），且 4.1.10 UIA 客服照样能发，锁既无效又无必要。共 8 项。
CHECK_NAMES = (
    "os_session",
    "wechat_installed",
    "wechat_version",
    "wechat_login",
    "python_pywinauto",
    "uia_narrator",
    "middleware_health",
    "elevation",
)


# ─── 纯逻辑函数（CI 单测锚点，顶层零 Windows 依赖）──────────────────────────────


def decide_wechat_action(version_tuple: Optional[Tuple[int, ...]]) -> str:
    """
    依据微信版本元组决定该执行的动作（纯函数，mac 可单测）。

    2026-06-29 锁死 4.1.8.x（与 find_weixin._parse_and_check 守卫一致，反转 6-24 的放开上界）：
    - None（读不到 / 未安装）→ 'install'（装 4.1.8）
    - 3.x（< 4.0.0）        → 'install'（无 mmui::MainWindow，按未安装处理装 4.1.8）
    - 4.0.0 ~ 4.1.7.x      → 'downgrade'（低于基线，控件配方不一致，卸载后装 4.1.8）
    - 仅 4.1.8.x           → 'ok'（已全适配+验证）
    - >= 4.1.9（含 4.1.10+）→ 'downgrade'（控件适配未做，卸载后装 4.1.8——与 <4.1.8 一致处理，
      自动把机器拉回 4.1.8.x；不是 UIA 被封，是适配工作量没做）
    """
    if version_tuple is None:
        return "install"
    head = tuple(version_tuple[:3])
    head = head + (0,) * (3 - len(head))
    # 四档分界（MIN_REQUIRED_VERSION=(4,1,8) / MIN_BLOCKED_VERSION=(4,1,9) 从 find_weixin 导入）：
    #   3.x（< 4.0.0）          → install   （无 mmui::MainWindow，按未安装处理）
    #   [4.0.0, 4.1.8)          → downgrade （低于基线，卸载重装 4.1.8）
    #   4.1.8.x                 → ok         （已全适配+验证）
    #   >= 4.1.9（含 4.1.10+）  → downgrade （新版适配未做，卸载重装 4.1.8，锁回基线）
    if head < (4, 0, 0):
        return "install"
    if head < MIN_REQUIRED_VERSION:
        return "downgrade"
    if head >= MIN_BLOCKED_VERSION:
        return "downgrade"
    return "ok"


def classify_elevation(is_admin: bool) -> Tuple[str, str]:
    """
    依据"当前进程是否提权/管理员"判定 elevation 检测的 (status, detail)（纯函数，mac 可单测）。

    - is_admin=True  → ('warn', 提示改用普通用户身份)：提权进程设屏幕阅读器标志/激活 UIA 会被
      系统 UIPI 权限隔离挡掉（Access denied）→ UIA 没真激活 → 微信登录后仍识别不到窗口。
      用 warn 不用 failed：极少数配置仍可用，但必须醒目提示。
    - is_admin=False → ('ok', 普通用户身份)：UIA 可正常激活。
    """
    if is_admin:
        return (
            "warn",
            "检测到以管理员/提权身份运行 → 屏幕阅读器标志/UIA 激活会被系统挡(Access denied) → "
            "微信登录后仍识别不到。请改用 **普通用户身份** 双击 start.bat 运行"
            "（不要右键'以管理员身份运行'）。",
        )
    return ("ok", "普通用户身份运行，UIA 可正常激活。")


def make_check(name: str, status: str, detail: str) -> Dict[str, str]:
    """构造单项检测结果。status ∈ {ok,fixed,warn,failed}。"""
    if status not in _STATUS_ICON:
        raise ValueError(f"非法 status: {status!r}")
    return {"name": name, "status": status, "detail": detail}


def compute_all_ok(checks: List[Dict[str, Any]]) -> bool:
    """全部检测都是 ok 或 fixed（无 warn、无 failed）才算 all_ok。"""
    return all(c.get("status") in ("ok", "fixed") for c in checks)


def has_failed(checks: List[Dict[str, Any]]) -> bool:
    """是否存在 failed 项（决定退出码：有 failed → 非0）。"""
    return any(c.get("status") == "failed" for c in checks)


def status_counts(checks: List[Dict[str, Any]]) -> Dict[str, int]:
    """按 status 归类计数（ok/fixed/warn/failed）。"""
    counts = {k: 0 for k in _STATUS_ICON}
    for c in checks:
        st = c.get("status")
        if st in counts:
            counts[st] += 1
    return counts


def build_report(checks: List[Dict[str, Any]], ts: Optional[int] = None) -> Dict[str, Any]:
    """把多项检测汇总成最终报告 dict。"""
    if ts is None:
        ts = int(time.time() * 1000)
    return {
        "ts": ts,
        "all_ok": compute_all_ok(checks),
        "counts": status_counts(checks),
        "checks": checks,
    }


def compute_exit_code(checks: List[Dict[str, Any]]) -> int:
    """退出码：有 failed → 1，否则（全 ok 或仅含 warn/fixed）→ 0。"""
    return 1 if has_failed(checks) else 0


# ─── 通用工具（Windows-only 动作放函数体内，try/except 包裹）──────────────────


def _is_windows() -> bool:
    return platform.system() == "Windows"


def _windll_available() -> bool:
    try:
        import ctypes

        return hasattr(ctypes, "windll")
    except Exception:
        return False


def _find_file(root: str, filename: str) -> Optional[str]:
    """在 root 下递归找第一个名为 filename 的文件。找不到返回 None。"""
    try:
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower() == filename.lower():
                    return os.path.join(dirpath, f)
    except Exception:
        return None
    return None


def _find_files(root: str, filename: str) -> List[str]:
    """在 root 下递归找所有名为 filename 的文件路径。"""
    out: List[str] = []
    try:
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower() == filename.lower():
                    out.append(os.path.join(dirpath, f))
    except Exception:
        pass
    return out


def _weixin_installed() -> bool:
    """Weixin.exe 是否存在（固定路径 + 安装根目录递归兜底）。"""
    if os.path.isfile(WEIXIN_EXE_DEFAULT):
        return True
    return _find_file(WEIXIN_INSTALL_ROOT, "Weixin.exe") is not None


def download_wechat_installer(
    dest_path: str = _INSTALLER_TMP,
    urls: Tuple[str, ...] = WECHAT_DOWNLOAD_URLS,
    min_size: int = MIN_DOWNLOAD_SIZE,
) -> Optional[str]:
    """
    按序从 urls 下载 4.1.8 安装包到 dest_path，校验体积 > min_size。
    成功返回 dest_path，全部失败返回 None。仅在真实自愈时调用（dry-run 不调）。
    """
    import urllib.request

    for url in urls:
        try:
            urllib.request.urlretrieve(url, dest_path)
            if os.path.isfile(dest_path) and os.path.getsize(dest_path) >= min_size:
                return dest_path
        except Exception:
            continue
    return None


def _run_silent(cmd: List[str], timeout: int = 600) -> Tuple[bool, str]:
    """跑外部命令（不需提权的命令）。返回 (成功, 说明)。异常吞掉。"""
    import subprocess

    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        ok = proc.returncode == 0
        return ok, f"returncode={proc.returncode}"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


def _run_elevated(cmd: List[str], timeout: int = 600) -> Tuple[bool, str]:
    """用 PowerShell Start-Process -Verb RunAs -Wait 触发 UAC 弹窗提权运行命令。

    agent 进程本身保持普通用户身份（UIA 可正常激活），只有被调用的命令提权。
    直接 subprocess.run([installer, '/S']) 在普通用户下报 WinError 740；
    且叫用户"以管理员身份运行 start.bat"会破坏 UIA（UIPI 隔离 → Access denied）。
    """
    import subprocess
    import shlex

    exe = cmd[0]
    args_str = " ".join(f"'{a}'" for a in cmd[1:]) if len(cmd) > 1 else ""
    ps_cmd = (
        f"Start-Process -FilePath '{exe}' "
        + (f"-ArgumentList {args_str} " if args_str else "")
        + "-Verb RunAs -Wait"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            capture_output=True,
            timeout=timeout,
        )
        ok = proc.returncode == 0
        return ok, f"returncode={proc.returncode}"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


# ─── 8 项检测（每项：detect → fix → 修不了 prompt）─────────────────────────────


def check_os_session(dry_run: bool = False) -> Dict[str, str]:
    """1. OS/交互会话：必须 Windows + 有活动桌面（不可自愈）。"""
    if not _is_windows():
        return make_check(
            CHECK_NAMES[0],
            "failed",
            f"当前系统 {platform.system()} 非 Windows，微信 RPA 仅支持 Windows。"
            "请在 Windows 客户机上运行 agent。",
        )
    # 有活动桌面：用 GetSystemMetrics(SM_CXSCREEN) > 0 粗判（服务/无会话时为 0）。
    try:
        import ctypes

        cx = ctypes.windll.user32.GetSystemMetrics(0)
        if cx and cx > 0:
            return make_check(CHECK_NAMES[0], "ok", f"Windows 交互桌面会话正常（屏宽 {cx}px）。")
        return make_check(
            CHECK_NAMES[0],
            "failed",
            "未检测到交互桌面会话（屏宽=0，可能以服务/无人值守方式运行）。"
            "微信 RPA 必须在登录的交互桌面里跑，请用普通用户会话启动 agent。",
        )
    except Exception as exc:  # noqa: BLE001
        return make_check(CHECK_NAMES[0], "warn", f"无法判定桌面会话（{exc}），继续。")


def check_elevation(dry_run: bool = False) -> Dict[str, str]:
    """
    提权检测：当前进程是否以管理员/提权身份运行。

    真机踩坑：客户右键"以管理员身份运行"起 agent，start.bat 里 UIA 激活（设屏幕阅读器标志）那步报
    `Access is denied`（UIPI 权限隔离），UIA 没真激活 → 监听读不到微信窗口 →
    微信登录了也识别不到。普通用户身份跑就正常。故必须在此醒目提示。

    判定优先用 OpenProcessToken + GetTokenInformation(TokenElevation)（更准，
    能识别"以管理员身份运行"的提权态），失败回退 shell32.IsUserAnAdmin()。
    非 Windows / 查不到 → warn 并跳过（mac dry-run 优雅降级，不崩）。
    """
    name = CHECK_NAMES[7]
    if not _is_windows():
        return make_check(
            name,
            "warn",
            f"非 Windows（{platform.system()}），跳过提权检测（仅 Windows 客户机有效）。",
        )

    is_admin = _is_process_elevated()
    if is_admin is None:
        return make_check(
            name,
            "warn",
            "无法判定进程提权状态（token 查询失败），跳过。"
            "若屏幕阅读器标志激活报 Access denied，请改用普通用户身份运行。",
        )

    status, detail = classify_elevation(is_admin)
    return make_check(name, status, detail)


def _is_process_elevated() -> Optional[bool]:
    """
    查当前进程是否提权（管理员）。返回 True/False；查不到/非 Windows → None。
    Windows-only 调用全在函数体内 + try/except，mac 顶层 import 安全。
    """
    try:
        import ctypes
        from ctypes import wintypes
    except Exception:
        return None

    # 首选：OpenProcessToken + GetTokenInformation(TokenElevation)。
    try:
        TOKEN_QUERY = 0x0008
        TokenElevation = 20  # TOKEN_INFORMATION_CLASS.TokenElevation

        kernel32 = ctypes.windll.kernel32
        advapi32 = ctypes.windll.advapi32

        h_proc = kernel32.GetCurrentProcess()
        h_token = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(h_proc, TOKEN_QUERY, ctypes.byref(h_token)):
            raise OSError("OpenProcessToken 失败")
        try:
            elevation = wintypes.DWORD(0)
            ret_len = wintypes.DWORD(0)
            ok = advapi32.GetTokenInformation(
                h_token,
                TokenElevation,
                ctypes.byref(elevation),
                ctypes.sizeof(elevation),
                ctypes.byref(ret_len),
            )
            if ok:
                return bool(elevation.value)
            raise OSError("GetTokenInformation 失败")
        finally:
            kernel32.CloseHandle(h_token)
    except Exception:
        pass

    # 回退：IsUserAnAdmin（管理员组 + 提权时为真）。
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return None


def check_wechat_installed(dry_run: bool = False) -> Dict[str, str]:
    """2. 微信安装：Weixin.exe 在不在；不在 → 下载 4.1.8 静默装。"""
    name = CHECK_NAMES[1]
    if _weixin_installed():
        return make_check(name, "ok", "已检测到 Weixin.exe。")

    if dry_run or not _is_windows():
        return make_check(
            name,
            "failed",
            "未检测到 Weixin.exe（dry-run/非 Windows 跳过自动安装）。"
            "真实运行将自动下载 4.1.8 静默安装。",
        )

    installer = download_wechat_installer()
    if not installer:
        return make_check(
            name,
            "failed",
            "微信未安装且 4.1.8 安装包下载失败（COS/官方源均不可达）。"
            "请手动安装微信 4.1.8 后重启 agent。",
        )
    ok, info = _run_elevated([installer, "/S"])
    if ok and _weixin_installed():
        return make_check(name, "fixed", f"微信未安装 → 已通过 UAC 提权安装 4.1.8（{info}）。")
    return make_check(
        name,
        "failed",
        f"微信 4.1.8 安装失败（{info}）。"
        "安装需要管理员权限，弹出 UAC 确认框时请点击'是'。"
        "如未看到确认框或点击后仍失败，请手动安装微信 4.1.8 后重启 agent。",
    )


def check_wechat_version(dry_run: bool = False) -> Dict[str, str]:
    """3. 微信版本：不是 4.1.8.x（高于 >=4.1.9 或低于 <4.1.8）→ 卸载+装4.1.8；=4.1.8.x → ok；读不到 → warn。"""
    name = CHECK_NAMES[2]
    ver_str = get_weixin_version()
    parsed = _parse_version(ver_str)

    if parsed is None:
        # 装着但读不到版本 → 不硬阻断，给 warn（避免误杀）。
        if _weixin_installed():
            return make_check(
                name,
                "warn",
                f"读不到微信版本号（raw={ver_str!r}），跳过版本守卫。"
                "若 RPA 异常请人工确认版本 = 4.1.8.x。",
            )
        return make_check(
            name, "failed", "微信未安装，无法判定版本（应先过'微信安装'项）。"
        )

    action = decide_wechat_action(parsed)
    ver_show = ".".join(str(x) for x in parsed)

    if action == "ok":
        return make_check(name, "ok", f"微信版本 {ver_show} >= 4.1.8（含 4.1.10+，Qt UIA 可用），RPA 可用。")

    if action == "install":  # 理论上 parsed 非 None 不会走到这
        return make_check(name, "failed", "微信未安装（应先过'微信安装'项）。")

    # downgrade 只可能是 < 4.1.8（控件配方不一致 / 无 mmui::MainWindow），必须卸载后装 4.1.8。
    # （>= 4.1.8 现一律 ok，不再 downgrade；6-21 放开上界。）
    reason = "低于基线 <4.1.8（控件配方不一致 / 无 mmui::MainWindow）"
    if dry_run or not _is_windows():
        return make_check(
            name,
            "failed",
            f"微信版本 {ver_show} {reason}，RPA 不可用。"
            "dry-run/非 Windows 跳过自动替换；真实运行将卸载后装 4.1.8。",
        )

    uninstaller = _find_file(WEIXIN_INSTALL_ROOT, "Uninstall.exe")
    if uninstaller:
        _run_elevated([uninstaller, "/S"], timeout=300)
        time.sleep(3)
    installer = download_wechat_installer()
    if not installer:
        return make_check(
            name,
            "failed",
            f"需把 {ver_show} 换成 4.1.8.x，但安装包下载失败。"
            "请手动卸载并安装微信 4.1.8 后重启 agent。",
        )
    ok, info = _run_elevated([installer, "/S"])
    new_ver = get_weixin_version()
    new_parsed = _parse_version(new_ver)
    if ok and new_parsed is not None and decide_wechat_action(new_parsed) == "ok":
        return make_check(
            name,
            "fixed",
            f"微信 {ver_show} → 已通过 UAC 提权卸载重装 4.1.8.x（现 {'.'.join(str(x) for x in new_parsed)}）。",
        )
    return make_check(
        name,
        "failed",
        f"微信换成 4.1.8.x 失败（install {info}，现版本 {new_ver!r}）。"
        "安装需要管理员权限，弹出 UAC 确认框时请点击'是'。"
        "如未看到确认框或点击后仍失败，请手动卸载后安装微信 4.1.8 再重启。",
    )


def check_wechat_login(dry_run: bool = False) -> Dict[str, str]:
    """4. 微信登录态：未登录 → 拉起微信 + 提示扫码。"""
    name = CHECK_NAMES[3]
    try:
        from find_weixin import get_main_window, login_window_present
    except Exception as exc:  # noqa: BLE001
        return make_check(name, "warn", f"无法导入寻址 API（{exc}），跳过登录态检测。")

    try:
        mw = get_main_window()
    except Exception as exc:  # noqa: BLE001
        return make_check(
            name, "warn", f"读取微信主窗口失败（{exc}，多为非 Windows/缺 pywinauto），跳过。"
        )

    if mw is not None:
        return make_check(name, "ok", "微信已登录（检测到 mmui::MainWindow）。")

    # 未见主窗口：可能停在登录窗口或微信没启动。
    login = False
    try:
        login = login_window_present()
    except Exception:
        login = False

    if not dry_run and _is_windows():
        # 尝试拉起微信（best-effort）。
        try:
            import subprocess

            if os.path.isfile(WEIXIN_EXE_DEFAULT):
                subprocess.Popen([WEIXIN_EXE_DEFAULT])
            else:
                found = _find_file(WEIXIN_INSTALL_ROOT, "Weixin.exe")
                if found:
                    subprocess.Popen([found])
        except Exception:
            pass

    detail = "微信未登录" + ("（停在登录窗口）" if login else "（未检测到主窗口）")
    return make_check(
        name,
        "warn",
        detail + "。已尝试拉起微信，请在客户机上 **扫码登录**，agent 将自动就绪。",
    )


def check_python_pywinauto(dry_run: bool = False) -> Dict[str, str]:
    """5. Python+pywinauto：import 测试；失败 → 提示重装 agent。"""
    name = CHECK_NAMES[4]
    try:
        import pywinauto  # noqa: F401

        ver = getattr(pywinauto, "__version__", "unknown")
        return make_check(name, "ok", f"pywinauto 可用（version={ver}）。")
    except Exception as exc:  # noqa: BLE001
        # mac/linux 开发环境本就无 pywinauto → warn；Windows 上缺失才是 failed。
        if not _is_windows():
            return make_check(
                name, "warn", f"pywinauto 在 {platform.system()} 不可用（开发环境正常）：{exc}"
            )
        return make_check(
            name,
            "failed",
            f"pywinauto import 失败（{exc}）。Python 运行时损坏，请重新下载安装包重装 agent。",
        )


def check_uia_narrator(dry_run: bool = False) -> Dict[str, str]:
    """6. UIA 激活：设系统屏幕阅读器标志后能否读到微信主窗口（替代讲述人）。"""
    name = CHECK_NAMES[5]
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


def check_middleware_health(middleware_url: str, dry_run: bool = False) -> Dict[str, str]:
    """7. 中台连通：GET <url>/health 或 /api/health（短超时）。"""
    name = CHECK_NAMES[6]
    if not middleware_url:
        return make_check(name, "warn", "未提供 middleware-url，跳过中台连通检测。")

    import urllib.request

    base = middleware_url.rstrip("/")
    last_err = ""
    for path in ("/health", "/api/health"):
        url = base + path
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                code = getattr(resp, "status", resp.getcode())
                if 200 <= int(code) < 500:
                    return make_check(name, "ok", f"中台可达（GET {path} → {code}）。")
                last_err = f"{path} → HTTP {code}"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{path} → {type(exc).__name__}: {exc}"
            continue

    return make_check(
        name,
        "failed",
        f"中台不可达（{base}，{last_err}）。请检查客户机网络与 .env 中 ZENITHJOY_API_BASE 配置。",
    )


# ─── 编排：跑全部检测 → 汇总 → 打印 → 落盘 → 上报 ──────────────────────────────


def run_all_checks(middleware_url: str, dry_run: bool = False) -> List[Dict[str, str]]:
    """按序跑全部检测，每项独立 try/except 兜底（单项崩不拖垮整体）。

    elevation 排在 os_session 之后靠前：它影响后面 UIA/屏幕阅读器标志激活/登录项的成败。
    """
    runners: List[Tuple[str, Any]] = [
        ("os_session", lambda: check_os_session(dry_run)),
        ("elevation", lambda: check_elevation(dry_run)),
        ("wechat_installed", lambda: check_wechat_installed(dry_run)),
        ("wechat_version", lambda: check_wechat_version(dry_run)),
        ("wechat_login", lambda: check_wechat_login(dry_run)),
        ("python_pywinauto", lambda: check_python_pywinauto(dry_run)),
        ("uia_narrator", lambda: check_uia_narrator(dry_run)),
        ("middleware_health", lambda: check_middleware_health(middleware_url, dry_run)),
    ]
    checks: List[Dict[str, str]] = []
    for cname, run in runners:
        try:
            checks.append(run())
        except Exception as exc:  # noqa: BLE001 — 单项异常降级为 failed，不让体检整体崩
            checks.append(
                make_check(
                    cname,
                    "failed",
                    f"检测项内部异常：{type(exc).__name__}: {exc}",
                )
            )
    return checks


def print_report(report: Dict[str, Any]) -> None:
    """打印人类可读体检报告到 stdout。"""
    print("=" * 60)
    print("  ZenithJoy Agent 开机环境自检（preflight）")
    print("=" * 60)
    for c in report.get("checks", []):
        icon = _STATUS_ICON.get(c.get("status"), "?")
        print(f"  {icon} [{c.get('name')}] {c.get('detail')}")
    counts = report.get("counts", {})
    print("-" * 60)
    print(
        f"  汇总：ok={counts.get('ok', 0)} fixed={counts.get('fixed', 0)} "
        f"warn={counts.get('warn', 0)} failed={counts.get('failed', 0)}  "
        f"=> all_ok={report.get('all_ok')}"
    )
    print("=" * 60)
    sys.stdout.flush()


def write_report_json(report: Dict[str, Any], path: Optional[str] = None) -> bool:
    """把报告写本地 JSON。失败吞掉返回 False（不阻断体检）。"""
    if path is None:
        path = PREFLIGHT_JSON_PATH
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    except Exception:
        pass
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def report_to_middleware(
    middleware_url: str, report: Dict[str, Any], agent_id: Optional[str] = None
) -> bool:
    """
    best-effort 上报报告到中台（复用 listen_chat.post_heartbeat，塞进 diag.preflight）。
    失败全部吞掉返回 False，绝不抛——上报不能拖垮启动。
    """
    if not middleware_url:
        return False
    try:
        from listen_chat import post_heartbeat

        hb = post_heartbeat(
            middleware_url,
            agent_id=agent_id or os.environ.get("ZENITHJOY_AGENT_ID"),
            diag={"preflight": report},
        )
        return bool(hb.get("ok"))
    except Exception:
        return False


# ─── CLI ─────────────────────────────────────────────────────────────────────


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="ZenithJoy Agent 开机环境自检 + 自愈")
    ap.add_argument(
        "--middleware-url",
        type=str,
        default=os.environ.get("ZENITHJOY_API_BASE", ""),
        help="中台地址（缺省取 env ZENITHJOY_API_BASE）",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="只检测不自愈、不下载、不卸载（给 CI / mac 跑）",
    )
    ap.add_argument(
        "--agent-id",
        type=str,
        default=os.environ.get("ZENITHJOY_AGENT_ID"),
        help="上报中台用的 agent 标识",
    )
    return ap.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    checks = run_all_checks(args.middleware_url, dry_run=args.dry_run)
    report = build_report(checks)

    print_report(report)
    wrote = write_report_json(report)
    if not wrote:
        print(f"[preflight] 写本地报告失败（{PREFLIGHT_JSON_PATH}），继续。", file=sys.stderr)

    reported = report_to_middleware(args.middleware_url, report, agent_id=args.agent_id)
    if not reported:
        print("[preflight] 上报中台失败/跳过（best-effort，不阻断）。", file=sys.stderr)

    return compute_exit_code(checks)


if __name__ == "__main__":
    sys.exit(main())
