"""
reset_stage_cli.py — WS-B 复位台真机 CLI（xian-rog 上跑，注入真实 Win UI driver）。

把 reset_stage.py 的逻辑层接上真实副作用：关微信 app / 清会话残留 / 验登录 / 验版本。
逻辑判定全在 reset_stage.reset_stage()（已被 test_reset_stage.py 单测覆盖），本文件只提供真 driver。

用法（xian-rog PowerShell / cmd）：
    set RESET_EXPECTED_ACCOUNT=<专用测试号标识>
    python reset_stage_cli.py
退出码：0 = 复位回黄金态；非 0 = 复位红（smoke 不应继续跑）。

设计纪律（PrepPRD WS-B 第一刀薄）：
  · 登录校验：主窗口在且不是登录/隐私锁屏 → 视为"已登录专用测试号"。xian-rog 是专用台、
    常驻唯一专用测试号，故"主窗口已登录"等价于"专用测试号在线"；expected_account 仅作标签记录。
  · 清会话残留：薄实现 = 关 app 后删本地临时 RPA 状态文件（不动微信账号数据）。
    加厚（多号/多会话清理）必须有真实残留证据驱动。
"""
from __future__ import annotations

import os
import sys
import subprocess
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reset_stage import reset_stage  # noqa: E402


class RealWinDriver:
    """xian-rog 真机 UI driver（pywinauto + taskkill）。各方法只做副作用，判定交给 reset_stage。"""

    def close_running_wechat(self) -> bool:
        """① 关掉残留微信 app（幂等：没在跑也算成功）。"""
        try:
            # /F 强制、/T 连子进程；Weixin.exe（4.x）+ WeChat.exe（老）都试
            for exe in ("Weixin.exe", "WeChat.exe", "WeChatAppEx.exe"):
                subprocess.run(["taskkill", "/F", "/T", "/IM", exe],
                               capture_output=True, text=True)
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"close_running_wechat 异常: {exc}", file=sys.stderr)
            return False

    def clear_session_residue(self) -> bool:
        """② 清会话残留（薄实现：删本地 RPA 临时状态文件，不动微信账号数据）。"""
        try:
            public = os.environ.get("PUBLIC", os.environ.get("TEMP", "/tmp"))
            for name in ("zj-rpa-session.json", "zj-rpa-last-chat.json", "zj-staging.pid"):
                p = os.path.join(public, name)
                if os.path.exists(p):
                    os.remove(p)
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"clear_session_residue 异常: {exc}", file=sys.stderr)
            return False

    def get_logged_in_account(self) -> Optional[str]:
        """③ 当前已登录账号标识。主窗口在且非登录/隐私锁屏 → 返 expected_account；否则 None。"""
        try:
            from find_weixin import get_main_window, LOGIN_WINDOW_CLASS  # 真机才 import（依赖 Win UIA）
            mw = get_main_window()
            if mw is None:
                return None
            # 若是登录窗（mmui::LoginWindow）说明没真登录进去
            try:
                cls = mw.element_info.class_name
            except Exception:  # noqa: BLE001
                cls = ""
            if cls == LOGIN_WINDOW_CLASS:
                return None
            return os.environ.get("RESET_EXPECTED_ACCOUNT", "测试号_zr")
        except Exception as exc:  # noqa: BLE001
            print(f"get_logged_in_account 异常: {exc}", file=sys.stderr)
            return None

    def get_wechat_version(self) -> Optional[str]:
        """④ 微信版本串。"""
        try:
            from find_weixin import get_weixin_version
            return get_weixin_version()
        except Exception as exc:  # noqa: BLE001
            print(f"get_wechat_version 异常: {exc}", file=sys.stderr)
            return None


def main() -> int:
    expected = os.environ.get("RESET_EXPECTED_ACCOUNT", "测试号_zr")
    print(f"━━━ RPA 复位台：洗回黄金态（expected_account={expected}）━━━")
    result = reset_stage(RealWinDriver(), expected_account=expected)
    if result.ok:
        print(f"✅ 复位绿：账号={result.account} 版本={result.version}")
        return 0
    print(f"❌ 复位红：step={result.failed_step} reason={result.reason}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
