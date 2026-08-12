# Sprint PRD — ZenithJoy Product Map 7 Value Streams / 18 Capabilities 修复

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付（当前 active，进度 77%）
- **当前进度**：77%
- **本次推进预期**：不直接推数值；消除 product-map SSOT 与目标分类的漂移，防止下游 Cecelia Universal Map 投影/统计口径失真

## 背景

用户已拍板：ZenithJoy 产品分类唯一手写 SSOT `product-map/product-map.yaml` 与目标分布不一致——line00 现有 4 条非废弃 Golden Path（目标 3 条，多 1 条）；line05/line07/line10 三条 Value Stream 及其 App/Line 尚未在 yaml 中定义（目标各 1 条 Capability）。Cecelia 侧 Universal Map 投影逻辑已完成、本次零改动，只修 ZenithJoy 侧 SSOT。前两次尝试（cb40da23 kernel 跨仓限制、fbda0e7e Codex Relay 401）均在生成代码前终止，本次改走已验证可用的 Claude headed skill-relay 通道。

## Golden Path（核心场景）

开发者从"编辑 product-map.yaml" → 经过"generate 投影 + check 校验" → 到达"7 Lines / 18 Capabilities 精确匹配，无漂移"

具体：
1. 编辑 `product-map/product-map.yaml`：
   a) 重命名：line01→"Line 01 智能发布"、line02→"Line 02 智能获客"、line04→"Line 04 智能客服"、line00→"Line 00 运营中枢"（customer_first_success 原样保留为 line01 下 Capability）
   b) customer_app 新增两条 Line：line05="Line 05 视频剪辑"、line07="Line 07 AI爆款视频翻拍"
   c) staff_app 新增一条 Line：line10="Line 10 客户管理"
   d) line05/07/10 各新增 1 条 status=active 的 Golden Path，均锚定现有 smoke（不新写业务代码）：
      - line05：锚定 `.github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh`（createJob→查询进度 5 字段→缺字段 400→completeJob 完整生命周期，已在 CI 跑）
      - line07：锚定 `.github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh`（文件自身注释已标注"Line 07 AI爆款视频翻拍"）
      - line10：锚定 `.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh`（文件自身注释已标注"Line 10 客户管理后台"，接入 ci-l4-e2e-smoke.yml）
   e) line00 现有 4 条非废弃 GP（skill_acceptance / ability_acceptance / line_health / gp_anchor_enforcement）收敛为 3 条：gp_anchor_enforcement 受 `gp_anchor: line00/gp_anchor_enforcement keep-green` 保护不可动；skill_acceptance 与 ability_acceptance 疑似功能重叠（决策 fc7b5dc0：验收/展示已重写为 Staff Hub 直连 Brain），二选一标记 `status: deprecated`（保留条目，不删除）
2. 跑 `npm run product-map:generate` 重建 `product-map/generated/{product-map.json,product-map.md}`
3. 跑 `npm run product-map:check`，输出 7 Value Stream / 18 Capability 精确匹配、无漂移
4. failing-first 合同测试验证：跨 7 条 line 的精确分布（line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1）+ deprecated 条目存在但不计数 + Cecelia 仓库 0 文件改动

## 边界情况

- line03 GEO、line06 小龙虾不纳入本轮，yaml 不新增其对应 Line
- 已 deprecated 的 customer_smart_acquisition / customer_private_ai 及 line00 收敛出的 1 条保留条目原样，不删除、不计数
- line02 三条 status=proposed 占位 GP（live/video_link/benchmark_link_acquisition）维持原状态；proposed ≠ deprecated，仍计入非废弃

## 范围限定

**在范围内**：`product-map/product-map.yaml` 手写编辑、`product-map:generate` 重建投影、`product-map:check` 校验、新增/调整合同测试（`scripts/product-map/__tests__/`）
**不在范围内**：Cecelia 仓库任何文件；新建手工 registry/扫描分类脚本；line03/line06；line05/07/10 之外新业务代码

## 假设

- [ASSUMPTION: line00 skill_acceptance 与 ability_acceptance 二选一标 deprecated——具体选哪个由 Proposer 在合同阶段依据决策 fc7b5dc0 核实后定稿，Planner 不替业务拍板]
- [ASSUMPTION: line05/07/10 三条新 GP 的最终 id/name 由 Proposer 定稿；本 PRD 给出的锚定 smoke 文件为强约束（必须复用现有 smoke，不得新写业务代码）]

## 预期受影响文件

- `product-map/product-map.yaml`：唯一手写 SSOT，本次全部改动落点
- `product-map/generated/product-map.json`：generate 重建产物
- `product-map/generated/product-map.md`：generate 重建产物
- `scripts/product-map/__tests__/product-map.test.js`（或新增同目录测试文件）：failing-first 合同测试

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定；本 sprint 为静态配置校验，无运行时延迟要求）
- 频控: 不适用
- 版本要求: 空
- 可观测: `product-map:check` 失败必须返回非零 exit code（CLI 既有约定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/journey_feature 级为空（本任务无 ability_id/journey_id）；area 级 80 条中业务专属条目 0 命中，仅注入系统级通用铁律 -->
- [并发] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [环境假设] 禁止写死环境假设值，接缝值须真验或从环境推导（来源: area）
- [完成判定] 真环境验证才算 done；未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 单元/E2E 测试默认种≥2 租户并断言互不串（来源: area，本 sprint 无租户数据场景，不适用可标 N/A）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area，本 sprint 不新增端点，不适用可标 N/A）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area，本 sprint 不碰租户数据，不适用可标 N/A）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: task.payload.journey_id 为空（非 /dev 路径C点火），无法查询本 line 已验收 golden_path 历史 -->
- （本 line 暂无历史）

## E2E 验收

Planner 初稿区块留空，占位见下；proposer 在 GAN 阶段按 target_environment=local_api 填入真实脚本。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实 node/npm/psql 脚本
# 期望验收点（自然语言）：
# 1. npm run product-map:generate 后 git diff --stat generated/ 为空（无未提交的生成产物漂移）
# 2. npm run product-map:check 返回 exit 0
# 3. product-map/generated/product-map.json 的 apps[].lines 精确等于 7 条：line01/02/04/05/07（customer_app）+ line00/10（staff_app）
# 4. golden_paths 中 status != deprecated 精确等于 18 条，按 line 分布 line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1
# 5. golden_paths 中历史 deprecated 条目（customer_smart_acquisition/customer_private_ai/line00 收敛出的 1 条）原样保留、不计入 18
# 6. git diff --name-only 只含 product-map.yaml + generated/* + scripts/product-map/__tests__/* + sprints/**，无 Cecelia 仓库路径、无新增 registry/scan 脚本文件
```

## journey_type: autonomous
## journey_type_reason: 改动限于 YAML 配置 + CLI 生成脚本 + Node 测试，无 apps/dashboard UI、无远端 agent 协议、无 packages/engine skill，纯后端配置校验场景，命中默认分支
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式给定 local_api；验证方式为 node CLI（product-map:generate/check）+ npm test，无浏览器/Windows/远端服务器依赖
## journey_id: none
## step_id: none（PrepPRD 未锚定；scope 锚点见 gp_anchor: line00/gp_anchor_enforcement keep-green）
