# Sprint PRD — 夜间安卓两 job 迁 pc4 手机池轨，退役 rog 绑定

**TASK_ID**: f6c4df16-ba9c-49ed-89fc-67bbba743182
**SPRINT_DIR**: sprints/08041901-relay-f6c4df16
**GP Anchor**: line02/keyword_acquisition keep-green
**优先级**: P1
**创建日期**: 2026-08-04

---

## OKR 对齐

- **对应 KR**：line02 智能获客 — keyword_acquisition Golden Path keep-green（nightly 真机回归是 promote 证据②的基础）
- **当前问题**：`nightly-real-machine-staging.yml` 的 `douyin-read` 与 `account-scan` 两个 job 绑定 `wechat-capable`（即 xian-rog），但 rog 的 USB-ADB 已确诊死路、IP 也够不到 `192.168.3.x` 手机池，导致安卓两 job 结构性持续红
- **本次推进预期**：两个安卓 job 迁到 `android-capable`（pc4 轨），`wechat-bubble` 保留 rog，nightly-report 同步更新，nightly 安卓两 job 真摸到设备恢复绿

---

## 背景与根因

### 现状诊断

| Job | 当前 runner | 问题 |
|---|---|---|
| `wechat-bubble` | `[self-hosted, wechat-capable]` (rog) | 正常，保留 |
| `douyin-read` | `[self-hosted, wechat-capable]` (rog) | rog 无手机池访问，DPAPI session 可读但 adb 找不到设备 |
| `account-scan` | `[self-hosted, wechat-capable]` (rog) | rog USB-ADB 死路，`192.168.3.x` 手机池不可达，结构性红 |

### pc4 轨已就绪

- `nightly-android-fleet-pc4.yml`（2026-08-03 上线）使用 `[self-hosted, android-capable]`，已验证能动态发现 pc4 手机池设备（discover-devices → matrix scan）
- DB_SSH 公网受限密钥（`/c/actions-runner/.ssh/zjdb_ed25519`，`root@124.156.138.116:6443`）已从 rog 复制到 pc4 并设好 ACL
- HK exit-node checkout 方案（PR#1590/#1592/#1596）已在 pc4 验证可解两层出境网络问题

---

## Golden Path（本次验收场景）

nightly 自动触发后：`wechat-bubble`（rog）→ `douyin-read`（pc4，`android-capable`）→ `account-scan`（pc4，`android-capable`）→ `nightly-report` 汇总，安卓两 job 不再因找不到设备而 envfail/红。

---

## 实现范围

### 在范围内

1. **`nightly-real-machine-staging.yml`**：
   - `douyin-read` job：`runs-on` 从 `[self-hosted, wechat-capable]` 改为 `[self-hosted, android-capable]`；`needs` 关系保持（`needs: [wechat-bubble]`，`if: always()`）；更新注释说明迁移原因
   - `account-scan` job：同上，`runs-on` 改为 `[self-hosted, android-capable]`；保留 `DB_SSH_HOST/DB_SSH_PORT/DB_SSH_KEY` 配置（已在 pc4 轨验证可用）；保留 `exit_code` output 供 nightly-report 区分标签
   - `nightly-report` job：更新 job 注释和 summary 输出，标注安卓两 job 现跑 pc4 轨；`needs`、结果变量引用和 issue body 描述中增加"迁 pc4 后"上下文

2. **注释同步**：两个被改 job 的 checkout exit-node 注释中，将 "xian-rog 出境网络" 描述更新为 "pc4 出境网络"（PR#1590/#1592/#1596 已验证方案相同，引用不变）

### 不在范围内

- `wechat-bubble` job 任何改动（保留 `wechat-capable`）
- `nightly-android-fleet-pc4.yml` 改动（独立车道，不合并）
- `promote-all-prod.yml` 改动（`真抖音/真安卓` 前缀 startswith 匹配逻辑不变，runner 迁移不影响 job 名）
- `account-scan-realmachine-smoke.sh` 脚本本身改动
- DB_SSH 密钥或 ACL 操作（已就绪）

---

## 变更方案（具体 diff）

### `douyin-read` job（第 170 行附近）

```yaml
# 改前
runs-on: [self-hosted, wechat-capable]

# 改后
runs-on: [self-hosted, android-capable]
```

注释更新：将"见 wechat-bubble job 上方注释：xian-rog 出境网络两层独立问题……"改为"pc4 出境网络两层独立问题（GFW 带宽限速 + 间歇性 TCP 连接失败），复用 pc4 车道 PR#1590/#1592/#1596 已验证方案。"

### `account-scan` job（第 221 行附近）

```yaml
# 改前
runs-on: [self-hosted, wechat-capable]

# 改后
runs-on: [self-hosted, android-capable]
```

同上，注释同步更新。DB_SSH_* 环境变量保留原值（pc4 runner ACL 已就绪）。

---

## 验收条件（Contract DoD）

### Smoke / E2E 验收

1. **必须**：改动合入后，下一次 nightly 自动运行（UTC 19:00，北京 03:00）中：
   - `douyin-read` job 在 pc4 上 runner 接单（logs 显示 `android-capable` runner）
   - `account-scan` job 在 pc4 上 runner 接单，`adb connect` 或 `adb devices` 能列出 `192.168.3.x:5555` 系列设备（即摸到手机池）
   - `nightly-report` summary 正常生成，安卓 job 结果栏不再显示"runner offline/等待 wechat-capable"

2. **可选验证**（workflow_dispatch 手动触发）：在合入后立即用 `workflow_dispatch` 触发一次，观察两 job 的 runner 绑定和设备探测结果

3. **keep-green 约束**：`wechat-bubble` 结果不受影响（仍 `wechat-capable`），`promote-all-prod.yml` 的 `真微信`/`真抖音` 前缀匹配逻辑不受影响

### 不在验收范围内

- 本 PR 合入后安卓 job 立即绿（设备状态是运行时因素，不在代码变更保证范围）；代码变更保证的是"runner 正确绑定 pc4 / 能访问手机池"

---

## 影响范围

| 文件 | 改动类型 |
|---|---|
| `.github/workflows/nightly-real-machine-staging.yml` | `douyin-read`/`account-scan` `runs-on` 各改一行 + 注释更新 |

---

## 假设

- [ASSUMPTION: pc4 的 `android-capable` runner 注册正常在线，`/c/actions-runner/.ssh/zjdb_ed25519` 文件存在且 ACL 设置正确]
- [ASSUMPTION: `douyin-read` 的 line02 keyword→comment smoke 脚本不依赖 rog 上的特定路径/工具，或 pc4 上已安装同样环境]
- [ASSUMPTION: pc4 手机池 `192.168.3.x` 设备在夜间 UTC 19:00 时段在线]

---

## 关联决策

- `decision 2f11ae25`：envfail 与真机验证失败同级计红，不准包装成绿
- `promote-all-prod.yml` 证据②：job 名 `startswith("真安卓")` 匹配，runner 迁移不改 job 名，无需同步修 promote

---

## Invariant 约束

- [INVARIANT-1] `wechat-bubble` job 必须保留 `[self-hosted, wechat-capable]`（rog），不得迁移（wechat-hook 依赖 rog 微信环境）
- [INVARIANT-2] `douyin-read`/`account-scan` job 名称不得更改（`promote-all-prod.yml` 的 `startswith("真抖音")`/`startswith("真安卓")` 匹配逻辑依赖 job name）
- [INVARIANT-3] `nightly-real-machine-staging.yml` 的 `needs` 依赖链（wechat-bubble → douyin-read → account-scan → nightly-report）不得改动
- [INVARIANT-4] DB_SSH_* 环境变量配置不得删除（pc4 上已就绪，account-scan 需通过 SSH 隧道访问 DB）

---

## 累积 FR

- [FR-1] 将 `douyin-read` job 的 `runs-on` 从 `[self-hosted, wechat-capable]` 改为 `[self-hosted, android-capable]`
- [FR-2] 将 `account-scan` job 的 `runs-on` 从 `[self-hosted, wechat-capable]` 改为 `[self-hosted, android-capable]`
- [FR-3] 同步更新两个 job 内的注释，反映迁移到 pc4 出境网络方案

---

## NFR

- [NFR-1] 变更仅限 `.github/workflows/nightly-real-machine-staging.yml`，零代码路径改动，review diff < 20 行
- [NFR-2] 合入后不得导致 `wechat-bubble` runner 绑定发生变化（keep-green 约束）

---

最后更新: 2026-08-04

journey_type: ci_fix
target_environment: ci_config
