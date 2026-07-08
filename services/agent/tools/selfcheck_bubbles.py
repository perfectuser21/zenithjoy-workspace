# -*- coding: utf-8 -*-
"""真机气泡可读性 CI gate（xian-rog self-hosted runner 专用）。

守卫的接缝：listen_chat 的"打开会话 → read_chat_bubbles 读真实气泡 → 方向判定"
在**真微信窗口**上必须工作。这是 2026-07-02"连发5条只回1条+闪屏死循环"事故的
根因接缝——旧代码只读 Text 控件在真机上一条气泡都读不到，而 CI 的 Fake 注入
pytest 全绿，带病合入。本 gate 让这类回归在 PR 阶段就报红。

流程（对"文件传输助手"操作，不碰客户会话）：
  1. 找微信主窗口（mmui）
  2. _open_chat 打开"文件传输助手"，reply_in_chat 真发一条带时间戳的 marker
  3. read_chat_bubbles 读回气泡，断言：
     a. 气泡数 ≥ 1（List("消息") ListItem 可读——核心回归点）
     b. marker 文本出现在气泡里
     c. marker 方向 = outgoing（已发送文本历史判向链路工作）
  4. 结果写 JSON 到 C:\\Users\\Public\\zj-bubble-gate.json（exit 0/1）

必须在 session 1（GUI）跑：workflow 里用 PsExec64 -i 1 包一层。
"""
from __future__ import annotations

import json
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT_RPA = os.path.abspath(os.path.join(_HERE, "..", "wechat-rpa"))
if _WECHAT_RPA not in sys.path:
    sys.path.insert(0, _WECHAT_RPA)

OUT_PATH = os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"),
                        "zj-bubble-gate.json")
TARGET = "文件传输助手"

# 找窗口有界重试：覆盖微信启动/树重建瞬态（≥60s），但别无限等（≤180s）
FIND_WINDOW_RETRIES = 6
FIND_WINDOW_RETRY_DELAY_S = 12.0

# 找会话列表 item 有界重试：先做几次廉价重试，覆盖极端情况下虚拟列表还没挂出来的瞬态。
FIND_ITEM_RETRIES = 5
FIND_ITEM_RETRY_DELAY_S = 2.0


def find_target_item(descendants, target):
    """纯函数（CI 可测）：在一批 ListItem 里找 name 以 target 开头的那个。

    descendants：ListItem 对象序列，每个须有 element_info.name（缺失/异常时跳过该项）。
    找不到返回 None。
    """
    for it in descendants:
        try:
            nm = it.element_info.name or ""
        except Exception:
            continue
        if nm.startswith(target):
            return it
    return None


def find_item_with_recovery(mw, target, retries, retry_delay_s, sleep_fn, reset_fn):
    """真根因修法（2026-07-08 rog 实证，session-1 诊断亲眼确认）：先做几轮廉价重试
    （覆盖极端渲染瞬态），仍找不到就调用 reset_fn（真机上是
    listen_chat._reset_session_list_to_top）尝试恢复后再补查一次。

    真根因不是渲染时序：上一轮 reply_in_chat 若发送成功但送达确认超时会
    return False，跳过收尾的 _navigate_away，把窗口留在已打开的目标聊天面板；
    这时 mw.descendants(ListItem) 枚举到的是聊天气泡（"[bubble-gate] <ts>"/
    时间戳），不是会话列表条目，目标联系人自然永远"找不到"——纯重试没用，
    等的是压根不会变化的错误视图，必须主动切 tab 强制视图重建。

    纯逻辑（CI 可测，mw/sleep_fn/reset_fn 全部注入）：mw 只需支持
    `descendants(control_type=...)`；reset_fn(mw) -> bool 模拟
    _reset_session_list_to_top 的返回。
    """
    item = find_target_item(mw.descendants(control_type="ListItem"), target)
    if item is not None:
        return item, "first_try"
    for i in range(retries):
        sleep_fn(retry_delay_s)
        item = find_target_item(mw.descendants(control_type="ListItem"), target)
        if item is not None:
            return item, f"retry_{i + 1}"
    try:
        if reset_fn(mw):
            sleep_fn(1.0)
            item = find_target_item(mw.descendants(control_type="ListItem"), target)
            if item is not None:
                return item, "reset_recovery"
    except Exception:
        pass
    return None, "not_found"


def classify_no_window(process_running: bool) -> tuple:
    """重试耗尽仍找不到 mmui 主窗口时，把「微信没跑」和「UIA 死区」分开报。

    2026-07-06 实证：rog UIA 死区 ~40h（微信启动时 SPI 标志未置位→树不构建），
    期间 gate 笼统报「微信没跑或没登录」误导运营（微信明明登录着）。
    """
    if not process_running:
        return ("NO_PROCESS", "Weixin.exe 未运行 - 请在 runner 机启动并登录微信")
    return (
        "UIA_DEAD",
        "微信进程在但 UIA 找不到主窗口(mmui) - UIA 死区(启动时无障碍标志未置位)，"
        "需重启微信/等待 listener 自愈(issue e6203ac4)",
    )


def _weixin_process_running() -> bool:
    import subprocess
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Weixin.exe"],
            capture_output=True, text=True, timeout=15,
        ).stdout or ""
        return "Weixin.exe" in out
    except Exception:
        return True  # 查不出进程时保守当作在跑 → 走 UIA_DEAD 分支（宁可报死区不误报没跑）


def _write(result: dict) -> None:
    try:
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def main() -> int:
    result = {
        "ok": False, "err": None, "bubble_count": 0,
        "marker_found": False, "marker_outgoing": False,
    }
    try:
        import listen_chat
        import find_weixin

        # 先加载已发送历史（v1.0.98 防御）：本进程 reply_in_chat 会 _record_sent_text，
        # 不加载会把监听进程的历史文件覆盖成一条（2026-07-03 08:49 事故）。
        listen_chat._SENT_TEXTS[:] = listen_chat._load_sent_texts()

        # 找主窗口必须用 find_weixin.get_main_window()（精确匹配 mmui::MainWindow /
        # Qt5 frame class），不能自己重写一套宽松匹配。2026-07-08 rog 实证：旧代码
        # 这里曾经是 `"mmui" in cls.lower()` 子串匹配，微信支持把某个聊天双击弹出成
        # 独立小窗口，这类弹窗的 class name 里同样带"mmui"字样——宽松匹配把它错认成
        # 主窗口，抓到的自然只有那个聊天的气泡（没有联系人列表/左侧导航），
        # 会话列表永远"找不到"。get_main_window() 精确匹配主窗口 class，不会认错。
        mw = find_weixin.get_main_window()
        if mw is None:
            # 有界重试：先设 SPI 屏幕阅读器标志（幂等），再等树/窗口就绪
            try:
                listen_chat._activate_uia()
            except Exception:
                pass
            for i in range(FIND_WINDOW_RETRIES):
                time.sleep(FIND_WINDOW_RETRY_DELAY_S)
                mw = find_weixin.get_main_window()
                if mw is not None:
                    print(f"[bubble-gate] window found after retry {i + 1}")
                    break
        if mw is None:
            code, msg = classify_no_window(_weixin_process_running())
            result["err"] = f"no wechat window (mmui) [{code}] {msg}"
            _write(result)
            return 1

        item, how = find_item_with_recovery(
            mw, TARGET, FIND_ITEM_RETRIES, FIND_ITEM_RETRY_DELAY_S,
            time.sleep, listen_chat._reset_session_list_to_top,
        )
        if item is not None and how != "first_try":
            print(f"[bubble-gate] {TARGET} found via {how}")
        if item is None:
            result["err"] = f"session list 里找不到 {TARGET}"
            _write(result)
            return 1

        marker = f"[bubble-gate] {int(time.time())}"
        result["marker"] = marker
        if not listen_chat.reply_in_chat(mw, item, marker, sender=TARGET):
            result["err"] = "reply_in_chat 发送 marker 失败（未 DELIVERED）"
            _write(result)
            return 1

        # 发送把已发送文本记入 _SENT_TEXTS（判向锚点）；重新打开会话读气泡
        if not listen_chat._open_chat(mw, item, TARGET):
            result["err"] = f"_open_chat 重开 {TARGET} 失败"
            _write(result)
            return 1
        time.sleep(1.0)
        bubbles = []
        for _ in range(5):
            bubbles = listen_chat.read_chat_bubbles(mw)
            if bubbles:
                break
            time.sleep(0.6)
        result["bubble_count"] = len(bubbles)
        result["bubbles_tail"] = [
            {"text": b["text"][:40], "direction": b["direction"]}
            for b in bubbles[-5:]
        ]
        if not bubbles:
            result["err"] = ("read_chat_bubbles 在真微信上读到 0 条气泡"
                             "（= 2026-07-02 连发5条只回1条事故的根因回归）")
            _write(result)
            return 1
        for b in bubbles:
            if marker in (b.get("text") or ""):
                result["marker_found"] = True
                result["marker_outgoing"] = b.get("direction") == "outgoing"
                break
        if not result["marker_found"]:
            result["err"] = "刚发送的 marker 没出现在气泡里（读取不含最新消息）"
            _write(result)
            return 1
        if not result["marker_outgoing"]:
            result["err"] = "marker 方向≠outgoing（已发送文本判向链路断了）"
            _write(result)
            return 1
        result["ok"] = True
        _write(result)
        return 0
    except Exception as e:
        result["err"] = repr(e)
        _write(result)
        return 1


if __name__ == "__main__":
    sys.exit(main())
