# Sprint PRD — 真机验证车道 + 防假绿三层守卫

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖（当前 82%）；本任务修 CI 假绿结构性缺口，直接推进"系统可信赖"。
- **本次推进预期**：补齐 F3 夜间体检 Journey 的"刀D"真机预留位，不改变百分比口径，但消除一类已发生过的"假绿掩盖真机 bug"风险。

## 背景

安卓 Path2 账号扫描的 `OPEN_PANEL_FAILED` 真机 bug 让客户上不了线，却卡了两三周没被发现——因为
`golden-path-2-smoke.sh` 里管这一步的断言（Step 30/31）是把结果写死在自己发的请求里的服务端记账
测试（curl 发一个 `error_code=OPEN_PANEL_FAILED` 的假 payload，再断言数据库记下了
`OPEN_PANEL_FAILED`），永远不可能因为真机 bug 而报红。本 sprint 建三层机制，让这种"假绿"结构上
不再可能：第2层（核心）真机验证车道、第1层诚实标注+lint守卫、第3层接入 ci-patrol 棘轮。

## Golden Path（开发者视角，单线性）

1. 开发者（或 nightly 定时）触发真机账号扫描验证 job → job 在 xian-rog 上 `install -r` 最新 APK
   （覆盖装，不卸载，保住注册态）→ adb 用 `settings put` 开无障碍服务
2. job 脚本按 hostname 型号 + 最新心跳定位设备真实 agent_id（不写死旧 id）→ 调
   `POST /api/acquisition/account-scan/trigger` 拿 task_id → 系统写入 publish_tasks
3. job 脚本轮询 `publish_tasks.status` + `response->>'error_code'` 终态 → 拿到
   done / OPEN_PANEL_FAILED / MUTEX_BUSY / 超时 之一
4. job 断言 **`status='done'` 且 `account_ids` 非空**（真读到账号）→ 绿；任何非 done → 红，自动开
   `[nightly-red]` issue，失败留证据 → 出口：每晚一份真实账本
5. **第1层**：所有 `golden-path-*-smoke.sh` 里"用假 payload 顶替真机行为"的步骤必须带
   `# [CI-MOCK: real-device-only]` 标记 → 新建 `lint-smoke-mock-honesty.sh` 扫出自我实现假测试，
   漏标记 → CI 红
6. **第3层**：ci-patrol 每日统计"带 [CI-MOCK] 但无对应 nightly 真机 job 覆盖的步骤数"，纳入现有
   guard 棘轮（只降不升，升了开 issue）；golden path 步骤标 `done` 补硬约束：必须有 nightly 真机
   job 绿的证据链

## 边界情况

- xian-rog runner 掉线/设备离线 → job 标 `infra-skip`，不算绿也不算红（禁止默认通过）
- 测试 license（`ZJ-F-CLDCQNT6`，免费版限1机）被人工测试占满 → 单独评估申多机位 license，本 sprint
  不解决配额分配本身，只保证真机车道不因抢占而假绿

## 范围限定

**在范围内**：
- 新建 `account-scan-realmachine-smoke.sh` + 在 `nightly-real-machine-staging.yml` 加"刀D"预留 job
- 给 `golden-path-*-smoke.sh` 假 payload 步骤加 `[CI-MOCK: real-device-only]` 标记
- 新建 `lint-smoke-mock-honesty.sh`，接入 L1 Process Gate
- ci-patrol 硬伤巡检加"未经真机验证的 golden path 步骤数"指标，接入现有棘轮

**不在范围内**：
- 修 agent 心跳 `last_seen`/`last_heartbeat_at` 双字段不一致（已登记 issue，单独处理）
- 给 Path2 补建 golden_path/journey_features 结构化记录（已登记 issue `cbe9ed30`）
- 真机 OTA 自更新能力

## 假设

- [ASSUMPTION: 本 sprint 沿用现有测试 license `ZJ-F-CLDCQNT6`（限1机），不新申多机位 license；若与
  人工测试抢占配额，按 PrepPRD 记录单独评估]
- [ASSUMPTION: 设备定位沿用"hostname 型号 + 最新心跳"策略，若 `last_heartbeat_at` 字段本身不一致
  导致定位失败，按已登记 issue 单独处理，不阻塞本 sprint]

## 预期受影响文件

- `.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh`：新建，真机验证车道核心脚本
- `.github/workflows/nightly-real-machine-staging.yml`：加"刀D"预留位 job
- `.github/workflows/scripts/lint-smoke-mock-honesty.sh`：新建，第1层 lint 守卫
- 现有 `golden-path-*-smoke.sh`：加 `[CI-MOCK: real-device-only]` 标记
- ci-patrol skill 相关巡检脚本：加"未经真机验证步骤数"指标 + 棘轮接线

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area+ability+None 三级合并，共 94 条中筛出与本 sprint（CI真机
验证/防假绿/环境接缝）直接相关的子集；其余为跨领域 learning（部署链/微信客服/harness 内核等），
与本 sprint 无关，未逐条列出 -->

- [环境接缝守卫未强制] 真机失败路径服务端零留痕已连续复发多次（agent-burner.ts 对 ok=false 无条件
  跳过持久化、customer-admin.ts 绑定失败只返回4xx不写库、sweep-timeouts 看门狗未被 scheduler 调用）
  ——CI 闸尚未强制，本 sprint 属于同类"环境接缝无守卫"问题的第一个机械化闸（来源: None级）
- [禁止写死环境假设值]（来源: area, [系统]）
- [真环境验证才算done]（来源: area, [系统]）
- [target_environment从DB读] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时
  必须正确设置（来源: agent-offline-alert learning）
- [harness judge需按环境校准证据] harness judge 未按 target_environment 校准证据要求会导致假阳性
  验收（wechat-cs-reply run e74341f4 实证）（来源: None级）
- [失败不抛异常需显式处理] 调用"失败返回null/false"契约的函数时，写完成功分支必须显式写失败分支
  处理，不能隐式吞掉（来源: area learning）
- [后台job失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area learning）
- [judge结果需顶层字段] Brain judge `.brain-result.json` 必须有顶层 exit_code + log_tail（来源:
  agent-offline-alert learning）
- [部署失败禁降级] 任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（来源: area
  learning，虽为部署链场景，但"失败不可静默"原则适用于本 sprint 的 infra-skip 判定）
- [测试默认多租户]（来源: area, [系统]）
- [端点鉴权] / [租户隔离] / [凭据安全] / [日志脱敏]（来源: area, [系统]，通用横切约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /api/brain/journeys/ec4eb591-e064-4886-a7b6-4452cdf333d2/golden-paths，查询结果为空数组 -->
- （本 line 暂无历史：F3 夜间体检 Journey 尚无已验收 ability 的 golden_path 记录，本 sprint 是该
  Journey 下第一个正式 ability）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 共24条，均属 Line04 微信客服域（前后台/频控/延迟等），与本
sprint（CI真机验证车道/防假绿）无匹配项；PrepPRD 亦未显式给出数值型 NFR -->

NFR: N/A（PrepPRD 未指定超时/频控数值；decisions 表 category=nfr 无匹配本 sprint 领域的条目。
proposer 如需具体轮询超时/重试次数等参数，按 PrepPRD Golden Path Step 3"轮询终态"的语义自行定义
合理默认值，并记入合同）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_wechat（xian-rog 真机）产出。

```bash
# 期望验收点（自然语言，proven-to-fire 三层缺一不可）：
# 1) 第2层：account-scan-realmachine-smoke.sh 在 xian-rog 上首次真实跑通一次
#    （install -r → adb 开无障碍 → 触发 account-scan → 轮询 publish_tasks 终态 →
#    status='done' 且 account_ids 非空）；故意 revert 一个真机修复后重跑必须报红
#    并自动开 [nightly-red] issue，看到红后再撤回 revert。
# 2) 第1层：lint-smoke-mock-honesty.sh 对所有 golden-path-*-smoke.sh 生效；
#    故意加一段"写死结果的假断言"或删掉某步骤的 [CI-MOCK] 标记，必须报红。
# 3) 第3层：ci-patrol 棘轮对"带 [CI-MOCK] 但无 nightly 真机 job 覆盖"的步骤数生效；
#    故意新增一个此类步骤，ci-patrol 必须报红开 issue。
# 4) nightly-real-machine-staging.yml 里能看到新 job，下一个夜间窗口自动跑；CI 全绿。
```

## journey_type: autonomous
## journey_type_reason: F3 夜间体检 Journey（ec4eb591）在 Brain DB 中已登记 journey_type=autonomous，本 sprint 的三层机制性质是 dev_pipeline/夜间巡检基建，非用户直接交互的业务功能，归属该 Journey 最贴切
## target_environment: windows_wechat
## target_environment_reason: 真机验证车道跑在 xian-rog self-hosted runner（label wechat-capable）上，是当前唯一承载真机 Android/微信双能力的 GHA runner，按点火指令显式指定
## journey_id: ec4eb591-e064-4886-a7b6-4452cdf333d2
## step_id: line02/customer_smart_acquisition#step7
