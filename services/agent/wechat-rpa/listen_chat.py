#!/usr/bin/env python3
"""
listen_chat.py — 私聊监听（Path 4 Sprint 1 ws3 待实现）。

ws2 阶段仅占位 stub：
  - 命令行调用直接 raise NotImplementedError
  - 模块函数 listen() 占位
  - 保留 --dryrun / --inject-message / --dryrun-print-version 参数让 ws3 接手时不破坏 contract
"""
from __future__ import annotations

import argparse
import sys


def listen(*_args, **_kwargs):  # pragma: no cover - ws3 实现
    raise NotImplementedError("listen_chat.listen() ws3 未实现")


def main() -> int:
    ap = argparse.ArgumentParser(description="WeChat private chat listener (ws3 stub)")
    ap.add_argument("--dryrun", action="store_true")
    ap.add_argument("--inject-message", type=str, default=None)
    ap.add_argument("--dryrun-print-version", action="store_true")
    args = ap.parse_args()

    if args.dryrun_print_version:
        sys.stderr.write("wxauto4 not available: ws2 stub\n")
        return 0

    raise NotImplementedError("listen_chat ws3 未实现，ws2 只占位")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
