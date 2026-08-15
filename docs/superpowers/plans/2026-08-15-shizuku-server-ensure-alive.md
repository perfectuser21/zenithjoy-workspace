# Shizuku Shell Server 存活保障脚本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增两个纯 bash 文件，让 rog/pc4 机队控制机能在 Shizuku shell server 重启后消失时检测并重新拉起它，全程无需人工干预。

**Architecture:** 一个纯函数库（`ensure-shizuku-server.sh`，两个可脱离真机单测的纯字符串处理函数 + 一个调真实 adb 的胶水函数）+ 一份对齐仓库既有 `dedupe-adb-devices-lib-smoke.sh` 风格的手写 bash 回归测试。新测试脚本需登记进 `smoke-baseline.txt` 才会被 CI 当作必绿项执行。

**Tech Stack:** Bash（POSIX 兼容函数库，`set -euo pipefail` 仅用于测试脚本本身，lib 文件不设，因为要被 `source` 进调用方且函数需要能正常 `return 1` 而不炸整个 shell）

**参考设计文档：** `docs/superpowers/specs/2026-08-15-shizuku-server-ensure-alive-design.md`

---

## Task 1: 先写失败的回归测试（commit-1）

> **TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。这一步结束时 lib 文件还不存在，测试必须真实报错失败，不能靠猜。**

**Files:**
- Create: `.github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh`

- [ ] **Step 1: 写测试文件**

```bash
#!/usr/bin/env bash
# ensure-shizuku-server-lib-smoke.sh — shizuku_server_alive / resolve_shizuku_starter_path 回归测试
#
# 背景：2026-08-15 真机 spike（决策 78bd0467→799ad215→1fe3c420）验证 Shizuku shell 权限级
# input tap 可行，但 shizuku_server 进程重启后消失，须重新用 adb 拉起。范围限定 rog/pc4
# 常驻机队，本测试只覆盖两个可脱离真机单测的纯函数；ensure_shizuku_server 胶水函数调真实
# adb，不在本测试覆盖范围（同目录 dedupe_adb_devices 的胶水调用方也是同理直接写 CI 内联）。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/ensure-shizuku-server.sh"

# 场景1：ps -A 输出含 shizuku_server 一行 → 判定存活
PS_ALIVE=$'u0_a248      25041  1474   17379368 217696 0                   0 S moe.shizuku.privileged.api\nshell        27789     1   15649512 128392 __arm64_sys_epoll_pwait 0 S shizuku_server'
if shizuku_server_alive "$PS_ALIVE"; then
  echo "✅ 场景1通过：ps 输出含 shizuku_server 一行，判定存活"
else
  echo "❌ FAIL 场景1: ps 输出含 shizuku_server 一行，应判定存活，实际判定不存活"
  exit 1
fi

# 场景2：ps -A 输出不含 shizuku_server → 判定不存活
PS_DEAD=$'u0_a248      25041  1474   17379368 217696 0                   0 S moe.shizuku.privileged.api\nroot           1     0    12345   6789 0                   0 S init'
if shizuku_server_alive "$PS_DEAD"; then
  echo "❌ FAIL 场景2: ps 输出不含 shizuku_server，应判定不存活，实际判定存活"
  exit 1
else
  echo "✅ 场景2通过：ps 输出不含 shizuku_server，判定不存活"
fi

# 场景3：pm path 正常单行 base.apk → 正确替换出 libshizuku.so 路径
PM_PATH_SINGLE='package:/data/app/~~wAU6GecpzyvrrGkvNiGGlw==/moe.shizuku.privileged.api-1jayn3pBvt2cwpGOGmRNaA==/base.apk'
RESULT3=$(resolve_shizuku_starter_path "$PM_PATH_SINGLE")
EXPECTED3='/data/app/~~wAU6GecpzyvrrGkvNiGGlw==/moe.shizuku.privileged.api-1jayn3pBvt2cwpGOGmRNaA==/lib/arm64/libshizuku.so'
[ "$RESULT3" = "$EXPECTED3" ] || { printf '❌ FAIL 场景3: 期望:\n%s\n实得:\n%s\n' "$EXPECTED3" "$RESULT3"; exit 1; }
echo "✅ 场景3通过：正常单行 base.apk 正确解析出 libshizuku.so 路径"

# 场景4：pm path 空输入（App 未安装）→ 空输出 + 失败
RESULT4=$(resolve_shizuku_starter_path "" || true)
[ -z "$RESULT4" ] || { echo "❌ FAIL 场景4: 空输入应输出为空，实得: $RESULT4"; exit 1; }
if resolve_shizuku_starter_path "" >/dev/null 2>&1; then
  echo "❌ FAIL 场景4: 空输入应 return 非 0（失败），实际 return 0"
  exit 1
fi
echo "✅ 场景4通过：pm path 空输入正确判定失败（App 未安装）"

# 场景5：pm path 多行（AAB 分包含 split_config apk）→ 仍正确挑出 base.apk 那行
PM_PATH_MULTI=$'package:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/split_config.arm64_v8a.apk\npackage:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/base.apk\npackage:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/split_config.zh.apk'
RESULT5=$(resolve_shizuku_starter_path "$PM_PATH_MULTI")
EXPECTED5='/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/lib/arm64/libshizuku.so'
[ "$RESULT5" = "$EXPECTED5" ] || { printf '❌ FAIL 场景5: 期望:\n%s\n实得:\n%s\n' "$EXPECTED5" "$RESULT5"; exit 1; }
echo "✅ 场景5通过：多行输出（含 split apk）仍正确挑出 base.apk 那行"

echo "🎉 PASS: ensure-shizuku-server 纯函数回归通过"
```

- [ ] **Step 2: 赋可执行权限**

Run: `chmod +x .github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh`

- [ ] **Step 3: 跑测试，确认它真实失败**

Run: `bash .github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh`

Expected: 报错退出，形如：
```
.github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh: line X: .github/workflows/scripts/smoke/lib/ensure-shizuku-server.sh: No such file or directory
```
（因为 `lib/ensure-shizuku-server.sh` 此时还不存在，`source` 失败，`set -e` 让脚本以非 0 退出码结束）——这就是本 task 要的"failing test"，不需要额外制造，`source` 一个不存在的文件天然就是失败的。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh
git commit -m "test: Shizuku shell server 存活判定回归测试（先行失败）"
```

---

## Task 2: 实现函数库让测试变绿 + 登记进 CI 基线（commit-2）

**Files:**
- Create: `.github/workflows/scripts/smoke/lib/ensure-shizuku-server.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（追加一行）

- [ ] **Step 1: 写实现文件**

```bash
#!/usr/bin/env bash
# ensure-shizuku-server.sh — Shizuku shell server 存活判定 + 拉起（rog/pc4 常驻机队专用）
#
# 背景：2026-08-15 真机 spike（决策 78bd0467→799ad215→1fe3c420）已验证 Shizuku shell
# 权限级 input tap 可行，但 shizuku_server 进程重启后会消失，必须重新用 adb 拉起
# （Shizuku 官方文档原话："这个过程每次设备重新启动后需要重新进行"）。范围明确限定
# rog/pc4 常驻测试机队（adb 访问在这两台机器上是常驻的），不覆盖脱离机队的远程设备。
# 不建常驻 60s 轮询 daemon——当前没有生产流程消费 Shizuku，先把"能可靠拉起"这个能力
# 做扎实即可（thin 优先）。

# shizuku_server_alive — 判断 adb shell ps -A 的文本输出里有没有 shizuku_server 进程。
# 用法：shizuku_server_alive "$ps_output"；含有则 return 0，不含则 return 1。
shizuku_server_alive() {
  local ps_output="$1"
  printf '%s\n' "$ps_output" | grep -qw 'shizuku_server'
}

# resolve_shizuku_starter_path — 从 adb shell pm path moe.shizuku.privileged.api 的文本
# 输出里解析出 libshizuku.so 启动器路径。
#
# 输入可能是单行，也可能因为 AAB 分包安装而是多行（base.apk + 若干 split_config.*.apk）；
# 只有以 base.apk 结尾的那一行是我们要的（split apk 不含 lib 目录）。把该行路径里的
# "/base.apk" 替换成 "/lib/arm64/libshizuku.so" 后输出到 stdout。
#
# 空输入（App 未安装）或找不到 base.apk 行 → 不输出，return 1。
resolve_shizuku_starter_path() {
  local pm_path_output="$1"
  [ -z "$pm_path_output" ] && return 1

  local base_line
  base_line=$(printf '%s\n' "$pm_path_output" | grep '/base\.apk$' | head -n 1)
  [ -z "$base_line" ] && return 1

  local apk_path="${base_line#package:}"
  printf '%s\n' "${apk_path%/base.apk}/lib/arm64/libshizuku.so"
}

# ensure_shizuku_server — 胶水函数：确保指定 serial 的设备上 shizuku_server 处于存活状态，
# 不存活就重新拉起。调用真实 adb，不在纯函数单测覆盖范围（同目录 dedupe_adb_devices 的
# 胶水调用方也是直接写 CI 内联，不额外造一层 mock）。
#
# 用法：ensure_shizuku_server "<adb serial>"；成功（已存活或成功拉起）return 0，
# 失败（设备未就绪 / App 未安装 / 拉起后仍不存活）return 1，失败原因打到 stderr。
ensure_shizuku_server() {
  local serial="$1"

  local state
  state=$(adb -s "$serial" get-state 2>/dev/null || echo "")
  if [ "$state" != "device" ]; then
    echo "ensure_shizuku_server: 设备 $serial 状态非 device（实际: ${state:-unknown}），跳过" >&2
    return 1
  fi

  local ps_output
  ps_output=$(adb -s "$serial" shell ps -A 2>/dev/null || echo "")
  if shizuku_server_alive "$ps_output"; then
    return 0
  fi

  local pm_path_output
  pm_path_output=$(adb -s "$serial" shell pm path moe.shizuku.privileged.api 2>/dev/null || echo "")
  local starter_path
  starter_path=$(resolve_shizuku_starter_path "$pm_path_output") || {
    echo "ensure_shizuku_server: 设备 $serial 上解析不出 libshizuku.so 路径（App 未安装？）" >&2
    return 1
  }

  adb -s "$serial" shell "$starter_path" >/dev/null 2>&1

  local ps_output_after
  ps_output_after=$(adb -s "$serial" shell ps -A 2>/dev/null || echo "")
  if shizuku_server_alive "$ps_output_after"; then
    return 0
  fi

  echo "ensure_shizuku_server: 设备 $serial 执行拉起命令后 shizuku_server 仍不存活" >&2
  return 1
}
```

- [ ] **Step 2: 赋可执行权限**

Run: `chmod +x .github/workflows/scripts/smoke/lib/ensure-shizuku-server.sh`

- [ ] **Step 3: 跑测试，确认全绿**

Run: `bash .github/workflows/scripts/smoke/ensure-shizuku-server-lib-smoke.sh`

Expected:
```
✅ 场景1通过：ps 输出含 shizuku_server 一行，判定存活
✅ 场景2通过：ps 输出不含 shizuku_server，判定不存活
✅ 场景3通过：正常单行 base.apk 正确解析出 libshizuku.so 路径
✅ 场景4通过：pm path 空输入正确判定失败（App 未安装）
✅ 场景5通过：多行输出（含 split apk）仍正确挑出 base.apk 那行
🎉 PASS: ensure-shizuku-server 纯函数回归通过
```

- [ ] **Step 4: 登记进 CI 基线棘轮闸**

`.github/workflows/scripts/smoke-baseline.txt` 是纯文本文件，一行一个脚本文件名（不带
路径），`ci-smoke-glob-runner.yml` 的 baseline-lint job 强制新脚本必须登记，否则 PR 检查
会报错。在文件里 `dedupe-adb-devices-lib-smoke.sh` 那一行之后追加新行：

```bash
sed -i.bak '/^dedupe-adb-devices-lib-smoke\.sh$/a\
ensure-shizuku-server-lib-smoke.sh
' .github/workflows/scripts/smoke-baseline.txt
rm .github/workflows/scripts/smoke-baseline.txt.bak
```

Verify:
```bash
grep -n "ensure-shizuku-server-lib-smoke.sh" .github/workflows/scripts/smoke-baseline.txt
```
Expected: 输出一行，行号紧跟在 `dedupe-adb-devices-lib-smoke.sh` 之后。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/smoke/lib/ensure-shizuku-server.sh \
        .github/workflows/scripts/smoke-baseline.txt
git commit -m "feat: Shizuku shell server 存活保障纯函数库（登记进 CI 基线）"
```

---

## Self-Review 记录（writing-plans 阶段自查）

- **Spec 覆盖**：设计文档三个函数（`shizuku_server_alive` / `resolve_shizuku_starter_path` /
  `ensure_shizuku_server`）均有对应实现步骤；五个测试场景（含设计文档列出的三类：正常
  单行/空输入/多行 split apk，以及 alive/not-alive 两种 ps 场景）均已写出完整测试代码，
  无遗漏。CI 接入（baseline-lint 登记）已作为 Task 2 独立 step，不遗漏。
- **占位符扫描**：全文无 TBD/TODO，所有代码块都是可直接执行的完整内容，无"类似 Task N"
  这类引用式描述。
- **类型一致性**：函数名/参数在 Task 1（测试调用方式）与 Task 2（实现签名）之间完全一致
  ——`shizuku_server_alive "$ps_output"`、`resolve_shizuku_starter_path "$pm_path_output"`
  两处签名逐字匹配。
