"""
回归测试 — 监听/发送的交互层必须是 **纯 UIA 控件操作**，永久禁止回退到物理鼠标键盘。

【背景】2026-06-05 xian-pc 微信 4.1.8.107 真机验证：
  click_input / send_keys / type_keys 这类 pywinauto 高级物理输入会抢前台、抢光标，
  跟 Agent 其他自动化打架。发送/回复交互层正确做法全部走 UIAPattern：
    - 打开会话：listitem.iface_invoke.Invoke()
    - 填回复：  edit.iface_value.SetValue(text)
    - 点发送：  AttachThreadInput+PostMessage(VK_RETURN)（button.iface_invoke.Invoke 为 fallback）

【SetCursorPos 例外（2026-06-26 rog 真机实证，task 5c6c2e11）】会话列表滚动是唯一例外：
  长列表 PostMessage WM_MOUSEWHEEL 合成滚轮滚到一半卡死（Qt 虚拟列表不 fetch 下一批），
  手鼠标硬件滚轮能滚全 → 滚动必须用真硬件滚轮 SetCursorPos+mouse_event(MOUSEEVENTF_WHEEL)。
  仅限滚动用、扫前后存还原光标、无桌面输入权时回退 PostMessage。故 SetCursorPos 不在黑名单里；
  发送/回复层仍永久禁止任何 click_input/send_keys/type_keys。

本测试用「源码字符串断言 + dryrun mock」两条防线，CI 无微信环境也能跑过：
  1) 源码不得含任何物理输入 API（防回退）。
  2) 源码必须含 iface_invoke / iface_value（证明走 UIA pattern）。
  3) dryrun / mock 路径不依赖真微信，结构正确不抛异常。

【CI 安全】顶层零 pywinauto import（pywinauto 在 macOS import 会失败）；
  交互动作只读源码字符串断言，不真实执行；mock 路径用 WECHAT_DRAFT_API_DRYRUN=1 / REAL_PUBLISH=0。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
SEND_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "send_chat.py")

# 物理输入 API 黑名单：发送/回复交互层一旦回退到这些 pywinauto 高级输入就抢前台/抢光标，永久禁止。
# （SetCursorPos 已移出黑名单——会话列表滚动唯一例外用真硬件滚轮，见文件头说明。）
FORBIDDEN_PHYSICAL_INPUT = ("click_input", "send_keys", "type_keys")
# UIA pattern 白名单：证明交互走的是 InvokePattern / ValuePattern。
REQUIRED_UIA_PATTERNS = ("iface_invoke", "iface_value")


def _read_source(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _strip_nav_reset_functions(src: str) -> str:
    """nav-reset 导航函数例外：从源码移除 _reset_session_list_to_top / _click_welcome_back_screen 的函数体。
    这两个导航辅助函数对 mmui 导航按鈕必须用 click_input()（PostMessage 对 mmui 导航无效，§2.I 07-08）。
    不属于发送/回复交互层禁止范围。
    """
    import re as _re
    # 移除这两个函数体（从 def 开始到下一个 def 之前）
    for func_name in ("_reset_session_list_to_top", "_click_welcome_back_screen"):
        pattern = r"(def " + func_name + r"\b[\s\S]*?)(?=\ndef [^\s])"
        src = _re.sub(pattern, "# [" + func_name + " stripped for nav-reset exception]\n", src)
    return src


def test_listen_chat_no_physical_input():
    """listen_chat.py 不得出现物理鼠标键盘 API（发送/回复交互层防回退）。
    例外：_reset_session_list_to_top / _click_welcome_back_screen 导航辅助函数
    对 mmui 导航按鈕必须用 click_input()（PostMessage 无效，§2.I 07-08 三修自愈C）。
    """
    src = _strip_nav_reset_functions(_read_source(LISTEN_CHAT_PATH))
    for banned in FORBIDDEN_PHYSICAL_INPUT:
        assert banned not in src, f"listen_chat.py 不应出现物理输入 API: {banned}"
def test_send_chat_no_physical_input():
    """send_chat.py 不得出现物理鼠标键盘 API。"""
    src = _read_source(SEND_CHAT_PATH)
    for banned in FORBIDDEN_PHYSICAL_INPUT:
        assert banned not in src, f"send_chat.py 不应出现物理输入 API: {banned}"


def test_listen_chat_uses_uia_patterns():
    """listen_chat.py 必须用 iface_invoke(Invoke) + iface_value(SetValue) —— 证明走 UIA。"""
    src = _read_source(LISTEN_CHAT_PATH)
    for required in REQUIRED_UIA_PATTERNS:
        assert required in src, f"listen_chat.py 必须使用 UIA pattern: {required}"
    assert ".Invoke()" in src, "listen_chat.py 必须调用 InvokePattern.Invoke()"
    assert "SetValue(" in src, "listen_chat.py 必须调用 ValuePattern.SetValue()"


def test_send_chat_delegates_to_uia_reply():
    """send_chat.py 真发路径复用 listen_chat.reply_in_chat（UIA 配方），不自己造物理输入。"""
    src = _read_source(SEND_CHAT_PATH)
    assert "reply_in_chat" in src, "send_chat.py 真发应复用 listen_chat.reply_in_chat（UIA 配方）"


def test_listen_chat_dryrun_inject_mock_path():
    """WECHAT_DRAFT_API_DRYRUN=1 下 post_draft_generate 走 mock，不碰真微信、结构正确。"""
    import listen_chat  # noqa: PLC0415 — 函数体内 import，避免顶层副作用

    os.environ["WECHAT_DRAFT_API_DRYRUN"] = "1"
    try:
        # review 模式 mock
        res = listen_chat.post_draft_generate(
            "http://localhost:3000", "客户A", "wx_a", "你好", mode="review"
        )
        assert res.get("ok") is True
        assert res.get("_mock") is True
        assert "reply" not in res

        # auto 模式 mock 必须额外带 reply 文本（自动回链路用）
        res_auto = listen_chat.post_draft_generate(
            "http://localhost:3000", "客户A", "wx_a", "你好", mode="auto"
        )
        assert res_auto.get("ok") is True
        assert res_auto.get("reply") == "mock_reply"
    finally:
        os.environ.pop("WECHAT_DRAFT_API_DRYRUN", None)


def test_uia_send_no_clipboard():
    """_uia_send 函数体内禁止调用剪贴板路径（_set_clipboard_text / WM_PASTE）。

    背景：PR #717 引入 clipboard+WM_PASTE 违反 wechat-uia-silent-send skill 禁止列表，
    mmui handle=0 时 PostMessage 无声丢弃，消息从未发出。PR #723 整块删除该路径。
    本测试把 skill 的禁止列表变成 CI 强制守卫，防止任何会话重新引入该路径。
    参考：wechat-uia-silent-send skill 变更记录 2026-06。
    注意：检测 `_set_clipboard_text(` 带括号，避免 docstring 禁止说明被误判为实际调用。
    """
    src = _read_source(LISTEN_CHAT_PATH)
    uia_send_start = src.find("def _uia_send")
    assert uia_send_start != -1, "_uia_send 函数必须存在"
    next_def = src.find("\ndef ", uia_send_start + 1)
    uia_send_body = src[uia_send_start:next_def] if next_def != -1 else src[uia_send_start:]
    # 检查实际调用（带括号），不检测 docstring/注释中的字符串提及
    assert "_set_clipboard_text(" not in uia_send_body, (
        "_uia_send 禁止调用 _set_clipboard_text（剪贴板路径依赖前台焦点，后台 session 无效）"
    )
    assert "WM_PASTE" not in uia_send_body, (
        "_uia_send 禁止使用 WM_PASTE(0x0302)（mmui handle=0 时 PostMessage 无声丢弃）"
    )


def test_send_chat_mock_path_no_real_ui():
    """REAL_PUBLISH=0 时 send_chat_message 走 mock 成功路径，不触发任何 UI 自动化。"""
    import send_chat  # noqa: PLC0415

    # 绕过频控（xian-rog 机器上可能有真实状态），确保测试只验证 mock 路径逻辑
    orig_rl = send_chat.rate_limiter
    send_chat.rate_limiter = None
    try:
        res = send_chat.send_chat_message(
            target="客户A", wechat_id="wx_a", message="您好，在的", real_publish=False
        )
    finally:
        send_chat.rate_limiter = orig_rl
    assert res.get("ok") is True
    assert res.get("dryRun") is True
    assert res.get("target") == "客户A"
    assert res.get("message_preview") == "您好，在的"
