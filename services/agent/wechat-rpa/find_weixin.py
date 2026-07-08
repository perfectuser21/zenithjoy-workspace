"""
find_weixin.py — PC 微信 4.0 窗口寻址（Path 4 Step 5 pywinauto 版）。

已在 xian-pc 微信 4.0(Weixin.exe) 真机验证的配方：
  - 主窗口 = Desktop(backend='uia').windows() 里 element_info.class_name == 'mmui::MainWindow'
  - 登录屏 = 'mmui::LoginWindow'（出现它说明微信没真登录进去，需先扫码登录）

pywinauto 是 Windows-only，只在函数体内 import —— 顶层保持 macOS/Linux 也能 import 本模块
（供纯逻辑单测与跨平台 lint），真实寻址只在 Windows 运营机上执行。
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

MAIN_WINDOW_CLASS = "mmui::MainWindow"
LOGIN_WINDOW_CLASS = "mmui::LoginWindow"
# 4.1.10+ 主窗口外框换成 Qt5（mmui::MainWindow 没了），但 UIA 子树照样可读、消息照样能发。
QT5_WINDOW_CLASS = "Qt51514QWindowIcon"  # xwechat Qt5 frame (4.1.10.x via xwechat patch)

# 微信安装默认路径（Weixin 4.x 官方安装位置）
WEIXIN_EXE_DEFAULT = r"C:\Program Files\Tencent\Weixin\Weixin.exe"

# 2026-06-24 政策放开上界（6-21 真机验证 wechat_qt_uia_works_dont_downgrade）：
# 锁死 4.1.8.x（2026-06-29 决策，反转 #852/#853 的"放开上界"）：
#   < 4.1.8（3.x / 4.0.x / 4.1.0~4.1.7）：控件配方不一致 / 无 mmui::MainWindow，RPA 不可用 → 阻断。
#   >= 4.1.9（含 4.1.10+）：UIA 机制其实一样（没被封），但新版【控件适配未做】——登录检测误报、
#     微信重启自愈不自动登录、_reset_session_list_to_top 找不到导航按钮 等在 4.1.10 上坏。
#     4.1.8 已全适配+验证（rog 真发 DELIVERED），花大力气适配 4.1.10 没必要 → 阻断，锁 4.1.8.x。
#     将来真用不了 4.1.8（封了 UIA / 装不上）再拿新版适配。
MIN_BLOCKED_VERSION = (4, 1, 9)   # 上界（含）：>= 此值阻断（4.1.9 / 4.1.10+）
MIN_REQUIRED_VERSION = (4, 1, 8)  # 下界：< 此值阻断。合起来 = 只认 4.1.8.x
DOWNGRADE_URL = (
    "https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com"
    "/install-pack/wechat/WeChatWin_4.1.8.exe"
)


def _parse_version(ver_str: Optional[str]) -> Optional[Tuple[int, ...]]:
    """
    把 '4.1.8.107' 这样的版本串解析成 (4, 1, 8, 107) 元组。

    纯函数，不碰 ctypes/windll —— 可在 mac/linux 单测。
    解析失败（None / 空串 / 非数字）返回 None。
    """
    if not ver_str:
        return None
    parts = []
    for chunk in str(ver_str).strip().split("."):
        chunk = chunk.strip()
        if chunk == "":
            continue
        if not chunk.isdigit():
            return None
        parts.append(int(chunk))
    if not parts:
        return None
    return tuple(parts)


def _parse_and_check(ver_str: Optional[str]) -> None:
    """
    解析版本串并执行守卫判定（纯函数，可单测，不依赖 Windows）。

    2026-06-24 放开上界（>= 4.1.8 一律放行）：
    - 版本 < (4, 1, 8) → 抛 RuntimeError（控件配方不一致 / 无 mmui::MainWindow，RPA 不可用）
    - 版本 >= (4, 1, 8)（含 4.1.9 / 4.1.10+ / 未来）→ 放行（返回 None）
      6-21 真机验证 Qt51514QWindowIcon 窗口 UIA 照样能发，不再因上界 fail。
    - 解析不出版本（None / "" / 非法）→ 不抛，仅 warning，避免误杀
    """
    parsed = _parse_version(ver_str)
    if parsed is None:
        logger.warning(
            "无法解析微信版本号 %r，跳过版本守卫（不阻断）。", ver_str
        )
        return None

    # 只比较 major.minor.patch 三段即可判定下界（patch 段足够区分 4.1.7 / 4.1.8）
    head = parsed[:3]
    # 补齐到 3 段，便于和 MIN_REQUIRED_VERSION 比较
    head = head + (0,) * (3 - len(head))

    ver_show = ".".join(str(x) for x in parsed)
    if head < MIN_REQUIRED_VERSION:
        raise RuntimeError(
            f"微信版本 {ver_show} 过低：只支持 4.1.8.x（< 4.1.8 控件配方不一致 / 无 mmui::MainWindow）。"
            f"请安装 4.1.8.x（官方包 {DOWNGRADE_URL}）"
        )
    # 上界：>= 4.1.9（含 4.1.10+）阻断——这些新版的控件适配【未做】（登录状态检测误报 /
    # 微信重启自愈不自动登录 / _reset_session_list_to_top 找不到导航按钮 等在 4.1.10 上坏），
    # 不是 UIA 被封（机制 4.1.8/4.1.10 一样），是适配工作量。锁死 4.1.8.x（已全验证），
    # 将来真用不了 4.1.8 再拿新版适配。2026-06-29 有意识反转 #852/#853 的"放开上界"（前提变了）。
    if head >= MIN_BLOCKED_VERSION:
        raise RuntimeError(
            f"微信版本 {ver_show} 过高：只支持 4.1.8.x（>= 4.1.9 控件适配未做，RPA 不可用）。"
            f"请降级到 4.1.8.x（官方包 {DOWNGRADE_URL}）"
        )
    return None


def get_weixin_version(exe_path: Optional[str] = None) -> Optional[str]:
    """
    读取 Weixin.exe 的 FileVersion（如 '4.1.8.107'）。

    用 ctypes 调 Windows version.dll（GetFileVersionInfoSizeW /
    GetFileVersionInfoW / VerQueryValueW）解析 —— 不引入任何新依赖。
    仅 Windows 可用；非 Windows 或读不到时返回 None。

    exe_path 默认用固定安装路径 WEIXIN_EXE_DEFAULT，找不到再尝试从运行进程兜底。
    """
    import ctypes  # 仅运行时需要，放函数体内保持顶层跨平台可 import
    from ctypes import wintypes

    # windll 只在 Windows 存在；非 Windows 直接放弃
    if not hasattr(ctypes, "windll"):
        return None

    path = exe_path or WEIXIN_EXE_DEFAULT
    if not os.path.isfile(path):
        # 固定路径找不到 → 尝试从运行中的 Weixin.exe 进程拿 ExecutablePath 兜底（可选）
        fallback = _find_running_weixin_path()
        if not fallback:
            logger.warning("找不到 Weixin.exe（path=%r），无法读取版本。", path)
            return None
        path = fallback

    try:
        version_dll = ctypes.windll.version

        GetFileVersionInfoSizeW = version_dll.GetFileVersionInfoSizeW
        GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
        GetFileVersionInfoSizeW.restype = wintypes.DWORD

        GetFileVersionInfoW = version_dll.GetFileVersionInfoW
        GetFileVersionInfoW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
        ]
        GetFileVersionInfoW.restype = wintypes.BOOL

        VerQueryValueW = version_dll.VerQueryValueW
        VerQueryValueW.argtypes = [
            wintypes.LPCVOID,
            wintypes.LPCWSTR,
            ctypes.POINTER(wintypes.LPVOID),
            ctypes.POINTER(wintypes.UINT),
        ]
        VerQueryValueW.restype = wintypes.BOOL

        dummy = wintypes.DWORD(0)
        size = GetFileVersionInfoSizeW(path, ctypes.byref(dummy))
        if not size:
            logger.warning("GetFileVersionInfoSizeW 返回 0（path=%r）。", path)
            return None

        buf = ctypes.create_string_buffer(size)
        if not GetFileVersionInfoW(path, 0, size, buf):
            logger.warning("GetFileVersionInfoW 失败（path=%r）。", path)
            return None

        # 查询根块 '\\' 拿 VS_FIXEDFILEINFO，从中取 FileVersion 高低位
        class VS_FIXEDFILEINFO(ctypes.Structure):
            _fields_ = [
                ("dwSignature", wintypes.DWORD),
                ("dwStrucVersion", wintypes.DWORD),
                ("dwFileVersionMS", wintypes.DWORD),
                ("dwFileVersionLS", wintypes.DWORD),
                ("dwProductVersionMS", wintypes.DWORD),
                ("dwProductVersionLS", wintypes.DWORD),
                ("dwFileFlagsMask", wintypes.DWORD),
                ("dwFileFlags", wintypes.DWORD),
                ("dwFileOS", wintypes.DWORD),
                ("dwFileType", wintypes.DWORD),
                ("dwFileSubtype", wintypes.DWORD),
                ("dwFileDateMS", wintypes.DWORD),
                ("dwFileDateLS", wintypes.DWORD),
            ]

        ffi_ptr = wintypes.LPVOID()
        ffi_len = wintypes.UINT(0)
        if not VerQueryValueW(buf, "\\", ctypes.byref(ffi_ptr), ctypes.byref(ffi_len)):
            logger.warning("VerQueryValueW('\\\\') 失败（path=%r）。", path)
            return None

        ffi = ctypes.cast(ffi_ptr, ctypes.POINTER(VS_FIXEDFILEINFO)).contents
        ms = ffi.dwFileVersionMS
        ls = ffi.dwFileVersionLS
        major = (ms >> 16) & 0xFFFF
        minor = ms & 0xFFFF
        patch = (ls >> 16) & 0xFFFF
        build = ls & 0xFFFF
        return f"{major}.{minor}.{patch}.{build}"
    except Exception as exc:  # noqa: BLE001 — 读版本失败不应让 RPA 整体崩
        logger.warning("读取 Weixin.exe 版本异常（path=%r）：%s", path, exc)
        return None


def _find_running_weixin_path() -> Optional[str]:
    """从运行中的进程里找 Weixin.exe 的可执行路径（兜底，可选）。失败返回 None。"""
    try:
        import ctypes
        from ctypes import wintypes

        if not hasattr(ctypes, "windll"):
            return None

        TH32CS_SNAPPROCESS = 0x00000002
        MAX_PATH = 260

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", ctypes.c_wchar * MAX_PATH),
            ]

        kernel32 = ctypes.windll.kernel32
        snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if snap == wintypes.HANDLE(-1).value:
            return None
        try:
            entry = PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
            if not kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                return None
            while True:
                if entry.szExeFile.lower() == "weixin.exe":
                    pid = entry.th32ProcessID
                    path = _query_process_path(pid)
                    if path:
                        return path
                if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                    break
        finally:
            kernel32.CloseHandle(snap)
    except Exception:  # noqa: BLE001
        return None
    return None


def _query_process_path(pid: int) -> Optional[str]:
    """给定 PID 查询其完整可执行路径（QueryFullProcessImageNameW）。失败返回 None。"""
    try:
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return None
        try:
            buf_len = wintypes.DWORD(32768)
            buf = ctypes.create_unicode_buffer(buf_len.value)
            if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(buf_len)):
                return buf.value
        finally:
            kernel32.CloseHandle(h)
    except Exception:  # noqa: BLE001
        return None
    return None


def assert_supported_version(exe_path: Optional[str] = None) -> None:
    """
    版本守卫入口：读 Weixin.exe 版本并断言其在 RPA 可用范围内。

    锁死 4.1.8.x（委托 _parse_and_check，2026-06-29 决策）：
    - < 4.1.8 → 抛 RuntimeError（控件配方不一致 / 无 mmui::MainWindow，RPA 不可用）
    - >= 4.1.9（含 4.1.10+）→ 抛 RuntimeError（新版控件适配未做，RPA 不可用，需降回 4.1.8.x）
    - 仅 4.1.8.x → 放行（已全适配+验证）
    - 版本读不到 → 不硬阻断（返回 None + warning），避免误杀

    应在任何 RPA 寻址前调用。
    """
    ver = get_weixin_version(exe_path)
    return _parse_and_check(ver)


def is_weixin_running() -> bool:
    """检测微信进程是否在运行（跨平台：非 Windows 返回 False）。

    使用 bytes 模式避免 GBK 环境 text=True 解码失败。
    WeChat 4.x 启动后 Weixin.exe（launcher）很快退出，常驻进程是 WeChatAppEx.exe，
    因此同时检测三个进程名。
    """
    try:
        import subprocess  # noqa: PLC0415
        result = subprocess.run(
            ["tasklist"],
            capture_output=True, timeout=5,
        )
        out = result.stdout
        return (
            b"Weixin.exe" in out
            or b"WeixinUpdate.exe" in out
            or b"WeChatAppEx.exe" in out
        )
    except Exception:
        return False


def discover_weixin_exe() -> Optional[str]:
    """
    自动发现 Weixin.exe 安装路径（无需手动配置，适配任意机器）。

    检测顺序：
    1. 已运行进程 → 从进程路径直接拿（最准确，适配非标路径）
    2. 默认路径 WEIXIN_EXE_DEFAULT
    3. Windows 注册表 HKCU / HKLM 中 Tencent\Weixin 安装目录
    4. C/D 盘常见备用路径兜底

    返回第一个找到的有效路径，均找不到返回 None。
    """
    # 1. 已运行进程 → 路径最准确
    running = _find_running_weixin_path()
    if running and os.path.isfile(running):
        logger.info("discover_weixin_exe: 从运行进程找到 %r", running)
        return running

    # 2. 官方默认路径
    if os.path.isfile(WEIXIN_EXE_DEFAULT):
        return WEIXIN_EXE_DEFAULT

    # 3. 注册表查找（winreg 仅 Windows 有）
    try:
        import winreg  # type: ignore[import]
        reg_entries = [
            (winreg.HKEY_CURRENT_USER,  r"SOFTWARE\Tencent\Weixin"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Tencent\Weixin"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Tencent\Weixin"),
        ]
        for hive, subkey in reg_entries:
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    install_dir, _ = winreg.QueryValueEx(key, "InstallPath")
                    if install_dir:
                        candidate = os.path.join(str(install_dir), "Weixin.exe")
                        if os.path.isfile(candidate):
                            logger.info("discover_weixin_exe: 注册表找到 %r", candidate)
                            return candidate
            except OSError:
                continue
    except ImportError:
        pass  # 非 Windows 环境

    # 4. 常见备用路径（D 盘、x86、LocalAppData 等）
    alt_paths = [
        r"D:\Program Files\Tencent\Weixin\Weixin.exe",
        r"D:\Program Files (x86)\Tencent\Weixin\Weixin.exe",
        r"C:\Program Files (x86)\Tencent\Weixin\Weixin.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Tencent\Weixin\Weixin.exe"),
        os.path.expandvars(r"%ProgramFiles%\Tencent\Weixin\Weixin.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Tencent\Weixin\Weixin.exe"),
    ]
    for alt in alt_paths:
        if os.path.isfile(alt):
            logger.info("discover_weixin_exe: 备用路径找到 %r", alt)
            return alt

    logger.warning("discover_weixin_exe: 所有探测路径均未找到 Weixin.exe")
    return None


def launch_weixin(exe_path: Optional[str] = None) -> bool:
    """
    启动 Weixin.exe（微信 4.x 客户端）。

    - exe_path 未指定时自动探测（discover_weixin_exe），适配任意机器无需手动配置。
    - 成功启动返回 True；文件不存在 / 非 Windows / spawn 异常返回 False。
    - 已在运行时也返回 True（幂等）。
    """
    import subprocess  # noqa: PLC0415
    path = exe_path or discover_weixin_exe()
    if not path or not os.path.isfile(path):
        logger.warning("找不到 Weixin.exe（已自动探测所有路径），无法自动启动微信。")
        return False
    try:
        CREATE_NO_WINDOW = 0x08000000
        subprocess.Popen(
            [path],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", CREATE_NO_WINDOW),
        )
        logger.info("已 Popen 启动 Weixin.exe（path=%r）", path)
        return True
    except Exception as exc:
        logger.warning("启动 Weixin.exe 失败（path=%r）：%s", path, exc)
        return False


def get_main_window() -> Optional[Any]:
    """
    返回微信主窗口（mmui::MainWindow 或 Qt51514QWindowIcon/微信）。

    - mmui::MainWindow：UIA 控件树完整，可 RPA 操作
    - Qt51514QWindowIcon（title 含"微信"）：xwechat 4.1.10+ 框架，UIA 子树可能为空
    - UI 自动化必须在微信登录的交互桌面会话里运行，否则读不到元素。
    """
    from pywinauto import Desktop  # 仅 Windows 运行时需要，顶层不 import

    for w in Desktop(backend="uia").windows():
        try:
            cls = w.element_info.class_name
            title = w.element_info.name or ""
            if cls == MAIN_WINDOW_CLASS:
                return w
            # 4.1.8 最小化到托盘时 Qt5 外框 title="Weixin"（英文）；4.1.10+ title 含"微信"
            if cls == QT5_WINDOW_CLASS and ("微信" in title or title == "Weixin"):
                return w
        except Exception:
            continue
    return None


def login_window_present() -> bool:
    """是否检测到真正未登录界面（需扫码登录）。

    区分两种 mmui::LoginWindow 状态：
    - title='登录'：真正未登录，需要扫码 → 返回 True
    - title='微信'：隐私锁屏（账号已登录但屏幕被锁）→ 返回 False（见 is_privacy_locked）
    """
    from pywinauto import Desktop

    for w in Desktop(backend="uia").windows():
        try:
            cls = w.element_info.class_name
            title = w.element_info.name or ""
            if cls == LOGIN_WINDOW_CLASS and title == "登录":
                return True
            # "Weixin"/"微信" = 已登录或隐私锁，不是真正未登录；只有"登录"才是扫码登录页
            if cls == QT5_WINDOW_CLASS and title == "登录":
                return True
        except Exception:
            continue
    return False


def is_privacy_locked() -> bool:
    """检测微信是否处于隐私锁屏状态（账号已登录但屏幕被锁）。

    当微信启用隐私保护（隐私锁）时，锁屏界面复用 mmui::LoginWindow 类，
    但 title 保持 '微信'（app 名），区别于真正未登录的 '登录' title。
    枚举失败（UIA 未就绪）时保守返回 False，不阻断监听主循环。
    """
    from pywinauto import Desktop

    try:
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name
                title = w.element_info.name or ""
                if cls == LOGIN_WINDOW_CLASS and title == "微信":
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def is_welcome_back_screen() -> bool:
    """检测微信是否处于"欢迎回来"确认屏（mmui::LoginWindow + 含"进入微信"按钮，不需密码）。

    与 is_privacy_locked() 的区别：两者均为 mmui::LoginWindow title='微信'，
    但欢迎回来屏有"进入微信"按钮（系统重启后微信自动启动时出现），而隐私锁屏有密码输入框。
    本函数查找"进入微信"按钮作为区分依据。
    非 Windows 或 UIA 未就绪时返回 False（不阻断调用方）。
    """
    from pywinauto import Desktop

    try:
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name
                title = w.element_info.name or ""
                if cls != LOGIN_WINDOW_CLASS or title not in ("微信", "Weixin", "WeChat"):
                    continue
                for c in w.descendants(control_type="Button"):
                    try:
                        nm = c.element_info.name or ""
                        if nm in ("进入微信", "Enter WeChat"):
                            return True
                    except Exception:
                        continue
            except Exception:
                continue
    except Exception:
        pass
    return False


def click_welcome_back_enter() -> bool:
    """点击欢迎回来屏的"进入微信"按钮（AttachThreadInput 拉前台 + click_input）。

    返回 True 表示点击动作已发出（不等待微信主窗口出现，调用方自行 15s 验证）。
    返回 False 表示找不到按钮或点击异常。非 Windows 直接返回 False。
    """
    import platform as _plat
    if _plat.system() != "Windows":
        return False
    from pywinauto import Desktop
    import ctypes as _ctw
    try:
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name
                title = w.element_info.name or ""
                if cls != LOGIN_WINDOW_CLASS or title not in ("微信", "Weixin", "WeChat"):
                    continue
                for c in w.descendants(control_type="Button"):
                    try:
                        nm = c.element_info.name or ""
                        if nm not in ("进入微信", "Enter WeChat"):
                            continue
                        hwnd = w.element_info.handle
                        if hwnd:
                            # AttachThreadInput 拉前台：把我方线程输入态附到微信 UI 线程，
                            # 再 SetForegroundWindow，使 click_input 在无 desktop 访问权的 session-1
                            # 计划任务中也能触达真实控件。
                            my_tid = _ctw.windll.kernel32.GetCurrentThreadId()
                            tgt_tid = _ctw.windll.user32.GetWindowThreadProcessId(hwnd, None)
                            attached = _ctw.windll.user32.AttachThreadInput(my_tid, tgt_tid, True)
                            try:
                                _ctw.windll.user32.SetForegroundWindow(hwnd)
                                _ctw.windll.user32.BringWindowToTop(hwnd)
                                c.click_input()
                            finally:
                                if attached:
                                    _ctw.windll.user32.AttachThreadInput(my_tid, tgt_tid, False)
                        else:
                            c.click_input()
                        return True
                    except Exception:
                        continue
            except Exception:
                continue
    except Exception:
        pass
    return False


if __name__ == "__main__":
    import argparse
    import sys as _sys

    parser = argparse.ArgumentParser(description="WeChat version guard CLI")
    parser.add_argument("--check-version", action="store_true", help="检测微信版本是否受支持，不支持则 exit 1")
    _args = parser.parse_args()

    if _args.check_version:
        try:
            assert_supported_version()
            _ver = get_weixin_version() or "unknown"
            print(f"[version-guard] WeChat {_ver} OK")
            _sys.exit(0)
        except RuntimeError as _e:
            print(f"[version-guard] ERROR: {_e}", file=_sys.stderr)
            _sys.exit(1)
