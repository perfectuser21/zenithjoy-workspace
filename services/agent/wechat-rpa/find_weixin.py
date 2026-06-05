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

# 微信安装默认路径（Weixin 4.x 官方安装位置）
WEIXIN_EXE_DEFAULT = r"C:\Program Files\Tencent\Weixin\Weixin.exe"

# 4.1.9 起聊天窗口的无障碍控件树(mmui)被移除（主窗口变成不透明 Qt 窗口），
# UIA / MSAA 两层都读不到聊天控件 → RPA 不可用。4.1.8.107 = 已验证可用基线。
MIN_BLOCKED_VERSION = (4, 1, 9)
DOWNGRADE_URL = "https://dldir1v6.qq.com/weixin/Universal/Windows/WeChatWin_4.1.8.exe"


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

    - 版本 >= (4, 1, 9) → 抛 RuntimeError（无障碍控件树已被移除，RPA 不可用）
    - 版本 <= (4, 1, 8.x) → 放行（返回 None）
    - 解析不出版本（None / "" / 非法）→ 不抛，仅 warning，避免误杀
    """
    parsed = _parse_version(ver_str)
    if parsed is None:
        logger.warning(
            "无法解析微信版本号 %r，跳过版本守卫（不阻断）。", ver_str
        )
        return None

    # 只比较 major.minor.patch 三段即可判定（patch 段足够区分 4.1.8 / 4.1.9）
    head = parsed[:3]
    # 补齐到 3 段，便于和 MIN_BLOCKED_VERSION 比较
    head = head + (0,) * (3 - len(head))

    if head >= MIN_BLOCKED_VERSION:
        ver_show = ".".join(str(x) for x in parsed)
        raise RuntimeError(
            f"微信版本 {ver_show} 过高：4.1.9 起无障碍控件树被移除，RPA 不可用。"
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

    - >= 4.1.9 → 抛 RuntimeError（无障碍控件树被移除，RPA 不可用）
    - <= 4.1.8.x → 放行（返回 None）
    - 版本读不到 → 不硬阻断（返回 None + warning），避免误杀

    应在任何 RPA 寻址前调用。
    """
    ver = get_weixin_version(exe_path)
    return _parse_and_check(ver)


def get_main_window() -> Optional[Any]:
    """
    返回微信 4.0 主窗口（class_name == 'mmui::MainWindow'）。

    - 没找到主窗口、或只看到 'mmui::LoginWindow'（未登录）→ 返回 None，调用方据此报"需扫码登录"。
    - UI 自动化必须在微信登录的交互桌面会话里运行，否则读不到元素。
    """
    from pywinauto import Desktop  # 仅 Windows 运行时需要，顶层不 import

    for w in Desktop(backend="uia").windows():
        try:
            if w.element_info.class_name == MAIN_WINDOW_CLASS:
                return w
        except Exception:
            continue
    return None


def login_window_present() -> bool:
    """是否检测到登录窗口（mmui::LoginWindow）—— 用于区分"未登录"与"没找到微信"。"""
    from pywinauto import Desktop

    for w in Desktop(backend="uia").windows():
        try:
            if w.element_info.class_name == LOGIN_WINDOW_CLASS:
                return True
        except Exception:
            continue
    return False
