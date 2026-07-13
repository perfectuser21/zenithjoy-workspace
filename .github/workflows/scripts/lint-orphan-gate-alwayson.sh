#!/usr/bin/env bash
# lint-orphan-gate-alwayson.sh
#
# 回归守卫：orphan E2E workflow 必须【无条件触发】（on.pull_request 下不得有 paths 过滤）。
#
# 背景（2026-07-13 用户拍板「焊死」）：orphan-e2e-gate 是 main 的 required check。
# 若有人给本 workflow 的 pull_request 触发塞回 `paths:` 过滤，那些不匹配 paths 的 PR
# 将不触发本 workflow → gate context 永不上报 → required check 永久 pending → PR 卡死无法合并。
# 这正是「required + paths 冲突」陷阱。本守卫在 gate job 自身里跑（与被守护对象同工作流、
# 随 gate 一起进 required 被真卡），任何塞回 paths 的改动会在引入它的那个 PR 当场报红。
#
# 用法：bash lint-orphan-gate-alwayson.sh [workflow文件路径]
# 默认检查 .github/workflows/e2e-orphan-consolidation-windows.yml

set -euo pipefail

WF="${1:-.github/workflows/e2e-orphan-consolidation-windows.yml}"

if [ ! -f "$WF" ]; then
  echo "::error::守卫目标 workflow 不存在: $WF"
  exit 1
fi

python3 - "$WF" <<'PY'
import sys

wf = sys.argv[1]
lines = open(wf, encoding="utf-8").read().split("\n")

def indent(s):
    return len(s) - len(s.lstrip(" "))

# 定位顶层 `on:` 块
on_start = None
for i, ln in enumerate(lines):
    if indent(ln) == 0 and (ln.rstrip() == "on:" or ln.rstrip().startswith("on:")):
        on_start = i
        break

if on_start is None:
    print(f"::error::{wf} 没有找到顶层 on: 触发块")
    sys.exit(1)

# on: 块范围 = 直到下一个 0 缩进的顶层 key
on_end = len(lines)
for i in range(on_start + 1, len(lines)):
    ln = lines[i]
    if ln.strip() == "" or ln.lstrip().startswith("#"):
        continue
    if indent(ln) == 0:
        on_end = i
        break
on_block = lines[on_start:on_end]

# 断言 pull_request 存在（无条件触发的前提之一）
has_pr = any(indent(ln) == 2 and ln.strip().rstrip(":") == "pull_request" for ln in on_block)
if not has_pr:
    print(f"::error::{wf} 的 on: 块缺少 pull_request 触发——gate 无法在 PR 上产出 required context")
    sys.exit(1)

# 找 pull_request 子块（缩进 2），检查其内部（缩进 >2）有没有 paths / paths-ignore
violations = []
i = 0
while i < len(on_block):
    ln = on_block[i]
    if indent(ln) == 2 and ln.strip().rstrip(":") == "pull_request":
        j = i + 1
        while j < len(on_block):
            sub = on_block[j]
            if sub.strip() == "" or sub.lstrip().startswith("#"):
                j += 1
                continue
            if indent(sub) <= 2:
                break
            key = sub.strip().rstrip(":")
            if key in ("paths", "paths-ignore"):
                violations.append((on_start + j + 1, sub.strip()))
            j += 1
        i = j
        continue
    i += 1

if violations:
    for lineno, txt in violations:
        print(f"::error file={wf},line={lineno}::orphan gate 是 required check，"
              f"pull_request 触发禁止 paths 过滤（发现 `{txt}`）——会让非匹配 PR 永久 pending 卡死合并")
    print(f"守卫失败：{wf} 的 pull_request 触发被塞回了 paths 过滤")
    sys.exit(1)

print(f"✓ 守卫通过：{wf} 无条件触发（pull_request 无 paths 过滤），required gate 不会挂 pending")
PY
