"""
回归测试 — 监听/发送的交互层必须是 **纯 UIA 控件操作**，永久禁止回退到物理鼠标键盘。

【背景】2026-06-05 xian-pc 微信 4.1.8.107 真机验证：
  click_input / send_keys / type_keys / SetCursorPos 这类物理输入会抢前台、抢光标，
  跟 Agent 其他自动化打架，且跨会话被拒（SetCursorPos access denied）。
  正确做法全部走 UIAPattern：
    - 打开会话：listitem.iface_invoke.Invoke()
    - 填回复：  edit.iface_value.SetValue(text)
    - 点发送：  AttachThreadInput+PostMessage(VK_RETURN)（button.iface_invoke.Invoke 为 fallback）

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

# 物理输入 API 黑名单：一旦交互层回退到这些就抢前台/抢光标，永久禁止出现在实现代码里。
FORBIDDEN_PHYSICAL_INPUT = ("click_input", "send_keys", "type_keys", "SetCursorPos")
# UIA pattern 白名单：证明交互走的是 InvokePattern / ValuePattern。
REQUIRED_UIA_PATTERNS = ("iface_invoke", "iface_value")


def _read_source(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_listen_chat_no_physical_input():
    """listen_chat.py 不得出现物理鼠标键盘 API（防回退到抢前台的输入方式）。"""
    src = _read_source(LISTEN_CHAT_PATH)
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


def test_send_chat_mock_path_no_real_ui():
    """REAL_PUBLISH=0 时 send_chat_message 走 mock 成功路径，不触发任何 UI 自动化。"""
    import send_chat  # noqa: PLC0415

    res = send_chat.send_chat_message(
        target="客户A", wechat_id="wx_a", message="您好，在的", real_publish=False
    )
    assert res.get("ok") is True
    assert res.get("dryRun") is True
    assert res.get("target") == "客户A"
    assert res.get("message_preview") == "您好，在的"
