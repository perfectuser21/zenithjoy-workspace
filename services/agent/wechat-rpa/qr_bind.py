#!/usr/bin/env python3
"""
qr_bind.py — 微信扫码绑号脚本（Path 4 ws1 stub）。

ws1 阶段只实现 --dryrun 模式：输出 mock JSON，让 ws1 handler 端到端测试通过。
ws2 会重写完整版：真启 PC 微信 + 等弹码 + 等扫码成功 + 输出 wechat_id/nickname。

约定：
  - stdin 喂 JSON payload（可忽略）
  - stdout **最后一行** 输出 receipt JSON
  - 退出码 0 = 成功

ws1 接受参数：
  --dryrun                 (CI / 单测专用) 不真启微信，输出 mock JSON
  --simulate-no-wechat     模拟微信未装 → ok:false (ws2 完整实现)

ws1 stub 仅实现 --dryrun。其他参数将在 ws2 增强。
"""
import argparse
import json
import sys


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="WeChat QR bind (ws1 stub)")
    ap.add_argument("--dryrun", action="store_true", help="dry-run mode (mock output)")
    ap.add_argument(
        "--simulate-no-wechat",
        action="store_true",
        help="simulate WeChat not running (ws2 full impl)",
    )
    return ap.parse_args()


def main() -> int:
    args = parse_args()

    # 即使 stdin 没东西也无所谓
    try:
        sys.stdin.read()
    except Exception:
        pass

    if args.simulate_no_wechat:
        out = {"ok": False, "reason": "wechat_not_running"}
        print(json.dumps(out, ensure_ascii=False))
        return 0

    if args.dryrun:
        out = {
            "ok": True,
            "dryRun": True,
            "wechat_id": "test_wechat_001",
            "nickname": "测试号",
        }
        print(json.dumps(out, ensure_ascii=False))
        return 0

    # 非 dryrun 真启微信 ws2 会写
    out = {
        "ok": False,
        "reason": "ws1_stub_real_mode_not_implemented",
        "hint": "use --dryrun in ws1; ws2 will implement real PC WeChat launch",
    }
    print(json.dumps(out, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
