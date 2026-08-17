# line02 获客真机 smoke 假红守卫治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 line02 获客真机 smoke 的守卫判据可信——不再因易失日志、mDNS 多 transport、`set -e` 吞诊断而假红。

**Architecture:** 三个 smoke 脚本各自补 `--source-only` guard 把判据抽成纯函数（照抄 `dm-send-realmachine-smoke.sh` 既有模式），设备选择逻辑提到 `smoke/lib/adb-target.sh` 共享；每个纯函数配 mock 变异测试，测试接入 `ci-l1-process.yml` 既有清单。

**Tech Stack:** bash（`set -uo pipefail`）、adb、uiautomator、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-17-line02-smoke-false-red-guards-design.md`

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `.github/workflows/scripts/smoke/lib/adb-target.sh` | 选定唯一目标设备（endpoint 优先 + fallback） | **新建** |
| `.github/workflows/scripts/__tests__/adb-target.test.sh` | adb-target 变异测试（3 条） | **新建** |
| `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` | 采集真机守卫 | 改：补 guard、用 adb-target、agent_id 冷启动、MediaProjection 授权 |
| `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh` | agent_id 解析/两阶段变异测试（3 条） | **新建** |
| `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh` | uiautomator bounds 解析变异测试（3 条） | **新建** |
| `.github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh` | 私信真机守卫 | 改：用 adb-target、开头复位抖音 |
| `.github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh` | 抖音复位静态断言（1 条） | **新建** |
| `.github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh` | 抓评论守卫 | 改：补 guard、`:70`/`:110` 放行诊断 |
| `.github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh` | 诊断可达性变异测试（2 条） | **新建** |
| `.github/workflows/ci-l1-process.yml` | CI 闸门清单 | 改：加入 5 个新测试 |

> ⚠️ 为什么设备选择进 `lib/` 而 agent_id/bounds 留在脚本内：设备选择是 collect 与 dm **共用**（DRY）；agent_id、bounds 只有 collect 用，放 lib 会造出无第二消费者的抽象（YAGNI）。

---

## Task 1: `smoke/lib/adb-target.sh` — 选定唯一目标设备

**Files:**
- Create: `.github/workflows/scripts/smoke/lib/adb-target.sh`
- Test: `.github/workflows/scripts/__tests__/adb-target.test.sh`

**背景**：adb server 每次重启会通过 mDNS 自动再连一个 transport，同一台手机同时出现 `192.168.1.96:5555` 与 `adb-<序列号>-xxxx._adb-tls-connect._tcp` → 不带 `-s` 的 adb 调用返回 `more than one device/emulator` → grep 拿到空 → 误报"包未安装"。08-17 实测会持续复发。

- [ ] **Step 1: 写 failing test**

创建 `.github/workflows/scripts/__tests__/adb-target.test.sh`：

```bash
#!/usr/bin/env bash
# adb-target.test.sh — select_adb_device 变异测试（无需真机，CI linux runner 可跑）
#
# 防的退化：adb 因 mDNS 自动多出第二个 transport 时，不带 -s 的调用会返回
# "more than one device/emulator"，脚本 grep 拿到空 → 误报"包未安装"（08-17 实测）。
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke/lib" && pwd)/adb-target.sh"
# shellcheck source=/dev/null
source "$LIB"

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

# fake_adb：用 $FAKE_DEVICES 冒充 `adb devices` 输出
fake_adb() {
  case "${1:-}" in
    devices) printf '%s\n' "$FAKE_DEVICES" ;;
    *) return 0 ;;
  esac
}

echo "== select_adb_device：mDNS 双 transport 场景 =="

FAKE_DEVICES='List of devices attached
192.168.1.96:5555	device
adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp	device'
check "双 transport 时选中 endpoint" "192.168.1.96:5555" \
  "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo "== select_adb_device：endpoint 未在线 → fallback 第一个 device 行 =="

FAKE_DEVICES='List of devices attached
adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp	device'
check "endpoint 不在线时 fallback" "adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp" \
  "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo "== select_adb_device：未设 endpoint（回归保护，行为须与改动前一致）=="

FAKE_DEVICES='List of devices attached
e6c7ef34	device
192.168.3.9:5555	device'
check "未设 endpoint 取第一个" "e6c7ef34" "$(select_adb_device fake_adb '')"

echo "== select_adb_device：offline 行不得被选中 =="

FAKE_DEVICES='List of devices attached
192.168.1.96:5555	offline
e6c7ef34	device'
check "跳过 offline 行" "e6c7ef34" "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `bash .github/workflows/scripts/__tests__/adb-target.test.sh`
Expected: FAIL —— `No such file or directory` （`adb-target.sh` 还不存在）

- [ ] **Step 3: 写最小实现**

创建 `.github/workflows/scripts/smoke/lib/adb-target.sh`：

```bash
#!/usr/bin/env bash
# adb-target.sh — 选定唯一 adb 目标设备，供所有真机 smoke 绑定 -s 使用。
#
# 背景（2026-08-17 实测）：adb server 每次重启会通过 mDNS **自动**再连一个 transport，
# 同一台物理手机因此同时出现 `192.168.1.96:5555` 与
# `adb-<序列号>-xxxx._adb-tls-connect._tcp` 两条 device 行。此时任何不带 -s 的
# adb 调用都返回 `more than one device/emulator`，调用方 grep 拿到空 →
# 误报"包未安装 / 无障碍未开"这类假环境错误（e2e-line02-android-collect 连红 12+ 晚
# 的两大成因之一）。清理旧 transport 治不了本——几分钟后 mDNS 又会把它加回来，
# 所以正解是所有调用显式绑定 -s。
#
# select_adb_device ADB_CMD [ENDPOINT]
#   ADB_CMD  — adb 可执行路径或函数名（测试用函数注入）
#   ENDPOINT — 期望的目标（通常是 $ANDROID_ADB_ENDPOINT）。在线则优先选它：
#              这是"配置意图"，比"adb devices 第一行"可预测。
#   未设 ENDPOINT 或它不在线 → 回落到第一个 device 行（保持不配端点车道的原有行为，
#   与 lib/ensure-device-online.sh 的设计一致）。
#   输出：选中的 adb serial（stdout）；无任何在线设备 → 输出空、返回 1。
select_adb_device() {
    local adb_cmd="$1"
    local endpoint="${2:-}"
    local devices
    devices=$("$adb_cmd" devices 2>/dev/null)

    if [ -n "$endpoint" ] \
       && printf '%s\n' "$devices" | grep -qE "^${endpoint}[[:space:]]+device$"; then
        printf '%s' "$endpoint"
        return 0
    fi

    local first
    first=$(printf '%s\n' "$devices" | awk '/[[:space:]]device$/{print $1; exit}')
    [ -n "$first" ] || return 1
    printf '%s' "$first"
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bash .github/workflows/scripts/__tests__/adb-target.test.sh`
Expected: `PASS=4 FAIL=0`

- [ ] **Step 5: proven-to-fire —— 故意弄坏，亲眼看它报红**

把实现里的 endpoint 优先分支临时注释掉（模拟退化回"永远取第一行"）：

Run: `bash .github/workflows/scripts/__tests__/adb-target.test.sh`
Expected: FAIL，第一条断言报 `期望=192.168.1.96:5555 实际=adb-ANGYVB4311010223-...`

看到报红后把注释恢复，再跑一次确认回到 `PASS=4 FAIL=0`。

- [ ] **Step 6: Commit（test 与实现分两个 commit，遵守 TDD 顺序）**

```bash
git add .github/workflows/scripts/__tests__/adb-target.test.sh
git commit -m "test(smoke): adb-target 选设备变异测试（mDNS 双 transport 假红回归）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git add .github/workflows/scripts/smoke/lib/adb-target.sh
git commit -m "fix(smoke): 新增 select_adb_device——endpoint 优先绑定目标设备

mDNS 会自动为同一台手机再加一个 transport，不带 -s 的 adb 调用因此
返回 more than one device/emulator，被调用方误判成"包未安装"。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: collect smoke 补 `--source-only` 并接入 adb-target

**Files:**
- Modify: `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`（全文件重构为 guard + main 结构）

**背景**：该脚本 254 行全是顺序执行的裸语句，没有 `main()` 也没有 `--source-only`，纯函数无法被测试 source。必须先做这个前置重构，Task 3/4 才可测。参考 `dm-send-realmachine-smoke.sh:68-71`（guard）与 `:73/:133`（main 包裹 + `BASH_SOURCE` 守卫）。

- [ ] **Step 1: 加 `--source-only` guard 与 main 包裹**

在 `set -uo pipefail`（:27）之后、`source lib/trim-json.sh`（:29）之前插入纯函数区占位注释；把现有 `:31` 起到文件末尾的全部主流程语句缩进包进 `main() { ... }`；文件末尾加：

```bash
# `source line02-android-collect-realmachine-smoke.sh --source-only` 时到此为止，不跑真机主流程。
if [ "${1:-}" = "--source-only" ]; then
  return 0 2>/dev/null || exit 0
fi

[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"
```

> guard 必须放在纯函数**之后**、`main` 定义**之后**、调用 `main` **之前**——与 dm smoke 一致。`ok/fail/envfail` 保持在 guard 之前定义（测试也要用到它们）。

- [ ] **Step 2: 把设备选择换成 adb-target**

`:50-54` 原文：

```bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ensure-device-online.sh"
ensure_device_online "$ADB" "${ANDROID_ADB_ENDPOINT:-}" \
  || envfail "无 Android 设备在线(adb devices 无 'device' 行；重连 ${ANDROID_ADB_ENDPOINT:-未配端点} 后仍失败)"
DEV=$("$ADB" devices 2>/dev/null | awk '/[[:space:]]device$/{print $1; exit}')
ok "设备在线: $DEV"
```

改为：

```bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ensure-device-online.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/adb-target.sh"
ensure_device_online "$ADB" "${ANDROID_ADB_ENDPOINT:-}" \
  || envfail "无 Android 设备在线(adb devices 无 'device' 行；重连 ${ANDROID_ADB_ENDPOINT:-未配端点} 后仍失败)"
DEV=$(select_adb_device "$ADB" "${ANDROID_ADB_ENDPOINT:-}") \
  || envfail "select_adb_device 未选出在线设备（adb devices 无 device 行）"
ok "设备在线: $DEV（后续所有 adb 调用绑定 -s $DEV）"
```

- [ ] **Step 3: 所有裸 `"$ADB"` 调用绑定 `-s "$DEV"`**

逐处改（原行号）：`:68` logcat、`:92` input keyevent、`:93` input swipe、`:94` monkey、`:96` am force-stop、`:98` settings get secure。例：

```bash
# 改前
"$ADB" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
# 改后
"$ADB" -s "$DEV" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
```

> `ensure_device_online` 内部已自带 `-s`，不要改它。

- [ ] **Step 4: 验证脚本可被 source 且不执行主流程**

Run: `bash -c 'source .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh --source-only && echo SOURCE_ONLY_OK && type select_adb_device >/dev/null && echo FUNCS_VISIBLE'`
Expected: 输出 `SOURCE_ONLY_OK` 与 `FUNCS_VISIBLE`，且**没有**任何 `━━━` 横幅或 adb 调用发生

- [ ] **Step 5: 静态检查裸调用已清零**

Run: `grep -nE '"\$ADB" (shell|logcat|install|pull|push)' .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh | grep -v -- '-s "\$DEV"' || echo "✅ 无裸 adb 调用"`
Expected: `✅ 无裸 adb 调用`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
git commit -m "refactor(smoke): collect smoke 补 --source-only guard + 全部 adb 调用绑定 -s

前置重构（让 Task3/4 的纯函数可测）+ 修 mDNS 双 transport 假红：
所有 adb 调用改用 select_adb_device 选定的 \$DEV 绑定 -s。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: agent_id 改渐进式冷启动（不再依赖历史日志）

**Files:**
- Modify: `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`（`:67-75` 区块）
- Test: `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh`

**背景**：这段的目的是**动态取 agent_id**（硬编码会随重装漂移，注释记了两次真机踩坑），不是判设备健康——所以不能换成 `pidof`。根因是"用易失来源取持久身份"：第四台 uptime 11 天、logcat main 16MB 缓冲但 **98MB readable**（高速滚动），启动日志早被冲掉。

- [ ] **Step 1: 写 failing test**

创建 `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh`：

```bash
#!/usr/bin/env bash
# agent-id.test.sh — 动态取 agent_id 的两阶段编排变异测试（无需真机）
#
# 防的退化：
#  1) 回到"只读历史 logcat"——设备跑久了启动日志被环形缓冲冲掉，必然误报
#     "设备可能从没跑完 initAgent"（08-15/16/17 三晚 nightly 就死在这）
#  2) 冷启动后忘记写回无障碍授权——荣耀 force-stop 会撤销它（08-17 实测变 null）
#  3) 两次都取不到时静默放行（会把任务派给错的 agent_id，采集永远 pending）
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-android-collect-realmachine-smoke.sh"
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
          else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi }

echo "== extract_agent_id：纯字符串提取 =="

LOG_HIT='08-17 18:48:01.942 16122 16175 I AgentService: agent started — agentId=e017953c-bc65-47e0-913e-a2ed5eb54993 machineId=4f637d68'
check "提取 uuid" "e017953c-bc65-47e0-913e-a2ed5eb54993" "$(extract_agent_id "$LOG_HIT")"

LOG_MULTI='I AgentService: agent started — agentId=aaaaaaaa-1111-2222-3333-444444444444
I AgentService: agent started — agentId=e017953c-bc65-47e0-913e-a2ed5eb54993'
check "多条取最后一条" "e017953c-bc65-47e0-913e-a2ed5eb54993" "$(extract_agent_id "$LOG_MULTI")"

check "无匹配返回空" "" "$(extract_agent_id 'I AgentService: polling tick')"

echo "== resolve_live_agent_id：两阶段编排 =="

# 注入的取日志/冷启动回调，用文件记录副作用
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

# 场景 A：首次就有日志 → 必须不触发冷启动
fetch_hit()  { printf '%s' "$LOG_HIT"; }
cold_mark()  { echo called >> "$TMPD/cold_a"; printf '%s' "$LOG_HIT"; }
check "日志在时取到 uuid" "e017953c-bc65-47e0-913e-a2ed5eb54993" \
  "$(resolve_live_agent_id fetch_hit cold_mark)"
check "日志在时不触发冷启动" "0" "$(cat "$TMPD/cold_a" 2>/dev/null | wc -l | tr -d ' ')"

# 场景 B：首次空、冷启动后有 → 取到且冷启动被调用一次
fetch_empty() { printf ''; }
cold_ok()     { echo called >> "$TMPD/cold_b"; printf '%s' "$LOG_HIT"; }
check "日志不在→冷启动后取到" "e017953c-bc65-47e0-913e-a2ed5eb54993" \
  "$(resolve_live_agent_id fetch_empty cold_ok)"
check "冷启动被调用一次" "1" "$(cat "$TMPD/cold_b" 2>/dev/null | wc -l | tr -d ' ')"

# 场景 C：两次都空 → 返回空（调用方 envfail），绝不静默给个假 uuid
cold_empty() { printf ''; }
check "两次都取不到返回空" "" "$(resolve_live_agent_id fetch_empty cold_empty)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh`
Expected: FAIL —— `extract_agent_id: command not found`

- [ ] **Step 3: 在 guard 之前加两个纯函数**

插入到 collect smoke 的纯函数区（`envfail` 定义之后）：

```bash
# ── 动态取 agent_id 的纯函数（可 source，变异测试锚点）─────────────────
# extract_agent_id LOGCAT_TEXT
#   从 logcat 文本提取最后一条 `agent started — agentId=<uuid>` 的 uuid。无匹配输出空。
extract_agent_id() {
  printf '%s\n' "${1:-}" \
    | grep -oE 'agentId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    | tail -1 | sed -E 's/^agentId=//'
}

# resolve_live_agent_id FETCH_CMD COLDSTART_CMD
#   两阶段取 agent_id：
#     ①先用 FETCH_CMD 读当前 logcat——设备刚启动过时零副作用命中；
#     ②读不到说明启动日志已被环形缓冲冲掉（第四台实测 16MB 缓冲 98MB readable，
#       高速滚动），此时调 COLDSTART_CMD 重启 agent 让日志重新产生，再读一次。
#   两次都读不到 → 输出空，由调用方 envfail（绝不返回假 uuid，否则任务会派给
#   错的 agent_id，采集永远 pending 卡死——2026-07-09/07-16 两次真机踩过）。
resolve_live_agent_id() {
  local fetch_cmd="$1" coldstart_cmd="$2" out
  out=$(extract_agent_id "$("$fetch_cmd")")
  if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  out=$(extract_agent_id "$("$coldstart_cmd")")
  printf '%s' "$out"
  [ -n "$out" ]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh`
Expected: `PASS=8 FAIL=0`

- [ ] **Step 5: 接上真机侧的两个回调实现**

把 collect smoke `:67-75` 区块替换为：

```bash
if [ -z "${SMOKE_AGENT:-}" ]; then
  # 阶段①的取日志：直读当前缓冲
  _fetch_agent_log() { "$ADB" -s "$DEV" logcat -d 2>/dev/null; }

  # 阶段②的冷启动：让 initAgent 重跑以产生新的 `agent started` 日志。
  # 三件事必须按序做，缺一即引入新的假红：
  #   a) 先清空并放大 logcat 缓冲——该设备刷屏极快（实测 16MB 缓冲 98MB readable），
  #      不清就可能刚打出来又被淹掉（dm smoke :100-101 早有同样处置）
  #   b) 存下无障碍授权：荣耀在 force-stop 后会撤销它（08-17 实测变 null，
  #      随后两个 job 都误报"无障碍未开"）
  #   c) 拉起后写回授权，再轮询等日志（initAgent 含中台注册往返，实测 3~20s）
  _coldstart_agent() {
    local acc_backup i
    acc_backup=$("$ADB" -s "$DEV" shell settings get secure enabled_accessibility_services 2>/dev/null | tr -d '\r')
    "$ADB" -s "$DEV" logcat -c >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" logcat -G 16M >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" shell am force-stop com.zenithjoy.agent >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    if [ -n "$acc_backup" ] && [ "$acc_backup" != "null" ]; then
      "$ADB" -s "$DEV" shell settings put secure enabled_accessibility_services "$acc_backup" >/dev/null 2>&1 || true
      "$ADB" -s "$DEV" shell settings put secure accessibility_enabled 1 >/dev/null 2>&1 || true
    fi
    for i in $(seq 1 15); do   # 15×2s = 30s 上限
      sleep 2
      if "$ADB" -s "$DEV" logcat -d 2>/dev/null | grep -q 'agent started'; then break; fi
    done
    "$ADB" -s "$DEV" logcat -d 2>/dev/null
  }

  LIVE_AGENT=$(resolve_live_agent_id _fetch_agent_log _coldstart_agent)
  if [ -n "$LIVE_AGENT" ]; then
    AGENT_ID="$LIVE_AGENT"
    ok "动态取到设备当前真实 agent_id=$AGENT_ID（非硬编码默认值）"
  else
    envfail "取不到 agent_id：直读 logcat 无 'agent started' 记录，冷启动 agent 后 30s 内仍未打出（查 initAgent 是否卡在中台注册/无障碍是否被撤销）"
  fi
fi
```

- [ ] **Step 6: proven-to-fire**

把 `resolve_live_agent_id` 的阶段②整段临时删掉（退化回"只读历史日志"）：

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh`
Expected: FAIL，场景 B「日志不在→冷启动后取到」报 `期望=e017953c-... 实际=`

恢复后重跑确认 `PASS=8 FAIL=0`。

- [ ] **Step 7: Commit（两个 commit）**

```bash
git add .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh
git commit -m "test(smoke): agent_id 两阶段取值变异测试（易失 logcat 假红回归）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git add .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
git commit -m "fix(smoke): agent_id 改渐进式冷启动，不再依赖已被冲掉的历史日志

设备 uptime 11 天时 logcat 环形缓冲(16MB/98MB readable)早把启动日志冲走，
守卫因此必然误报「设备从没跑完 initAgent」——连红 12+ 晚的首要成因。
改为：先直读(零副作用)，读不到才冷启动一次；冷启动前清空+放大缓冲，
并保存/写回无障碍授权（荣耀 force-stop 会撤销它）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 并入 MediaProjection 自动授权（承接 PR #1312）

**Files:**
- Modify: `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`（无障碍检查之后、派任务之前）
- Test: `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh`

**背景**：判定链依赖 MediaProjection 授权是脚本 `:139-142` 注释里已写明的事实（授权失效 → `capture_type=skipped_capture_failed` → `judgment_status` 恒 pending）。PR #1312（07-15 开、33 天未合）已写好自动授权代码但从未上线、也从未真机验证。**只纳入授权段**，不纳入它改 `AGENT_ID` 默认值那半（`${SMOKE_AGENT:-<默认>}` 的默认值永远不生效，是死代码改动）。

- [ ] **Step 1: 写 failing test**

创建 `.github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh`：

```bash
#!/usr/bin/env bash
# ui-bounds.test.sh — uiautomator bounds 解析变异测试（无需真机）
#
# 防的退化：回到"截图估坐标"或"取第一个节点"。同一页面常有多个按钮/开关，
# 取错就点错东西（08-17 给小白点 adb 超时开关时，目标上方就有一个 checked=true
# 的无线调试开关，靠肉眼必点错）。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-android-collect-realmachine-smoke.sh"
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
          else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi }

echo "== parse_ui_bounds =="

XML_ONE='<node text="授权截屏" bounds="[100,200][300,400]" />'
check "正常命中→中心坐标" "200 300" "$(parse_ui_bounds "$XML_ONE" '授权截屏')"

# 目标文案不是第一个节点：必须命中目标，不能取第一个
XML_MULTI='<node text="其它按钮" bounds="[0,0][50,50]" /><node text="授权截屏" bounds="[100,200][300,400]" />'
check "多节点命中目标而非第一个" "200 300" "$(parse_ui_bounds "$XML_MULTI" '授权截屏')"

check "无匹配返回空" "" "$(parse_ui_bounds "$XML_ONE" '立即开始')"

XML_ALLOW='<node text="立即开始" bounds="[600,1800][900,1900]" />'
check "系统弹框文案也能解析" "750 1850" "$(parse_ui_bounds "$XML_ALLOW" '立即开始')"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh`
Expected: FAIL —— `parse_ui_bounds: command not found`

- [ ] **Step 3: 加纯函数**

插入 collect smoke 纯函数区：

```bash
# parse_ui_bounds UI_XML TEXT
#   从 uiautomator dump 的 xml 里找含 TEXT 的节点，输出其 bounds 中心 "x y"。
#   无匹配输出空。必须按 bounds 解析而非截图估坐标——同页面常有多个同类控件。
parse_ui_bounds() {
  local xml="${1:-}" want="${2:-}" line nums x1 y1 x2 y2
  line=$(printf '%s\n' "$xml" | tr '<' '\n' | grep -F "$want" | head -1)
  [ -n "$line" ] || return 0
  nums=$(printf '%s' "$line" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | head -1 | grep -oE '[0-9]+')
  [ -n "$nums" ] || return 0
  read -r x1 y1 x2 y2 <<< "$(printf '%s' "$nums" | tr '\n' ' ')"
  [ -n "${x2:-}" ] || return 0
  printf '%s %s' "$(( (x1 + x2) / 2 ))" "$(( (y1 + y2) / 2 ))"
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh`
Expected: `PASS=4 FAIL=0`

- [ ] **Step 5: 加真机授权段（无障碍检查之后插入）**

```bash
# ── 1.5 MediaProjection 自动授权（Seg2 判定截图的前提）────────────────────
# 判定链要逐视频截图，依赖 MediaProjection；该授权在 app 进程重启后必然丢失
# （08-17 实测第四台与小黄的 dumpsys media_projection 都是 null）。agent
# MainActivity 上有「授权截屏」按钮，这里自动点掉它 + 系统弹框，省掉人工。
# 失败只警告不 envfail：采集主链路不依赖截图授权（见上方 :91 注释），judged=0
# 该由下方判定闸去报——授权段抢先判死只会造出新的假红源。
_tap_by_text() {   # _tap_by_text <dump_path> <文案...>
  local dump="$1"; shift
  local xml word xy
  "$ADB" -s "$DEV" shell uiautomator dump "$dump" >/dev/null 2>&1 || return 1
  xml=$("$ADB" -s "$DEV" shell cat "$dump" 2>/dev/null)
  for word in "$@"; do
    xy=$(parse_ui_bounds "$xml" "$word")
    if [ -n "$xy" ]; then
      echo "  [MediaProjection] 点击「$word」at ($xy)"
      # shellcheck disable=SC2086
      "$ADB" -s "$DEV" shell input tap $xy >/dev/null 2>&1 || true
      return 0
    fi
  done
  return 1
}

if _tap_by_text /sdcard/zj_ui.xml '授权截屏'; then
  sleep 2
  _tap_by_text /sdcard/zj_allow.xml '立即开始' '允许' 'Allow' 'Start now' || true
  sleep 2
  ok "MediaProjection 授权流程已触发（judged>0 即为授权成功）"
else
  echo "  [MediaProjection] 未见「授权截屏」按钮（可能已授权，或界面不符）"
fi
```

- [ ] **Step 6: proven-to-fire**

把 `parse_ui_bounds` 的 `grep -F "$want"` 临时改成 `head -1`（退化成"取第一个节点"）：

Run: `bash .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh`
Expected: FAIL，「多节点命中目标而非第一个」报 `期望=200 300 实际=25 25`

恢复后重跑确认 `PASS=4 FAIL=0`。

- [ ] **Step 7: Commit（两个 commit）**

```bash
git add .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh
git commit -m "test(smoke): uiautomator bounds 解析变异测试（防退化成取第一个节点）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git add .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
git commit -m "fix(smoke): 并入 MediaProjection 自动授权（承接未合的 PR #1312）

判定链依赖截图授权，而该授权在 app 重启后必失（实测 media_projection=null）。
自动点掉「授权截屏」+ 系统弹框，失败只警告不阻塞（采集主链路不依赖它）。
未纳入 #1312 改 AGENT_ID 默认值那半——那个默认值永不生效，是死代码。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: dm smoke 绑定 -s + 复位抖音

**Files:**
- Modify: `.github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh`
- Test: `.github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh`

**背景**：08-17 隔离实验证明私信链路本身健康（force-stop 抖音后手跑 → `NONE×4 → SENT`, exit 0）。它在 workflow 里失败是因为 collect job 真跑完把抖音留在 `ChatRoomActivity`，dm job 相隔 1 分钟从脏状态起步。collect smoke `:96` 早有此复位，dm 漏了。

- [ ] **Step 1: 写 failing test（静态断言，防后人删掉复位命令）**

创建 `.github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh`：

```bash
#!/usr/bin/env bash
# state-isolation.test.sh — dm smoke 必须在跑 RPA 前复位抖音（静态断言）
#
# 防的退化：删掉复位命令。08-17 实测——collect job 真跑完会把抖音留在
# ChatRoomActivity，dm job 紧接着从脏状态起步 → 13 秒内 outcome=FAILED。
# 08-16 dm job 之所以 success 恰恰因为 collect 死在环境闸没碰抖音，
# 两个 job 从未真正连续成功过。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/dm-send-realmachine-smoke.sh"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
          else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi }

check "含抖音复位命令" "yes" \
  "$(grep -q 'am force-stop com.ss.android.ugc.aweme' "$SCRIPT" && echo yes || echo no)"

check "复位出现在 fire 广播之前" "yes" \
  "$([ "$(grep -n 'am force-stop com.ss.android.ugc.aweme' "$SCRIPT" | head -1 | cut -d: -f1)" \
     -lt "$(grep -n 'DEBUG_E2E' "$SCRIPT" | grep 'am broadcast' | head -1 | cut -d: -f1)" \
     ] && echo yes || echo no)"

check "无裸 adb shell 调用（须绑定 -s）" "0" \
  "$(grep -cE '"\$ADB" (shell|logcat)' "$SCRIPT" || true)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh`
Expected: FAIL —— 三条都不满足（无复位命令、裸 adb 调用有 6 处）

- [ ] **Step 3: 实现**

在 `main()` 里 `ensure_device_online` 之后加设备选择，并把 `:88/:93/:100/:101/:105/:118` 六处裸 `"$ADB"` 绑定 `-s "$DEV"`；在 fire 广播之前加复位：

```bash
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/adb-target.sh"
  local DEV
  DEV=$(select_adb_device "$ADB" "${ANDROID_ADB_ENDPOINT:-}") \
    || envfail "select_adb_device 未选出在线设备"

  # 抖音状态复位：collect job 真跑完会把抖音留在 ChatRoomActivity，
  # 私信 RPA 从脏状态起步会立刻 FAILED（08-17 实测；collect smoke 早有同样处置）。
  "$ADB" -s "$DEV" shell am force-stop com.ss.android.ugc.aweme >/dev/null 2>&1 || true
  sleep 3
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bash .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh`
Expected: `PASS=3 FAIL=0`

- [ ] **Step 5: 确认既有测试未被破坏**

Run: `bash .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.test.sh`
Expected: 原有断言全绿（`FAIL=0`）

- [ ] **Step 6: proven-to-fire**

临时删掉复位那两行 → 跑 state-isolation 测试 → 应报 `含抖音复位命令 期望=yes 实际=no`。恢复后重跑全绿。

- [ ] **Step 7: Commit（两个 commit）**

```bash
git add .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh
git commit -m "test(smoke): dm smoke 抖音复位与 -s 绑定的静态守卫

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git add .github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh
git commit -m "fix(smoke): dm smoke 复位抖音 + adb 调用绑定 -s

collect job 真跑完把抖音留在 ChatRoomActivity，dm 从脏状态起步必 FAILED；
08-16 的 success 只是因为 collect 死在环境闸没碰抖音。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 抓评论 smoke 不再吞掉自己的诊断

**Files:**
- Modify: `.github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh`（`:70` 与 `:110` 两处，加 `--source-only`）
- Test: `.github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh`

**背景**：`set -euo pipefail`（`:18`）下 `KW_OUT=$("$NODE_EXE" ... 2>&1)` 在 node 非 0 退出时直接终止脚本，其下 `:73` 的 fail「完整输出」与 `:80` 的 `DOUYIN_SESSION_EXPIRED` skip 分支**永远执行不到** → `exit 1` 零诊断。`:110` 的 `CM_OUT=$(...)` 同病。

- [ ] **Step 1: 写 failing test**

创建 `.github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh`：

```bash
#!/usr/bin/env bash
# diagnostics.test.sh — 抓评论 smoke 的诊断必须可达（无需真机）
#
# 防的退化：set -e 下 `X=$(cmd)` 在 cmd 非 0 时静默杀死脚本，把脚本自己写好的
# 错误输出与 skip 分支全部跳过（08-17 实测：Step 1 两秒 exit 1、零输出，
# 手动跑 node 才看到真因 NO_HEADFUL_CHROME）。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-keyword-comment-smoke.sh"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
          else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi }

echo "== 静态：命令替换不得裸奔在 set -e 下 =="
check "KW_OUT 赋值带 || true" "yes" \
  "$(grep -qE 'KW_OUT=\$\(.*\)[[:space:]]*\|\|[[:space:]]*true' "$SCRIPT" && echo yes || echo no)"
check "CM_OUT 赋值带 || true" "yes" \
  "$(grep -qE 'CM_OUT=\$\(.*\)[[:space:]]*\|\|[[:space:]]*true' "$SCRIPT" && echo yes || echo no)"

echo "== 行为：classify_node_failure 分级 =="
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

OUT_NOCHROME='[keyword-search-douyin] kw="装修" burner=null
{"ok":false,"keyword":"装修","video_urls":[],"error":"NO_HEADFUL_CHROME: 无 ZJ_MAIN_DATA_DIR（请先绑定抖音小号）"}'
check "NO_HEADFUL_CHROME 判 fail 且带原因" "fail:NO_HEADFUL_CHROME" \
  "$(classify_node_failure "$OUT_NOCHROME")"

OUT_EXPIRED='{"ok":false,"error":"DOUYIN_SESSION_EXPIRED"}'
check "DOUYIN_SESSION_EXPIRED 判 skip" "skip:DOUYIN_SESSION_EXPIRED" \
  "$(classify_node_failure "$OUT_EXPIRED")"

check "无 JSON 输出也要给出可诊断结论" "fail:NO_JSON" \
  "$(classify_node_failure 'node: command not found')"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash .github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh`
Expected: FAIL —— 静态两条不满足 + `classify_node_failure: command not found`

- [ ] **Step 3: 加纯函数与 `--source-only` guard**

在 `ok()/fail()` 之后插入：

```bash
# ── 诊断分级纯函数（可 source，变异测试锚点）──────────────────────────
# classify_node_failure NODE_OUTPUT
#   把 node 脚本的（可能非 0 退出的）输出分级成 "<verdict>:<reason>"：
#     skip:<ERR>  — 已知环境限制，不算产品缺陷（如 DOUYIN_SESSION_EXPIRED：
#                   CI 以 SYSTEM 运行、DPAPI 解不开 asus 账号的 Chrome cookie）
#     fail:<ERR>  — 真失败，须带上具体 error 便于定位（如 NO_HEADFUL_CHROME）
#     fail:NO_JSON— 连 JSON 都没输出（node 本身没起来），也必须给结论而不是静默
classify_node_failure() {
  local out="${1:-}" json err
  json=$(printf '%s\n' "$out" | grep '^{' | tail -1)
  [ -n "$json" ] || { printf 'fail:NO_JSON'; return 0; }
  err=$(printf '%s' "$json" | grep -oE '"error"[[:space:]]*:[[:space:]]*"[^":]+' \
    | head -1 | sed -E 's/.*"//')
  case "$err" in
    DOUYIN_SESSION_EXPIRED) printf 'skip:%s' "$err" ;;
    '')                     printf 'fail:UNKNOWN' ;;
    *)                      printf 'fail:%s' "$err" ;;
  esac
}

if [ "${1:-}" = "--source-only" ]; then
  return 0 2>/dev/null || exit 0
fi
```

- [ ] **Step 4: 两处命令替换加 `|| true`**

```bash
# :70 改前
KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1)
# :70 改后（node 非 0 退出时不再静默杀死脚本，让下面的诊断/skip 分支可达）
KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1) || true

# :110 同样处理
CM_OUT=$("$NODE_EXE" "$CM_SCRIPT" "$FIRST_VIDEO" "smoke-test" "" "" "--stdout-only" 2>&1) || true
```

并在 `:73` 的无 JSON 分支里带上分级结论：

```bash
[ -n "$KW_JSON" ] || fail "keyword-search 无 JSON 输出（$(classify_node_failure "$KW_OUT")）— 完整输出: $KW_OUT"
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bash .github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh`
Expected: `PASS=5 FAIL=0`

- [ ] **Step 6: proven-to-fire**

去掉 `:70` 的 `|| true` → 跑测试 → 应报 `KW_OUT 赋值带 || true 期望=yes 实际=no`。恢复后全绿。

- [ ] **Step 7: Commit（两个 commit）**

```bash
git add .github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh
git commit -m "test(smoke): 抓评论 smoke 诊断可达性变异测试

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git add .github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh
git commit -m "fix(smoke): 抓评论 smoke 不再被 set -e 吞掉自己的诊断

set -e 下 KW_OUT=\$(node ...) 在 node 非 0 时静默杀死脚本，其下的 fail
完整输出与 DOUYIN_SESSION_EXPIRED skip 分支永远执行不到 → exit 1 零诊断。
:70/:110 两处加 || true，并把 error 分级带进 fail 消息。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 新测试接入 CI 闸门（否则是孤儿测试）

**Files:**
- Modify: `.github/workflows/ci-l1-process.yml`（`:326` 起的 for 循环清单）

**背景**：该 job 自己的注释写着"此前无任何 CI job 跑它们，是孤儿测试——正是本 sprint 要防的『守卫写了但从不 fire』"。新测试不进清单等于白写。

- [ ] **Step 1: 把 5 个新测试加进清单**

在 `.github/workflows/scripts/__tests__/dm-send-realmachine-smoke.test.sh \` 之后插入：

```yaml
                   .github/workflows/scripts/__tests__/adb-target.test.sh \
                   .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh \
                   .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh \
                   .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh \
                   .github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh \
```

- [ ] **Step 2: 本地模拟 CI 那段循环，确认全部被跑到且全绿**

```bash
set -e
FOUND=0
for t in .github/workflows/scripts/__tests__/adb-target.test.sh \
         .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.agent-id.test.sh \
         .github/workflows/scripts/__tests__/line02-android-collect-realmachine-smoke.ui-bounds.test.sh \
         .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.state-isolation.test.sh \
         .github/workflows/scripts/__tests__/line02-keyword-comment-smoke.diagnostics.test.sh \
         .github/workflows/scripts/__tests__/dm-send-realmachine-smoke.test.sh; do
  [ -f "$t" ] || { echo "❌ 缺失 $t"; exit 1; }
  FOUND=$((FOUND+1)); echo "▶ $t"; bash "$t"
done
echo "✅ 全部 $FOUND 个回归测试通过"
```

Expected: `✅ 全部 6 个回归测试通过`

- [ ] **Step 3: 校验 workflow YAML 合法**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci-l1-process.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 4: Commit（`[CONFIG]` 前缀——smoke 进 CI 的约定）**

```bash
git add .github/workflows/ci-l1-process.yml
git commit -m "[CONFIG] test(ci): 5 个假红守卫回归测试接入 L1 闸门清单

不进清单就是该 job 注释自己骂的「孤儿测试——守卫写了但从不 fire」。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 真机验证（第四台，手动）

**Files:** 无（仅执行与取证）

**背景**：Task 4 并入的 MediaProjection 授权代码来自从未合并、也从未真机验证过的 PR #1312，必须在真机上跑过才算数。Task 3 的冷启动路径同样只在 mock 里验证过。

- [ ] **Step 1: 确认第四台在线且 transport 唯一**

```bash
ssh xian-rog 'adb devices'
```
Expected: 只有 `192.168.1.96:5555	device` 一行。若同时出现 `adb-...._tcp` 行——**不要清理**，这正是本次修复要扛住的场景，继续往下跑即可验证 `-s` 生效。

- [ ] **Step 2: 把改动同步到 rog 的 runner 工作区并跑 collect smoke**

在 rog 上用 git bash 跑（cmd 引号嵌套不可靠，故写成 .ps1 再 `powershell -ExecutionPolicy Bypass -File`）：

```powershell
$env:ADB = "/c/Users/asus/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.0/adb.exe"
$env:ANDROID_ADB_ENDPOINT = "192.168.1.96:5555"
$env:API_BASE = "https://staging-autopilot.zenjoymedia.media"
$env:SMOKE_KW = "装修"
Set-Location "C:\actions-runner\_work\zenithjoy-workspace\zenithjoy-workspace"
& "C:\Program Files\Git\bin\bash.EXE" --noprofile --norc .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
"EXIT=$LASTEXITCODE"
```

Expected（本次修复的判据）：
- 出现 `✅ 设备在线: 192.168.1.96:5555（后续所有 adb 调用绑定 -s ...）`
- 出现 `✅ 动态取到设备当前真实 agent_id=...`（**不再**出现 `logcat 里找不到 'agent started'` 的 envfail）
- 出现 MediaProjection 授权段的输出（`点击「授权截屏」` 或 `未见「授权截屏」按钮`）
- 采集段 `✅ 采集 N 个、N 个真实 video_id 落库`

> 判定段（judged）**可能仍为 0** —— 判定链 flaky 明确不在本次范围。本 Task 只验证"环境闸不再假红、能跑进业务逻辑"。

- [ ] **Step 3: 冷启动路径专项验证**

先人为制造"启动日志已被冲掉"：`ssh xian-rog '<adb> -s 192.168.1.96:5555 logcat -c'`，再重跑 Step 2。
Expected: 日志里能看到冷启动被触发、随后 `✅ 动态取到设备当前真实 agent_id=...`；并用下面命令确认无障碍授权**被写回**（不是 null）：

```bash
ssh xian-rog '<adb> -s 192.168.1.96:5555 shell settings get secure enabled_accessibility_services'
```
Expected: 含 `DouyinCollectService` / `DouyinDmOutreachService` / `DeviceAccountScanService` 三个服务。

- [ ] **Step 4: 跑 dm smoke，验证复位生效**

紧接 Step 2 之后（此时抖音处于采集留下的状态）跑 dm smoke。
Expected: `outcome=SENT`（复位前的对照结果是 13 秒内 `outcome=FAILED`）。

- [ ] **Step 5: 把真机证据贴进 PR 描述**

至少包含：Step 2 的 agent_id 那行、Step 3 的无障碍回写结果、Step 4 的 `outcome=SENT`。

---

## Task 9: 收尾——关闭 PR #1312 并开新 PR

**Files:** 无（GitHub 操作）

- [ ] **Step 1: push 分支并开 PR**

```bash
git push -u origin cp-08172230-line02-smoke-false-red-guards
gh pr create --repo perfectuser21/zenithjoy-workspace \
  --title "fix(smoke): line02 获客真机 smoke 四处假红守卫治理（含并入 #1312 的 MediaProjection 自动授权）" \
  --body "见 docs/superpowers/specs/2026-08-17-line02-smoke-false-red-guards-design.md"
```

- [ ] **Step 2: 关闭 #1312 并说明去向**

```bash
gh pr comment 1312 --repo perfectuser21/zenithjoy-workspace \
  --body "其 MediaProjection 自动授权段已并入 #<新PR号>（该 PR 同时修掉 4 处假红守卫，并补齐变异测试 + 接入 CI 闸门 + 真机验证）。本 PR 的 AGENT_ID 默认值改动未纳入：\`\${SMOKE_AGENT:-<默认>}\` 的默认值永远不生效（未传时被动态取值覆盖，动态取失败时 envfail 退出），属死代码改动。故关闭本 PR。"
gh pr close 1312 --repo perfectuser21/zenithjoy-workspace
```

- [ ] **Step 3: 等 CI 全绿**

Run: `gh pr checks <新PR号> --repo perfectuser21/zenithjoy-workspace --watch`
Expected: 全绿，特别是 `L1 Process Gate Passed`（含新接入的 6 个回归测试）

---

## Self-Review

**1. Spec coverage**

| spec 要求 | 实现 Task |
|---|---|
| 第 1 项 agent_id 渐进式冷启动 + 破死锁 | Task 3 |
| 第 2 项 设备选择 endpoint 优先 + 全部绑 `-s` | Task 1（函数）+ Task 2（collect 接入）+ Task 5（dm 接入）|
| 第 3 项 dm 补抖音复位 | Task 5 |
| 第 4 项 抓评论放行诊断 | Task 6（含 spec 未提到的 `:110`，读全文时补上）|
| 第 5 项 并入 #1312 MediaProjection | Task 4 |
| 测试矩阵 12 条 + CI 接入 + proven-to-fire | Task 1/3/4/5/6 各自 Step 5-6 + Task 7 |
| 真机验证（尤其 #1312 那段） | Task 8 |
| 关闭 #1312 | Task 9 Step 2 |

无遗漏。

**2. Placeholder scan**：无 TBD/TODO；每个改动步骤都给了完整代码块与预期输出；`<新PR号>` 是执行期才产生的真实值，非占位内容。

**3. Type consistency**：`select_adb_device`（Task 1 定义 → Task 2/5 调用）、`extract_agent_id` / `resolve_live_agent_id`（Task 3 定义与调用）、`parse_ui_bounds`（Task 4 定义 → `_tap_by_text` 调用）、`classify_node_failure`（Task 6 定义与调用）——函数名与参数顺序在定义处和调用处一致。变量 `$DEV` 在 collect（main 内）与 dm（`local DEV`）各自声明，无跨文件依赖。
