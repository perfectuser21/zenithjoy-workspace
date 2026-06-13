# Sprint PRD — Path 2 抖音私信主动触达（thin v1）

## OKR 对齐

- **对应 KR**：Path 2 客户智能获客路径 — 评论区挖客闭环触达能力
- **当前进度**：Step 3/5 已完成（绑飞书建表 + burner 小号 session 隔离），抓评论→写飞书 Lead + comment-grader 已就绪
- **本次推进预期**：新增 Ability「抖音私信主动触达」thin，从无到「中台可派单 → agent 真发 → 飞书回写状态」打通

## 背景

Path 2 已能抓对标视频评论、写飞书 Lead 表、对 Lead 意向打分。但「挖到客后主动触达」这一步还缺：运营拿到一个抖音主页 URL 只能手动开抖音去私信。本 sprint 补上「中台派单 → xian-pc 常驻 agent 驱动已登录抖音 chrome 发 1 条私信 → 结果回写飞书 Lead」的最小闭环。

## Golden Path（核心场景）

运营对一个 lead（抖音主页 URL）发起「私信触达」 → 经过 中台派单、agent 真发、结果回报 → 飞书 Lead 行状态更新为「已私信/未送达/失败」

具体：
1. 运营在中台/脚本对一个 lead 发 POST「私信触达」（抖音主页 URL + 一段固定文案）→ 中台落一条 task_type=dm_outreach / platform=douyin 的 task → 返回 task_id
2. xian-pc 常驻 agent 轮询拿到 task → 进对方抖音主页（模拟滑动 + 随机停留）→ 系统状态记为「触达中」
3. agent 点「私信」按钮 → 聊天框输入文案 → 回车发送 → 出现消息气泡 = sent
4. 若对方「仅互关 / 回复前只能发 1 条」受限 → agent 标记 limited；若报错 → failed
5. agent 回报中台（status + 截图证据）→ 中台把结果写回飞书 Lead 表对应行：sent→「已私信」/ limited→「未送达-仅互关」/ failed→「失败」，附时间 + 触达小号
6. 运营在飞书看到该 lead 状态更新

> 出错恢复：agent 那台 chrome 登录态失效 / 触发风控 → 回报 error_code=SESSION_EXPIRED / RISK → 中台标记该 session 停用 + 该 task failed，不连坐其他号；飞书显示 failed 原因。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 对方仅互关受限 → 必须如实标 limited，禁止假装 sent
- session 失效 / 风控 → error_code 区分，单号停用不连坐
- 同一 lead 重复派单 → 本 thin 不去重，按新 task 处理（去重留加厚）

## 范围限定

**在范围内**：单条 dm_outreach 派单 + 单一固定/传入文案 + agent douyin-dm-outreach handler（真 CDP 发送）+ 结果回写飞书 Lead + fake-agent smoke 验编排与回写 + agent 版本 bump 重打包
**不在范围内**：自动调度器（定时从飞书捞 lead 批量派）、变体话术 LLM、5 小号多触同一目标、关注+评论养熟、crawl 拆干净「主页URL」列（另立 sprint）

## 假设

- [ASSUMPTION: 飞书 Lead 表回写复用 lead-writer / feishu-bitable-multitenant 现有写表能力，新增「触达状态」字段映射]
- [ASSUMPTION: 派单 + 上报链路复用 agent-burner 派单 + _smoke-fake-agent-burner fake-agent 模式]
- [ASSUMPTION: 真发 CDP 机制已验证（semi-button-second 私信按钮 + contenteditable 输入框 + Enter），本 sprint 自动 E2E 不含真发]

## 预期受影响文件

- 中台派单/上报路由（dm_outreach task 类型 + status/error_code 回报入口）：复用 agent-burner 派单链路
- agent 端：新增 `douyin-dm-outreach` handler（真 CDP 发送逻辑）+ agent 版本 2.0.13 → 2.0.14 bump + 重打包
- 飞书回写：lead-writer / feishu-bitable-multitenant 增「触达状态」回写
- smoke：`.github/workflows/scripts/smoke/golden-path-2-dm-smoke.sh`（新增，fake-agent 模式）

## E2E 验收

> Planner 初稿占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql + fake-feishu），写进 contract-draft.md。

```bash
# 占位：proposer 按 local_api 填入真实脚本（curl localhost 派单 + fake-agent 上报 + 查 DB task 状态 + fake-feishu 校验 records 更新）
# 期望验收点（自然语言）：
#  1. POST 派 dm_outreach → DB 落一条 task_type=dm_outreach / platform=douyin
#  2. fake-agent 报 status=sent → fake-feishu 收到对应 Lead 行更新为「已私信」
#  3. fake-agent 报 status=limited（仅互关）→ 飞书行写「未送达-仅互关」，不标成功
#  4. fake-agent 报 error_code=SESSION_EXPIRED → task=failed + 该 session 标停用，不连坐其他号
#  （真发：xian-pc 真机 CDP 手验，证据附 sprint，不入自动 E2E）
```

## journey_type: agent_remote
## journey_type_reason: 核心是 xian-pc 常驻 agent 通过远端协议接 douyin-dm-outreach handler 驱动真机 chrome，属远端 agent 协议范畴
## target_environment: local_api
## target_environment_reason: Final 自动 E2E = fake-agent smoke 验中台编排 + 飞书回写，跑本地 curl+psql+fake-feishu；真发 xian-pc 手验不入自动 E2E
## journey_id: afa6abca（Path 2 客户智能获客路径，来源 = task.payload.journey_id）
## step_id: L02-S6（评论区挖客闭环 — 主动私信触达，PrepPRD Golden Path 锚定结果）
