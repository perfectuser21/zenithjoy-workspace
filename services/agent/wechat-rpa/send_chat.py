#!/usr/bin/env python3
"""
send_chat.py — 私聊真发（Path 4 Sprint 1 ws5 待实现）。

ws2 阶段仅占位 stub：
  - 模块函数 send_chat() 占位
  - 保留 --dryrun / --to / --content 参数让 ws5 接手时不破坏 contract
"""
from __future__ import annotations

import argparse
import sys


def send_chat(*_args, **_kwargs):  # pragma: no cover - ws5 实现
    raise NotImplementedError("send_chat() ws5 未实现")


def main() -> int:
    ap = argparse.ArgumentParser(description="WeChat private chat send (ws5 stub)")
    ap.add_argument("--dryrun", action="store_true")
    ap.add_argument("--to", type=str, default=None)
    ap.add_argument("--content", type=str, default=None)
    args = ap.parse_args()

    if args.dryrun:
        # ws2 占位：dryrun 也不真做事，返回未实现
        print('{"ok": false, "reason": "ws2_stub"}')
        return 0

    raise NotImplementedError("send_chat ws5 未实现，ws2 只占位")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
