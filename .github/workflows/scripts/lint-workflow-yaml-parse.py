#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L1 机械闸：.github/workflows/ 下所有 workflow 文件必须可被 YAML 解析。

背景（2026-07-06 实证）：agent-preflight-hardening-e2e.yml / cleanup-merged-artifacts.yml
因 run 块内顶格行破坏 block scalar，GitHub 无法解析 → 每次 push 生成无 job 的红 run，
且 paths 过滤失效，21/21 全红无人管。坏 YAML 必须在 PR 阶段拦下。
"""
import glob
import sys

import yaml

def main() -> int:
    paths = sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"))
    if not paths:
        print("FAIL: 未找到任何 workflow 文件（脚本跑错目录？）")
        return 1
    bad = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                yaml.safe_load(fh)
        except yaml.YAMLError as exc:
            bad.append((path, str(exc)))
    for path, err in bad:
        print(f"FAIL {path}\n{err}\n")
    if bad:
        print(f"{len(bad)} 个 workflow YAML 解析失败：坏文件会让每次 push 秒红且 paths 过滤失效")
        return 1
    print(f"OK: {len(paths)} 个 workflow YAML 全部可解析")
    return 0

if __name__ == "__main__":
    sys.exit(main())
