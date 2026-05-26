"""
services/agent/wechat-rpa — Path 4 Sprint 1 Python RPA 模块包。

ws2 阶段建立完整 __all__ 白名单和占位 stub。
ws3-5 各自填实现：
  - ws3：listen_chat（私聊监听 + DeepSeek 草稿）
  - ws4：send_moment（朋友圈草稿 + 真发）
  - ws5：send_chat（私聊真发） + rate_limiter（每日上限 + 时段窗口） + find_weixin（窗口寻址）
"""

__all__ = [
    "qr_bind",
    "listen_chat",
    "send_chat",
    "send_moment",
    "rate_limiter",
    "find_weixin",
]
