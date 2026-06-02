"""
find_weixin.py — PC 微信 4.0 窗口寻址（Path 4 Step 5 pywinauto 版）。

已在 xian-pc 微信 4.0(Weixin.exe) 真机验证的配方：
  - 主窗口 = Desktop(backend='uia').windows() 里 element_info.class_name == 'mmui::MainWindow'
  - 登录屏 = 'mmui::LoginWindow'（出现它说明微信没真登录进去，需先扫码登录）

pywinauto 是 Windows-only，只在函数体内 import —— 顶层保持 macOS/Linux 也能 import 本模块
（供纯逻辑单测与跨平台 lint），真实寻址只在 Windows 运营机上执行。
"""
from __future__ import annotations

from typing import Any, Optional

MAIN_WINDOW_CLASS = "mmui::MainWindow"
LOGIN_WINDOW_CLASS = "mmui::LoginWindow"


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
