# Sprint PRD — Line04 AI 思考浮窗 接续刀（部署闭环 + 会话跟随画像卡）

task_id: c4518759-8a5f-4beb-9cfe-a5c35d95aa07
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
journey_type: user_facing
target_environment: windows_cloud
thickness: thin
sprint_dir: sprints/07150800-line04-overlay-continuation
date: 2026-07-15

## Journey 定位

**客户私域 AI 接管**（Path 4）—— 第三刀。前两刀（PR#1239/#1245/#1256）已把全局流水版浮窗交付 main 1.0.117，但停在半路：没有 staging 部署、没有用户 promote、没有 xian-rog 正式复验，台账 status 长期停在 planned。本刀分两个里程碑补齐闭环。

路径声明：本 PR 把 Path 4「AI 思考浮窗」从 thin-可用（代码在 main）推到 thin-闭环（staging 部署 + 正式复验 + 会话跟随画像卡）。

---

## 地基声明（禁止重做）

以下均已在前两刀交付，本刀**直接复用，禁止重写**：

- `services/agent/wechat-rpa/overlay/pii_filter.py`（PII 过滤纯函数）
- `services/agent/wechat-rpa/overlay/preflight.py`（软检测）
- `services/agent/wechat-rpa/overlay/watchdog.py`（熔断守活）
- `services/agent/wechat-rpa/overlay/overlay_window.py`（窗口本体 + 贴靠循环 + tail 消费）
- `services/agent/modules/line04/handlers/overlay.ts`（node 侧接线）
- `apps/api/src/services/wechat-draft.ts`（reasoning 合同扩展 + PII 硬闸）
- `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh`（第一刀 smoke）
- `.github/workflows/scripts/smoke/line04-ai-overlay-r2-smoke.sh`（第二刀 smoke）

---

## Invariant 约束（继承前两刀 12 条，本刀无新增）

1. events.jsonl 唯一写者 = listen_chat（O_APPEND）；浮窗只读 tail，严禁写入
2. reply_sent 挂点 = listen_chat.py:4787 DELIVERED 调用点，禁挂 `_commit_reply_success` 本体
3. reasoning 单一来源 = LLM 合同 JSON 字段（≤30字）；openrouter.ts:126-132 剥离纪律不动
4. customer_stage 复用既有 tags.stage（A1-A4），禁另造取值域
5. PII 双硬闸：中台返回前截断 + agent 写 events 前二次执行同一纯函数
6. 浮窗软检测禁止进 manifest requiredChecks
7. 崩溃熔断：60min 内 8 次存活<60s → 熔断静默，agent 重启复位
8. 用户关闭 = exit_code 0 + user_closed=true，守活只对非零退出码重拉
9. events.jsonl 路径在 _STATE_DIR 下，严禁 C:\Users\Public
10. event_id 幂等去重按整串精确匹配；epoch_ms 仅展示排序用
11. 浮窗只观察微信窗口，绝不干预（防两进程拉扯）
12. 异常态一律温和文案+变灰，禁"错误/中断/!"字样

本 sprint 无独立新增 invariant，完整继承上述 12 条。

---

## 累积 FR

### 里程碑 A：补部署闭环（前置门槛，必须先完成）

**FR-A1：main 1.0.117 部署到 staging**

F-A1.1 触发 staging 部署 workflow，确认 staging 环境运行 1.0.117 含 overlay 代码  
F-A1.2 staging health check 通过（API /health 200，agent 版本号匹配）

**FR-A2：用户 staging 手动 promote**

F-A2.1 用户在 staging 上完成 promote 确认（staging-promote-smoke.sh 路径 1 全绿）  
F-A2.2 生产切换后 /health 版本断言通过

**FR-A3：xian-rog 正式复验（非临时热修）**

F-A3.1 走正式安装包流程安装 1.0.117（不用临时热修补丁）  
F-A3.2 真发一条微信消息 → events.jsonl 新增 reply_sent（含 reasoning，无 PII）→ 浮窗截图含该条目  
F-A3.3 浮窗贴靠跟随微信窗口，非 IsIconic 时可见  
F-A3.4 截图 + events.jsonl 片段作为验收证据存入 sprint 目录

**FR-A4：台账回写**

F-A4.1 完成后写入 brain `/api/brain/journey_features` status = done（对应 overlay thin-可用节点）  
F-A4.2 golden_path 表补充里程碑 A 验收记录

### 里程碑 B：会话跟随客户画像卡（thin cut，A 验收通过后才开始）

**FR-B1：画像卡数据结构**

F-B1.1 中台新增 `GET /api/wechat/customer-profile?wechat_id=<id>` 接口，返回：等级（A1-A4）/ 基础信息（昵称/来源）/ 联系次数 / 近期动态摘要（≤2条）/ AI画像（reasoning 聚合≤50字）  
F-B1.2 从既有 CRM 表（customers/leads/wechat_cs_configs）组装，禁新建表

**FR-B2：浮窗会话跟随逻辑**

F-B2.1 overlay_window.py 新增 `switch_customer(wechat_id)` 方法，调用中台接口拉取画像卡数据并更新 DOM  
F-B2.2 events.jsonl 新增 `session_switch` event type（listen_chat 发出），携带 `wechat_id` 字段  
F-B2.3 tail 消费端检测到 session_switch 事件 → 调用 switch_customer，画像卡内容随之切换  
F-B2.4 全局事件流保留但降级为次要小字区域（样式调整，无逻辑删除）

**FR-B3：CI 覆盖**

F-B3.1 pytest 新增 2 case：切换 wechat_id_A → 画像卡显示 A 数据；切换 wechat_id_B → 画像卡显示 B 数据  
F-B3.2 vitest 新增 1 case：`/api/wechat/customer-profile` 返回正确结构断言  
F-B3.3 golden-path-4-smoke.sh 追加里程碑 B 断言（至少 2 个不同客户画像卡内容切换验证）

---

## NFR

| 指标 | 阈值 | 超限动作 |
|------|------|--------|
| 画像卡接口响应 P95 | ≤500ms | 超限写 diag 日志 |
| session_switch → 画像卡更新延迟 P95 | ≤1.5s | 同上 |
| 内存 RSS（继承前刀） | 连续 2 心跳 >200MB → GC；>300MB → 自杀重启 | — |
| 浮窗不获焦（继承前刀） | GetForegroundWindow 不变 | — |

---

## 不包含（范围外）

- 中台浮窗监控看板页——另立 sprint
- 画像卡多号矩阵视图——加厚阶段
- listen_chat 守活退避阶梯——超范围
- 里程碑 B 在里程碑 A 未验收通过前不得开始

---

journey_type: user_facing
target_environment: windows_cloud
