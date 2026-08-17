# line02 获客真机 smoke 假红守卫治理 — 设计

- **Brain task**: `cae22392-66ae-4e73-a63f-3fc3fe73b5cd`（headed-session，已 claim）
- **decision**: `713af98f-a80b-484e-a98f-79dc4e968cd1`
- **分支**: `cp-08172230-line02-smoke-false-red-guards`（base_sha `5b303ba7`）
- **GP-Anchor**: `line02/keyword_acquisition keep-green`
- **PrepPRD**: `sprints/08172220-line02-smoke-false-red-guards/prep-prd.md`（含全部实测证据）

## 问题

`e2e-line02-android-collect` nightly 自 08-05 起连红 12+ 晚，**全部停在环境自检 `exit 3`，从未跑到业务逻辑**。因此 0816 就记录为「未挖」的判定链 flaky 被埋 12 天。该 workflow 的 `push`/`pull_request` 触发被注释掉、不是 required check，所以它红了拦不住任何 PR——守卫天天喊狼来了，狼真来时没人信。

本设计只治**守卫本身的可信度**，不治业务缺陷。

## 设计原则

守卫判据必须满足三条，违反任一即为假红温床：

1. **不依赖易失状态** —— logcat 是环形缓冲，会被冲掉
2. **不依赖隐式单设备** —— adb 会因 mDNS 自动多出 transport
3. **不能让 `set -e` 吞掉自己的诊断** —— 诊断代码必须可达

## 五处修改

### 1. 动态取 agent_id 不再依赖历史日志（渐进式冷启动）

**现状**（`line02-android-collect-realmachine-smoke.sh:67-75`）：`logcat -d | grep 'agent started — agentId=<uuid>'` 取当前设备真实 agent_id。这段存在的理由是硬编码 agent_id 会随设备重装漂移（注释记录了 2026-07-09 / 07-16 两次真机踩坑：任务派给早已不轮询的旧 agent_id，采集永远 pending 卡死，表面像"采集坏了"实则派错对象）。

**根因**：用易失来源取持久身份。第四台实测 uptime 11 天、load avg 11.6、logcat main 环形缓冲 16MB 但 **98MB readable**（高速滚动），几小时前的启动日志必然已被冲掉。设备跑得越久越必然误报。

**不采用的方案**：
- 换成 `pidof` / 中台心跳 —— 拿不到 agent_id，会废掉整个机制（这段不是判健康）
- 中台按 hostname 查 —— `agents` 表无硬件序列号字段、`hostname` 存机型，而小黄与第四台**都是 MAA-AN00**，必然歧义
- workflow 显式注入 `SMOKE_AGENT` —— 就是注释里已踩过的漂移坑

**采用方案（渐进式）**：先直接取；取不到才冷启动一次让日志重新产生。正常情况零副作用。

冷启动必须破一个死锁：**force-stop 会让荣耀撤销该 app 的无障碍授权**（08-17 实测 `enabled_accessibility_services` 变 `null`，随后两个 job 都报"无障碍未开"）。故顺序固定为：

```
读取并保存 enabled_accessibility_services
  → force-stop agent → monkey 拉起 → 等 initAgent
  → 写回 enabled_accessibility_services + accessibility_enabled=1
  → 再取 logcat
```

提取为纯函数便于测试（注入"取日志"与"冷启动"两个回调）：
- `extract_agent_id <logcat_text>` —— 从文本提取 uuid，纯字符串处理
- `resolve_live_agent_id` —— 两阶段编排：直接取 → 失败则冷启动 → 再取

**冷启动等待**：monkey 拉起后按固定 2s 步长轮询 logcat，上限 30s（`initAgent` 含中台注册往返，第四台实测约 3~20s 出日志；固定 sleep 要么白等要么不够，用轮询）。超时即视为取不到，走 envfail。

> ⚠️ 冷启动同时会丢 MediaProjection 授权，由第 5 项的自动授权段兜住（当前该授权本就是 `null`，见 PrepPRD）。

### 2. 所有 adb 调用绑定目标设备

**现状**：`$DEV` 在 `:53` 已取出，但 `:68/:92/:93/:94/:96/:98` 全部用裸 `"$ADB"`；`dm-send-realmachine-smoke.sh:88` 同病。

**根因**：adb server 每次重启会通过 mDNS **自动**再连一个 transport，同一台手机同时出现 `192.168.1.96:5555` 与 `adb-<序列号>-xxxx._adb-tls-connect._tcp` → 无 `-s` 的调用返回 `more than one device/emulator` → grep 拿到空 → 误报"包 `com.zenithjoy.agent.e2e` 未安装"（实测包装着且进程在跑）。08-17 实测**会持续复发**：清理后几分钟自己回来。

**设备选择改为配置意图优先**：

```bash
DEV="${ANDROID_ADB_ENDPOINT:-}"
if [ -z "$DEV" ] || ! "$ADB" devices | grep -qE "^${DEV}[[:space:]]+device$"; then
  DEV=$("$ADB" devices | awk '/[[:space:]]device$/{print $1; exit}')
fi
```

- 顺带修掉一个老缺陷：原 `awk ... exit` 在多台手机在线时是**随机挑一台**（0804 gp2 审计已记录）
- 不设 `ANDROID_ADB_ENDPOINT` 的车道（如 us-m4 走 `remote-adb.sh` 自管连接）行为完全不变，与 `lib/ensure-device-online.sh` 的既有设计一致

**不复用 `lib/dedupe-adb-devices.sh`**：它按 `ro.serialno` 去重，是为"需要遍历多台设备"设计的；本场景只操作一台，用它要先枚举再逐台 `getprop`，多次 adb 往返变慢且不解决"该用哪台"的问题。

### 3. dm smoke 补抖音状态复位

`dm-send-realmachine-smoke.sh` 开头加 `am force-stop com.ss.android.ugc.aweme`。

**这不是新发明**：collect smoke `:96` 早就这么做（注释"采集前把抖音复位到干净态，根治前一轮残留栈导致的 NO_SEARCH_INPUT/SEARCH_TIMEOUT"），dm smoke 漏了同一步。

**证据**：采集真跑完会把抖音留在 `com.ss.android.ugc.aweme/...ChatRoomActivity`，dm job 相隔约 1 分钟从脏状态起步 → 13 秒内 `outcome=FAILED`。08-17 隔离实验：force-stop 抖音后手跑 dm smoke → `NONE×4 → SENT`，`EXIT_CODE=0`。

> 🔑 08-16 dm job 之所以 success，**恰恰因为 collect 死在环境闸、根本没碰抖音**。这两个 job 从未真正连续成功跑过一次——采集越成功，私信越必然失败。

### 4. 抓评论 smoke 不再吞掉自己的诊断

`line02-keyword-comment-smoke.sh:70` 在 `set -euo pipefail`（`:18`）下写 `KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1)`，node 非 0 退出直接终止脚本 → `:73` 的 `fail "...完整输出: $KW_OUT"` 与 `:80` 的 `DOUYIN_SESSION_EXPIRED` 优雅 skip 分支**永远执行不到** → `exit 1` 且零诊断输出。

改为 `KW_OUT=$(... ) || true` 后再判断。手动跑 node 才看到的真因应当被脚本自己打印出来：
`{"ok":false,"error":"NO_HEADFUL_CHROME: 无 ZJ_MAIN_DATA_DIR（请先绑定抖音小号）"}`

### 5. 并入 PR #1312 的 MediaProjection 自动授权

采纳其 `uiautomator dump` 找「授权截屏」按钮取 `bounds` → `input tap` → 再 dump 系统弹框匹配「立即开始/允许/Allow/Start now」再 tap 的做法。判定链依赖 MediaProjection 是脚本 `:139-142` 注释里已写明的事实（授权失效 → `capture_type=skipped_capture_failed` → `judgment_status` 恒 pending）。

**不纳入其 `AGENT_ID` 默认值改动**：`AGENT_ID="${SMOKE_AGENT:-<默认>}"` 的默认值永远不生效——`SMOKE_AGENT` 未传时会被 `:67-75` 的动态值覆盖，动态取失败时直接 envfail 退出。改它不影响任何行为，是死代码改动。

坐标解析必须用 `bounds` 而非截图估算（同页面常有多个 Switch/Button，肉眼易点错）。该 PR 代码从未真机验证过，**采用前须在第四台实测**。收尾关闭 #1312 并评论指向新 PR。

**失败时不阻塞**（沿用 #1312 的分级，且与 spec 的"只治守卫可信度"边界一致）：授权流程失败只打印警告，**不 envfail**。理由是采集主链路不依赖截图授权（脚本 `:91` 注释已明确"截图授权是判定链的事，不影响采集"），judged=0 该由 `:169` 那道判定闸去报，不该由授权段抢先把整个 job 判死——否则又造一个新的假红源。

`bounds` 解析本身是纯字符串处理，提取为可测函数：
- `parse_ui_bounds <ui_xml> <文案>` —— 返回 `中心x 中心y`，无匹配返回空

## 测试策略

**主体：unit 档纯函数变异测试**（这些缺陷全部是 shell 逻辑接缝，CI linux runner 可跑，无需真机）。

沿用既有框架，参考 `__tests__/dm-send-realmachine-smoke.test.sh`（62 行，已工作）与 `smoke/lib/ensure-device-online.test.sh`：
```bash
source "$SCRIPT" --source-only     # 只定义函数不执行主流程
# 喂 mock 数据 → 断言分支走对
```

前置重构：`dm-send-realmachine-smoke.sh` 已支持 `--source-only`；`line02-android-collect-realmachine-smoke.sh` 与 `line02-keyword-comment-smoke.sh` **需先补**（本身是可测的重构）。

必须覆盖的变异：

| 测试 | 变异 | 期望 |
|---|---|---|
| 设备选择 | `adb devices` 返回 ip:port + mDNS 双 transport | 选中 `ANDROID_ADB_ENDPOINT`，不返回空、不 `more than one device` |
| 设备选择 | 只有 mDNS transport（endpoint 未在线） | fallback 到第一个 device 行 |
| 设备选择 | 未设 `ANDROID_ADB_ENDPOINT` | 行为与改动前一致（回归保护） |
| agent_id | logcat 有启动日志 | 直接取到，**不触发冷启动** |
| agent_id | logcat 无启动日志、冷启动后有 | 取到，且无障碍授权被写回 |
| agent_id | 两次都取不到 | 返回空（调用方 envfail），不静默放行 |
| 抓评论诊断 | node 非 0 且输出含 `NO_HEADFUL_CHROME` | 打印该错误，不静默 exit |
| 抓评论诊断 | node 非 0 且输出含 `DOUYIN_SESSION_EXPIRED` | 走 skip 分支（exit 0） |
| bounds 解析 | ui xml 含「授权截屏」节点 | 返回该节点 bounds 的中心坐标 |
| bounds 解析 | 同页多个节点、目标文案在后面 | 命中目标文案那个，不是第一个节点 |
| bounds 解析 | 无匹配文案 | 返回空（调用方跳过点击并打印说明，不崩） |

第 3 项（dm smoke 补 `force-stop` 抖音）是单行副作用命令、无逻辑分支，不做 unit 测试；改用**静态断言**保证它不被后人删掉：在 dm smoke 的测试里断言脚本源码含该复位命令（与 repo 既有 `lint-*` 静态守卫同思路）。

**闸门**：新测试必须加进 `.github/workflows/ci-l1-process.yml:326` 的显式清单（`[CONFIG]` 类改动）。不加就是该 job 注释自己骂的「**孤儿测试——守卫写了但从不 fire**」。

**proven-to-fire**：每个守卫都要故意弄坏一次、亲眼看它报红。没见过它报红的守卫不算守卫。

**真机 E2E（手动，非 CI）**：第四台 `192.168.1.96:5555`，经 `ssh xian-rog`。rog 上 cmd 引号嵌套不可靠 → scp 传 `.ps1` 再 `powershell -ExecutionPolicy Bypass -File`。repo 在 rog 的 `C:\actions-runner\_work\zenithjoy-workspace\zenithjoy-workspace`，git bash 在 `C:\Program Files\Git\bin\bash.EXE`。
> 陷阱：在 rog 上用 **PowerShell** 看 logcat 会踩 GBK（codepage 936 把 em dash 变成 `U+9225 U+003F`），但 workflow 用 **git bash 走 UTF-8 不受影响**——别把这个误判成编码 bug（08-17 我在这条岔路上绕过一次）。

## PR 元数据的两个机械闸（08-17 实际被卡住才补上）

改这类 PR 时最容易忽略的不是代码，而是两个读 **PR 元数据**的 lint：

1. **`CI Config Audit`**：只要 diff 碰了 `.github/workflows/**`，**PR 标题**必须带 `[CONFIG]` 或 `[INFRA]` 前缀。
   ⚠️ 加在 commit message 上**不算**——它读的是 PR title。本次就是只在 commit 里写了 `[CONFIG]`、标题没写，被卡。
2. **`Lint — GP Anchor`**：PR body 里 `GP-Anchor:` 行的值**不能用反引号包裹**。写成带反引号的形式会让
   lint 把反引号算进值里，报 `GP-ANCHOR-FORMAT-INVALID`。正确是裸值：
   `GP-Anchor: line02/keyword_acquisition keep-green`

> 🔧 **改完标题/body 后必须推一个新 commit，不能只 `gh run rerun`**：Actions 的 rerun 复用原始事件
> payload，读不到更新后的 PR 元数据，重跑照样红（本次实测重跑仍 fail）。

另外 rog self-hosted runner 上偶发 `Failed to download action 'actions/checkout' ... 429 (Too Many Requests)`
——国内网络拉 GitHub 被限流，连 checkout 都没做、脚本压根没跑。这类失败与改动无关，重跑即可。

## 不在范围

- **判定链 flaky 本身**（3 视频全 pending / `media_projection: null`）→ 单独立项。本次只让守卫可信，好让这个问题第一次能被稳定观测
- **抓评论的抖音小号绑定**（`NO_HEADFUL_CHROME`）→ 需人工在 rog 上登录 Chrome
- **打开 `push`/`pull_request` 触发升 required gate** → 等判定链真稳了再做，workflow 里那段注释写明了这个顺序
