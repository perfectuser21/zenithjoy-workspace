#!/usr/bin/env python3
"""
send_moment.py — 朋友圈真发（Path 4 Sprint 1 ws4 待实现）。

ws2 阶段仅占位 stub：
  - 模块函数 send_moment() 占位
  - 保留 --dryrun / --content / --image 参数让 ws4 接手时不破坏 contract
"""
from __future__ import annotations

import argparse
import sys


def send_moment(*_args, **_kwargs):  # pragma: no cover - ws4 实现
    raise NotImplementedError("send_moment() ws4 未实现")


def main() -> int:
    ap = argparse.ArgumentParser(description="WeChat moment send (ws4 stub)")
    ap.add_argument("--dryrun", action="store_true")
    ap.add_argument("--content", type=str, default=None)
    ap.add_argument("--image", type=str, default=None)
    args = ap.parse_args()

    if args.dryrun:
        print('{"ok": false, "reason": "ws2_stub"}')
        return 0

    raise NotImplementedError("send_moment ws4 未实现，ws2 只占位")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
