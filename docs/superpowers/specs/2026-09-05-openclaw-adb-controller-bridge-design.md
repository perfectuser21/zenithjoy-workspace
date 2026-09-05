# OpenClaw adb_controller → phonectl.sh 信号桥适配层 — 设计

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 执行本设计对应的实现计划。

**Goal**：给 OpenClaw 侧 `douyin-phone-runtime` skill 需要的 `adb_controller` 写一个新的可执行实现，内部改调 `scripts/openclaw/phonectl.sh`（走中台 ws0 命令桥操作手机），替代现在"SSH 到 xian-m1 本地跑 adb"的老路径。

**归位**：`customer_app/line02/keyword_acquisition` · 置换（不新增格子坐标）· 范围仅覆盖 Step②③（找视频、发现 Lead）用得到的命令子集。私信（Step④）不动。服务对象仍是内部测试租户，纯技术验证，不涉及真实付费客户开放。

**架构**：新增单个 bash 脚本 `scripts/openclaw/adb-controller-bridge.sh`，对外严格匹配 `<adb_controller> --profile <phone_profile> <command> [args...]` 调用形态；`--profile` 到 `agent_id`/`tenant_id` 的映射走一个静态配置文件 `scripts/openclaw/profiles.json`（手动登记，这次只登记 `realmachine-smoke`）。脚本内部按 command 分发：大多数命令直接调 `phonectl.sh` 转译参数并转译输出；`preflight` 额外查中台 `GET /api/agent/burner/sessions` 判断账号是否 active；`lock-*` 用本地文件锁；`snapshot*`/`tap-evidence`/`swipe-evidence`/`back-evidence` 需要把 `phonectl.sh` 返回的内联数据（base64 图片 / 树文本）落盘成文件，打印文件路径。

**Tech Stack**：bash + jq + curl（跟 phonectl.sh 一致），测试用 `node --test` + 本地 mock HTTP server（跟 `phonectl.test.js` 风格一致，CI 通配符 `scripts/openclaw/**/*.test.js` 自动捡起，零 workflow 改动）。

---

## 组件与文件

### 新增文件

| 文件 | 职责 |
|---|---|
| `scripts/openclaw/adb-controller-bridge.sh` | 主脚本，命令分发 |
| `scripts/openclaw/profiles.json` | `phone_profile → {agent_id, tenant_id}` 静态映射 |
| `scripts/openclaw/__tests__/adb-controller-bridge.test.js` | 单元测试（mock server） |

### 复用（不改动）

- `scripts/openclaw/phonectl.sh`（件3，已合并）
- `apps/api/src/routes/devices.ts` `POST /:agentId/actions`（件2，已合并）
- `apps/api/src/routes/agent-burner.ts` `GET /api/agent/burner/sessions`（既有）

---

## 命令集设计

### 通用外壳

```
adb-controller-bridge.sh --profile <phone_profile> <command> [args...]
```

- `--profile` 必须是第一个参数，值必须在 `profiles.json` 里登记，否则 `die "unknown profile: <p>"` exit 2
- 输出：所有命令统一输出一个 JSON 对象到 stdout；失败时 exit 非 0，JSON 里带 `{"ok":false,"errorCode":"...","detail":"..."}`
- 环境变量透传给底层 `phonectl.sh`：`ZENITHJOY_API_BASE`、`ZENITHJOY_INTERNAL_TOKEN`（必填，同 phonectl 校验）
- `OPENCLAW_EVIDENCE_DIR`（可选，默认 `/tmp/openclaw-evidence`）：evidence 文件落盘根目录，实际路径为 `${OPENCLAW_EVIDENCE_DIR}/<profile>/`

### `preflight`

1. 调 `phonectl.sh <agent_id> device_info` 拿 `model/manufacturer/androidVersion/agentVersion`；失败（非 ok:true）→ 整体 `blocked`，`errorCode=DEVICE_UNREACHABLE`
2. 调中台 `GET /api/agent/burner/sessions`（`X-Tenant-Id: <tenant_id>`），在返回的 `sessions` 数组里按 `agent_id === <本profile的agent_id> && platform==='douyin' && role==='burner'` 过滤，判断是否存在 `status==='active'` 的行 → `account_verified: true/false`
3. **`call_state`（通话状态）：phonectl 原子指令集没有能力检测这个，不假装检测到——固定输出 `call_state: "unknown"` 并在 `warnings` 数组里注明 `"call_state 检测能力缺失，douyin-phone-runtime skill 要求 call_state!=idle 时安全停止，这里无法提供该判据，调用方需自行决定是否继续"`。这是本次范围内一个诚实的已知缺口，不伪造检测结果。
4. 输出：
```json
{
  "ok": true,
  "profile": "realmachine-smoke",
  "serial": "e017953c-...",
  "model": "MAA-AN00",
  "adb_state": "device",
  "call_state": "unknown",
  "foreground_pkg": "...",
  "account_verified": true,
  "warnings": ["call_state 检测能力缺失..."]
}
```

### `lock-acquire <run_id>` / `lock-release <run_id>` / `lock-status`

本地文件锁，锁文件路径 `${OPENCLAW_EVIDENCE_DIR}/<profile>/.lock.json`（跟 evidence 共用目录树，profile 隔离）。

- `lock-acquire <run_id>`：
  - 锁文件不存在 → 写入 `{"owner":"<run_id>","acquired_at":"<ISO8601>"}`，返回 `{"ok":true,"acquired":true}`
  - 锁文件存在且 `owner === run_id`（同一 run 重复 acquire，多阶段共享）→ 返回 `{"ok":true,"acquired":true,"already_owned":true}`
  - 锁文件存在且 `owner !== run_id`：检查 `acquired_at` 是否超过 `LOCK_TTL_SECONDS`（默认 1800s=30min，可用环境变量 `OPENCLAW_LOCK_TTL_SECONDS` 覆盖）——超时视为孤儿锁，允许抢占并覆写；未超时 → 返回 `{"ok":false,"errorCode":"LOCKED","owner":"<其他run_id>"}`，exit 1
- `lock-release <run_id>`：锁文件不存在或 `owner !== run_id` → `{"ok":false,"errorCode":"NOT_OWNER"}` exit 1；匹配则删除锁文件，返回 `{"ok":true,"released":true}`
- `lock-status`：锁文件不存在 → `{"ok":true,"locked":false}`；存在 → `{"ok":true,"locked":true,"owner":"...","acquired_at":"...","age_seconds":N}`

### `open-app`

固定调 `phonectl.sh <agent_id> launch com.ss.android.ugc.aweme`，透传 `ok`/`foregroundPkg`。

### `snapshot` / `snapshot-evidence <EVIDENCE_ID>`

1. 调 `phonectl.sh <agent_id> screenshot`
2. 失败（`ok:false`，如已知的 `CAPTURE_FAILED`）→ 原样透传错误，不落盘，exit 1
3. 成功 → 从 `data.imageBase64` 解码写入 `${dir}/snapshot-<EVIDENCE_ID 或时间戳>.jpg`；`EVIDENCE_ID` 若提供必须匹配 `^[A-Za-z0-9._-]+$`（skill 原文要求），否则 exit 2
4. 输出 `{"ok":true,"path":"<绝对路径>","captureWidth":N,"captureHeight":N,"screenWidth":N,"screenHeight":N}`（把双分辨率原样透传，供调用方做坐标换算——这是件1 特意加的判定点，不能在这层丢掉）

`snapshot` 不带 EVIDENCE_ID 用当前时间戳命名（`snapshot-$(date +%s%N).jpg`），仅供一次性状态检查用，不保证不覆盖。

> **真机验证修正（2026-09-05）**：设计初版误假设设备端截图是 PNG 格式（校验 PNG IEND chunk）。
> 真机实测发现安卓 agent 端实际用 `Bitmap.CompressFormat.JPEG` 压缩截图
> （见 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ScreenCaptureReal.kt`），
> 落盘扩展名与完整性校验均已改为 JPEG（SOI `FF D8` 开头 / EOI `FF D9` 结尾）。

### `tap-evidence X Y EVIDENCE_ID [WAIT_MS]` / `swipe-evidence X1 Y1 X2 Y2 MS EVIDENCE_ID [WAIT_MS]` / `back-evidence EVIDENCE_ID [WAIT_MS]`

1. 执行对应动作（`phonectl.sh tap/swipe/key back`）；动作失败 → 原样透传错误，**不再截图**，exit 1（避免在失败状态下拍一张误导性的"成功截图"）
2. 动作成功 → `sleep <WAIT_MS/1000>`（`WAIT_MS` 默认 800ms，与件1 GestureRunner 默认稳定等待时间量级一致）
3. 复用 `snapshot-evidence` 逻辑截图存证，输出同上加一个 `action_ok: true`

### `open-app` 以外未实现的命令

`current-video-link` / `record-start` / `record-stop` / `record-status` / `record-extract-audio` / `ui-evidence`：统一返回 `{"ok":false,"errorCode":"UNSUPPORTED","detail":"本次范围（keyword_acquisition Step②③）不需要该命令"}`，exit 3（区别于其他失败的 exit 1，方便调用方识别"这是已知不支持"而非"运行时故障"）。

---

## 测试策略

- **单元测试**（`node --test`，mock HTTP server 顶替中台 API）：
  - 每个命令的参数解析/校验（含非法 profile、非法 EVIDENCE_ID、缺 token）
  - `preflight` 的 account_verified 判断逻辑（mock 不同的 sessions 响应：有 active / 无 active / agent_id 不匹配）
  - `lock-*` 三态转换（acquire 首次成功、同 run 重入、跨 run 冲突、TTL 过期抢占、release 权限校验）
  - `snapshot-evidence` 的 base64 落盘正确性（mock 一个已知的小 base64 JPEG，断言写出的文件内容匹配）
  - `tap-evidence` 失败路径不截图（mock tap 返回 ok:false，断言没有调用 screenshot endpoint）
  - `UNSUPPORTED` 命令返回 exit 3
- **集成/E2E**：对着 staging `realmachine-smoke`（agentId `e017953c-...`）手动跑一遍 `preflight`/`snapshot-evidence`/`tap-evidence`，验证真机可用（不写入自动化 CI，因为依赖真机在线，跟 `phonectl.sh` 目前的验证方式一致——真机验证是 PR 描述里的手动记录，不是 CI gate）
- **trivial**：无

---

## 已知缺口（本次范围内明确不做，写进 PR description）

1. `call_state` 无法真实检测（见 preflight 设计）
2. `current-video-link`/`record-*` 不实现
3. `snapshot` 依赖的底层 `phonectl.sh screenshot` 目前有已知 bug（`CAPTURE_FAILED`，与上墙推流 FramePushLoop 抢占 MediaProjection 有关）——本次验证时手机不要同时开着"上墙"，这是运维层面的规避，不在这个 PR 里改 agent-android 代码
4. `profiles.json` 是手动维护的静态文件，不做自动发现/多设备管理
5. 锁机制（`lock-acquire`/`lock-release`/`lock-status`）是 check-then-act 的非原子操作（读锁文件状态和写入锁文件之间没有互斥），理论上存在低概率的多进程同时 `lock-acquire` 竞态窗口（TOCTOU）：两个进程都读到"无锁/孤儿锁"后几乎同时写入，后写的会覆盖先写的，导致两边都以为自己拿到了锁。当前场景（内部测试租户、调用近似串行）下这个窗口极窄，影响可忽略；留到真正出现多进程并发抢同一设备的场景时，再换成基于 `flock` 或 `mkdir`（利用文件系统层面互斥语义天然原子）的锁实现加固
