# Sprint PRD: 刀B M1 — 安装器清环境 + 启动死路消灭 + 装机 E2E

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 2f66a0f8-a15e-4a42-9b9c-2841fc99ba66 |
| sprint_dir | sprints/07201700-installer-env-reset-m1 |
| journey | Path 1 客户首次成功（358c40c2-ba63-81b2-a6ea-cd288cf82f29）|
| journey_type | user_facing |
| target_environment | windows_cloud |
| maturity | thin（M1，四件套①③，decision c7022118）|
| decision_refs | c7022118（安装框架方向拍板）/ 9202c14e（部署链禁 warning 降级）/ fc17d9eb（判据折进 golden path）|

## 本 Sprint 推进声明

本 PR 把 Path 1 Step 2（装客户端 + Agent 自动连中台）的安装/更新健壮性从"带病可跑"推进到"每次安装/更新前先收敛环境"，具体：

- **四件套①**：setup-reset 前置清理器（打包进 installpack，安装/更新第一步执行）
- **四件套③**：中台 `POST /api/agent/boot-fail` 端点 + `agents.last_boot_error` 列 + AdminCustomersPage 诊断展示
- **装机链 E2E**（四件套④）：windows-latest GHA 解包→setup-reset→start 链 dryrun→断言收敛态 + 变异场景 401 断言 fail-report 真发出

> 不做：进度条 UI（四件套②已交付刀A）/ 离线推送告警（独立 task 61d16207）/ 安卓端

## 背景

XIAN-PC 0720 全套病灶（handoff 202607201215-452bbf5c 补充，memory handoff_0720_knifeA_pywebview_supply_shipped）：

1. HKCU 残留 `ZENITHJOY_API_BASE=staging` 致生产 license 401 → 隐藏窗口 pause 卡死 2 天
2. 自启计划任务指向已被 purge 的旧目录（旧版 agent 清除后任务残留）
3. stale `.launcher.lock`（持有 PID 已死）
4. 僵尸 `start.bat` cmd 窗口 × 3

根因：安装/更新流程没有"先清环境"步骤，脏环境在多次更新后叠加，直至死机。

start.bat 当前所有失败路径均走 `pause`，在 wscript 隐藏窗口模式下永久卡死，用户无任何错误信息可见。

## Golden Path（核心场景）

**客户或运营在客户机上安装/更新 ZenithJoy Agent：**

1. 运行 installpack（解包 + setup-reset.ps1 执行）→ 系统自动杀 zenithjoy 全进程树、清 ZJ* 僵尸计划任务、删 stale lock、收敛 HKCU `ZENITHJOY_*` 环境变量（未在声明文件中出现的一律删除，rog/staging 机靠声明文件合法保留）、校验 + 重建 `ZenithJoyAgent` 自启计划任务指向当前目录（`schtasks /delete /tn` + `/create /it`，删+建，不用 `/change`）
2. start.bat 任意步骤失败 → 写失败原因到 `%APPDATA%\zenithjoy-agent\boot-error.json` + curl 上报中台 `POST /api/agent/boot-fail`（无 license 可报，带 machine_id + hostname + reason）+ 终端可见报错（非 pause），进程立即退出
3. 中台落库 `agents.last_boot_error jsonb` 列，AdminCustomersPage 诊断页展示 boot 失败原因
4. GHA windows-latest E2E：断言收敛态（无残留任务/锁/未声明 env）+ 变异：造 401 场景断言 fail-report 真发出（proven-to-fire）

## 范围

**在范围内：**

- `services/agent/install-pack/setup-reset.ps1`：新建，清理器全部逻辑，打包进 installpack
- `services/agent/install-pack/build-install-pack.sh`：在解包后第一步调用 setup-reset.ps1
- `services/agent/install-pack/start.bat`：所有 `pause` 失败路径改为写 boot-error.json + curl fail-report + 可见报错 + `exit /b 1`
- `apps/api/src/routes/agent.ts`（或 agent-fleet.ts）：新增 `POST /api/agent/boot-fail` 端点，落库 agents 表
- `apps/api/db/migrations/20260720_agents_boot_error.sql`：`ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_boot_error jsonb`
- `apps/dashboard/src/pages/AdminCustomersPage.tsx`：展示 `last_boot_error`（reason + timestamp）
- `.github/workflows/scripts/smoke/installer-env-reset-smoke.sh`：装机链 E2E，windows-latest 断言
- `golden-path-1-smoke.sh` Step 2：回流装机链判据

**不在范围内：**

- 进度条 UI（四件套②，刀A已交付）
- 离线推送告警（独立 task 61d16207）
- 安卓端任何内容
- pywebview 供给（刀A 已交付 PR #1429）
- 多 Weixin.exe 收敛 / 孤儿 RPA Python（已由 bootstrap-convergence.ts 覆盖）

## 假设

- [ASSUMPTION: HKCU 环境变量"声明文件"为 install-pack 内的 `.env`（安装后 `.env` 即为唯一真相源）；setup-reset 读 `.env` 中声明的 key 列表，HKCU 中 `ZENITHJOY_*` key 不在列表内 → `reg delete`]
- [ASSUMPTION: `POST /api/agent/boot-fail` 不要求有效 license（bearer 可为空/无效），识别 `machine_id` + `hostname` + `reason` 字段即可落库]
- [ASSUMPTION: setup-reset.ps1 用 PS5.1 纯 ASCII，不含 em-dash/全角字符（decision 9202c14e CI lint 要求）]
- [ASSUMPTION: schtasks `/delete /tn ZenithJoyAgent /f` + `/create /it` 每次安装幂等执行，不用 `/change`（避免 `/change` 对不存在任务的报错）]
- [ASSUMPTION: GHA windows-latest E2E 中 setup-reset + start 链用 dryrun 模式（`ZJ_LAUNCH_PROBE` seam 已有），不启动真 agent 进程]

## 代码变更地图

```
新增  services/agent/install-pack/setup-reset.ps1          # 前置清理器
修改  services/agent/install-pack/build-install-pack.sh    # 调用 setup-reset
修改  services/agent/install-pack/start.bat                # 消灭所有 pause 失败路径
新增  apps/api/db/migrations/20260720_agents_boot_error.sql  # agents.last_boot_error jsonb
修改  apps/api/src/routes/agent*.ts                        # POST /api/agent/boot-fail 端点
修改  apps/dashboard/src/pages/AdminCustomersPage.tsx      # boot_error 诊断展示
新增  .github/workflows/scripts/smoke/installer-env-reset-smoke.sh  # 装机链 E2E
修改  .github/workflows/scripts/smoke/golden-path-1-smoke.sh        # Step 2 回流判据
```

Agent 版本必须 bump（改 agent 铁律，decision feedback_agent_version_bump）。

## Invariant 约束

> 来源三源：① `docs/production-invariants.md`（production-invariants）② decisions 表 category=invariant ③ PrepPRD 明确约束

| # | 约束 | 来源 | 违反处理 |
|---|---|---|---|
| I-1 | **禁 warning 降级**（9202c14e）：setup-reset 和 start.bat 所有失败路径禁止 `echo [WARN]` + 继续；必须明确报错 + 上报 + 退出 | decisions 9202c14e | CI lint 拦截 / PR 拒绝 |
| I-2 | **PS5.1 纯 ASCII**：setup-reset.ps1 及所有新增 PowerShell 脚本体严禁 em-dash / 全角标点 / 非 ASCII 字符 | PrepPRD 铁律 | CI `lint-ps-ascii` 拦截 |
| I-3 | **改 agent 必须 bump 版本**：任何 services/agent 变更必须同步 bump core 版本（9 处口径：manifest×2 + required_version + 4 smoke 锚 + lock） | decisions invariant | PR 描述须含 bump 证据 |
| I-4 | **新 smoke 进 baseline**：installer-env-reset-smoke.sh 必须进 ci-l4-e2e-smoke.yml required checks | decisions fc17d9eb | CI 配置未更新 → 拒绝合并 |
| I-5 | **Agent 注册 & 心跳不破坏**：修改 agent.ts 路由不得影响现有 `POST /api/agent/heartbeat` 行为 | production-invariants §三·Agent 注册 & 心跳 | smoke agent-fleet-smoke.sh 红即阻断 |
| I-6 | **租户隔离**：`POST /api/agent/boot-fail` 落库需 tenant_id 关联（或通过 machine_id 解析租户），不跨租户返回 | production-invariants §二·Tenant 隔离 | 端点审查 |
| I-7 | **proven-to-fire 强制**：变异场景（造 401 → fail-report 真发出）必须在 smoke 内有对应失败路径断言，不得只有成功路径 | PrepPRD 铁律 | PR 描述须含 proven-to-fire 日志截图或 CI 日志链接 |

## 累积 FR

| # | Feature | 来源 Sprint / PR | 状态 |
|---|---|---|---|
| FR-1 | Agent 注册 + 心跳（30s）+ 在线状态 | 早期基础设施 | ✅ 已有 |
| FR-2 | .launcher.lock 单实例 supervisor 循环 | Sprint 07041301 (decision 72740815) | ✅ 已有 |
| FR-3 | .active-core 指针自升级（OTA swap） | Sprint 06222100 | ✅ 已有 |
| FR-4 | bootstrap-convergence.ts 启动归零 | Sprint 07171705 | ✅ 已有 |
| FR-5 | install-pack URL burn（dotenv 个性化烧入）| agent-installpack-url-burn | ✅ 已有 |
| FR-6 | ZJ_LAUNCH_PROBE E2E dryrun seam | start.bat 现有 | ✅ 已有 |
| FR-7 | **setup-reset 前置清理器**（四件套①）| 本 Sprint | 🔄 新增 |
| FR-8 | **start.bat 死路消灭**（pause → fail-report）| 本 Sprint | 🔄 新增 |
| FR-9 | **中台 boot-fail 端点 + 诊断页**（四件套③）| 本 Sprint | 🔄 新增 |
| FR-10 | **装机链 E2E + 变异 proven-to-fire**（四件套④）| 本 Sprint | 🔄 新增 |

## NFR

| # | 要求 |
|---|---|
| N-1 | setup-reset.ps1 总执行时间 ≤ 10s（客户安装体验），超时必须强制退出并上报，不可卡死 |
| N-2 | `POST /api/agent/boot-fail` 无需有效 license（401 场景下必须可达），接口无鉴权要求（machine_id + hostname 作识别），但需速率限制（同一 machine_id ≤ 10次/分钟） |
| N-3 | boot-error.json 写入必须原子（先写 tmp 再 rename），防止写到一半被读 |
| N-4 | DB migration 幂等（`ADD COLUMN IF NOT EXISTS`） |
| N-5 | setup-reset 对 HKCU 删操作：仅删 `ZENITHJOY_*` 前缀 key 中不在声明文件里的，绝不全删 HKCU（最小破坏原则）|
| N-6 | start.bat 改动不得引入新的 pause（regression 防护）；CI lint-no-pause 扫描所有 .bat 中的裸 pause |

## E2E 验收（smoke 定义完成）

smoke 文件：`.github/workflows/scripts/smoke/installer-env-reset-smoke.sh`

关键断言（windows-latest GHA）：
1. 解包后 setup-reset.ps1 存在于 installpack 目录
2. 执行 setup-reset（dryrun 模式）→ 无 ZENITHJOY_* HKCU 残留（reg query 断言）
3. ZenithJoyAgent 计划任务存在且指向当前目录（schtasks /query 断言）
4. 无 stale `.launcher.lock`（PID 死则文件删）
5. 执行 start.bat（ZJ_LAUNCH_PROBE=1 dryrun）→ probe-marker.txt 存在（链路通）
6. **变异 proven-to-fire**：造 ZENITHJOY_API_BASE=https://staging 残留 → start.bat 检测到 401 → `boot-error.json` 存在且 reason 含 `license_401` → curl fail-report 发出（中台 `/api/agent/boot-fail` 收到）

GP-1 Step 2 回流：在 `golden-path-1-smoke.sh` Step 2 内新增子断言调用上述 smoke 的关键断言（API 层等价，注明「真机段等价断言」）。

---

journey_type: user_facing
target_environment: windows_cloud
