#!/usr/bin/env bash
# lint-nightly-sparse-checkout-deps.sh
#
# 回归守卫：nightly 真机 wechat-bubble job 的 sparse-checkout 列表必须覆盖
# selfcheck_bubbles.py 通过 sys.path 注入的全部仓内依赖目录。
#
# 背景（2026-08-16，issue #1639 / Brain task 3cec9be4）：PR#1596（07-30）为解决 rog 出境网络
# 慢把该 job 改成 sparse-checkout 只拉 services/agent/tools；而 selfcheck_bubbles.py:28-30 把
# ../wechat-rpa 插进 sys.path 并 import listen_chat/find_weixin → 目录没拉下来 → 每晚
# ModuleNotFoundError("No module named 'listen_chat'")，连红 17 晚，Line04 真机健康信号全盲。
# 本守卫把"脚本依赖了什么目录"和"workflow 拉了什么目录"两边机械对账，任何一边改动都在 PR 当场报红。
#
# 用法：bash lint-nightly-sparse-checkout-deps.sh [workflow文件] [脚本文件]
# 默认：.github/workflows/nightly-real-machine-staging.yml  services/agent/tools/selfcheck_bubbles.py
# 退出码：0 通过 / 1 失败

set -euo pipefail

WF="${1:-.github/workflows/nightly-real-machine-staging.yml}"
SCRIPT="${2:-services/agent/tools/selfcheck_bubbles.py}"
JOB="${LINT_SPARSE_JOB:-wechat-bubble}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Lint — nightly sparse-checkout 依赖对账"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$WF" ]; then
  echo "::error::守卫目标 workflow 不存在: $WF"
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "::error::守卫目标脚本不存在: $SCRIPT"
  exit 1
fi

python3 - "$WF" "$SCRIPT" "$JOB" <<'PY'
import os, re, sys

wf, script, job = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(wf, encoding="utf-8").read().split("\n")

def indent(s):
    return len(s) - len(s.lstrip(" "))

# 1) 定位 jobs.<job>: 块
job_start = None
for i, ln in enumerate(lines):
    if indent(ln) == 2 and ln.strip() == f"{job}:":
        job_start = i
        break
if job_start is None:
    print(f"::error file={wf}::找不到 job `{job}:`（缩进 2 空格）——守卫对象改名了？请同步 LINT_SPARSE_JOB")
    sys.exit(1)
job_end = len(lines)
for i in range(job_start + 1, len(lines)):
    ln = lines[i]
    if ln.strip() == "" or ln.lstrip().startswith("#"):
        continue
    if indent(ln) <= 2:
        job_end = i
        break
job_block = lines[job_start:job_end]

# 2) 抠出 sparse-checkout: | 块下面的目录列表
sparse = []
in_sparse = False
sparse_indent = None
for ln in job_block:
    s = ln.strip()
    if not in_sparse:
        if s.startswith("sparse-checkout:"):
            in_sparse = True
            sparse_indent = indent(ln)
            # 同行 inline 值（如 sparse-checkout: services/agent/tools）也接受
            rest = s[len("sparse-checkout:"):].strip()
            if rest and rest != "|":
                sparse.append(rest.strip("'\""))
                in_sparse = False
        continue
    if s == "" or s.startswith("#"):
        continue
    if indent(ln) <= sparse_indent:
        in_sparse = False
        continue
    sparse.append(s.strip("'\"").rstrip("/"))
if not sparse:
    print(f"::error file={wf}::job `{job}` 没有 sparse-checkout 块（或为空）——若已改回整仓 checkout 请删除本守卫的调用")
    sys.exit(1)

# 3) 解析脚本里的 sys.path 依赖：os.path.join(_HERE, "..", "<dir>") 形态
src = open(script, encoding="utf-8").read()
script_dir = os.path.dirname(script).rstrip("/")            # services/agent/tools
required = {script_dir}
for m in re.finditer(r'os\.path\.join\(\s*_HERE\s*,\s*((?:"[^"]+"\s*,?\s*)+)\)', src):
    parts = [p.strip().strip('"') for p in m.group(1).split(",") if p.strip()]
    d = os.path.normpath(os.path.join(script_dir, *parts))
    required.add(d)

# 4) 对账：每个依赖目录必须被某个 sparse 项前缀覆盖（非 cone 模式 = 路径前缀）
def covered(d):
    return any(d == s or d.startswith(s + "/") for s in sparse)

missing = sorted(d for d in required if not covered(d))
print(f"sparse 列表: {sparse}")
print(f"脚本依赖目录: {sorted(required)}")
if missing:
    for d in missing:
        print(f"::error file={wf}::job `{job}` 的 sparse-checkout 未覆盖 {script} 依赖的目录 `{d}`")
    print("")
    print("为什么有这条规则：PR#1596 把该 job 改成 sparse-checkout 后漏了 services/agent/wechat-rpa，")
    print("selfcheck_bubbles.py import listen_chat 必炸，nightly 连红 17 晚（issue #1639）。")
    print("修法：在该 job 的 sparse-checkout 列表加上缺的目录，或改脚本不再依赖它。")
    sys.exit(1)
print("✅ sparse-checkout 覆盖了脚本全部依赖目录")
PY
