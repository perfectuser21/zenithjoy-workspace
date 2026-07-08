# Sprint PRD：接入 wechat-cs-reply 判断内核

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | e74341f4-3c8a-4cce-80c2-4c52afaedb85 |
| sprint_dir | sprints/07081557-wechat-cs-reply-integration |
| journey | 客户私域 AI 接管（Line04，ID: bfeed805-deed-46c3-8624-87f0028101d4） |
| journey_type | user_facing |
| target_environment | local_api |
| maturity | not_started → skeleton |

## 本 Sprint 推进声明

本 PR 把 Line04 Step3（私聊 LLM 自动回复）从「自由发挥生成」推进到「wechat-cs-reply 规则内核约束」：
- Feature `wechat-cs-reply 判断内核接入`（5778a80a）：thin → medium
- Feature `中台转人工设置`（6739402d）：planned → 可用（新增 escalate 路径）
- Feature `客户状态变化历史追踪`（8a2d2b2f）：planned → thin（新增 `changed_by` 列 + AI 写入）

---

## Invariant 约束

（来源：Line04 路由架构 + 历史决策）

| # | 约束 | 出处 |
|---|------|------|
| I-1 | **AI 绝不承诺价格/退款/保成交**：reply 过 `sanitizeReply` 命中编造词 → `ai_failed` 不发，不发占位文案 | cs-route-decision contract |
| I-2 | **escalate 不阻塞对话**：escalate 告警入库失败 → `console.warn` 吞掉，客户仍收到安抚回复 | cs-outbound.ts 旁路写入惯例 |
| I-3 | **多租户隔离**：所有 CRM 写入必须带 `tenant_id`，通过 `requireCsWriteAccess` 闸 | crm.ts 架构约束 |
| I-4 | **客户 → 不含思考链**：`reasoning_content` 已在 `callOpenRouter` 剥离，禁止漏给客户 | wechat-draft.ts 注释 |
| I-5 | **changed_by 合法值**：`crm_customer_status_history.changed_by` CHECK IN ('ai_inferred','manual')，历史行回填 'manual' | 本次 migration |
| I-6 | **群消息永不回复**：`cs-route-decision.decideAutoSendRoute` 群消息 → `skip_group`，判断在 LLM 调用前 | cs-route-decision.ts |

---

## 累积 FR（Line04 已落地 Features）

| 状态 | Feature | 厚度 |
|------|---------|------|
| ✅ done | 对话记忆架构（短期/中期/长期 × 租户×联系人隔离） | mature |
| ✅ done | Step3 私聊 LLM 回复生成（`generateChatDraft`，自由生成） | mature |
| ✅ done | Step5 飞书审批后 spawn wechat_rpa.py 真发 | thin |
| ✅ done | 客服层多租户隔离 | medium |
| ✅ done | AI-native CRM 客户列表页（A1-A5 + 接管开关） | mature |
| ✅ done | 客服工作汇总统计页 | thin/building |
| ✅ done | cs-outbound 出站任务队列（播报/告警 → 关键人微信） | medium |
| 🔄 本次 | **wechat-cs-reply 判断内核接入**（替换自由生成） | thin→medium |
| 🔄 本次 | **中台转人工设置（escalate 路径）** | planned→可用 |
| 🔄 本次 | **客户状态变化历史追踪（changed_by 列）** | planned→thin |

---

## Golden Path（本次核心流程）

```
1. 客户发消息 → listen_chat.py → POST /api/wechat/draft-generate
2. generateChatDraft gating:
     群消息 → skip_group（不调 LLM）
     CRM 标黑 → skip_blacklisted（不调 LLM）
     通过 → 继续
3. context-assembler 装配 system prompt:
     = wechat-cs-reply 判断规则段（新增）
     + persona 人设段（自称/称呼/emoji/禁用词，不变）
     + 企业知识库段（不变）
4. 调 gpt-5.4-mini（WECHAT_CS_MODEL env 覆盖，走 TOAPI_API_KEY/toapis.com）
5. 解析输出 JSON:
     { reply: string, tags: { stage, signal, inquiry, risk, gap, escalate } }
     → reply 过 sanitizeReply（编造词命中 → ai_failed，不发）
     → 正常 → 直接发给客户
6. 若 tags.escalate === true:
     → 仍发 reply（wechat-cs-reply 已保证此类回复是"安抚+说明会有人跟进"）
     → cs-outbound 写 wechat_publish_task (type='private_chat', reason='cs_escalate')
     → 关键人收微信通知（agent 拉取后真发）
7. 若 tags.stage 有值（A1-A4）:
     → PUT /api/crm/customers/status（changed_by='ai_inferred'）
     → crm_customers.status 更新
     → crm_customer_status_history 新增一行（changed_by='ai_inferred'）
8. 错误路径:
     5-1: JSON 缺失 → 重试一次（追加"上次漏了 JSON，这次必须补上"） → 仍失败 → 正则兜底读安全默认值
     5-2: 编造词命中 → ai_failed（不发占位文案）
     5-3: escalate 入队失败 → console.warn 吞掉，客户仍收到回复
```

---

## 代码变更地图

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `apps/api/src/services/wechat-draft.ts` | 修改 | 替换 system prompt 生成逻辑；新增 JSON 解析+重试+正则兜底；新增 escalate 分支；新增 stage 回写 |
| `apps/api/src/services/wechat/context-assembler.ts` | 修改 | `assembleChatContext` 接收可选 `csReplyRules` 段，注入 wechat-cs-reply 规则块 |
| `apps/api/src/routes/crm.ts` | 修改 | `PUT /api/crm/customers/status` 新增 `changed_by` 参数支持（可选，默认 'manual'） |
| `apps/api/db/migrations/20260708_130000_crm_status_history_changed_by.sql` | 新增 | `crm_customer_status_history` 加 `changed_by` 列，CHECK ('ai_inferred','manual')，历史行回填 'manual' |
| `apps/api/tests/services/wechat-draft.test.ts` | 修改 | 新增三类场景：正常解析、JSON缺失重试+正则兜底、escalate=true |
| `.github/workflows/scripts/smoke/wechat-cs-reply-smoke.sh` | 新增 | curl/DB 验证三类场景（escalate DB行、stage history行、编造词拦截） |

---

## NFR（非功能要求）

| # | 要求 | 指标 |
|---|------|------|
| N-1 | **延迟**：wechat-cs-reply 内核已验 p50≈2s，本次不引入额外 LLM 调用 | 不新增 RTT |
| N-2 | **可观测**：escalate 入队成功/失败、stage 回写成功/失败均写结构化日志 | `console.warn/error` with [tag] |
| N-3 | **回归安全**：现有 wechat-draft.test.ts 4 个场景（群/黑名单/正常/ai_failed）必须继续通过 | CI vitest |
| N-4 | **幂等 Migration**：`changed_by` 列 `ADD COLUMN IF NOT EXISTS`，可重复执行 | DDL 幂等 |
| N-5 | **模型可替换**：`WECHAT_CS_MODEL` env 覆盖，不硬编码模型名 | 已有惯例 |

---

## 验收标准（Final E2E）

- [ ] `wechat-draft.test.ts` 覆盖：①正常对话产出 `{ reply, tags }` 解析成功 ②JSON缺失走重试+正则兜底 ③编造词命中 `ai_failed` 不发
- [ ] escalate=true 场景：客户收到安抚 reply + `wechat_publish_task` 表新增 `cs_escalate` 行（`approval_source='system'`）
- [ ] stage 标签场景：`crm_customers.status` 更新 + `crm_customer_status_history` 新行 `changed_by='ai_inferred'`
- [ ] smoke.sh（`wechat-cs-reply-smoke.sh`）覆盖 curl/DB 验证上述三类场景
- [ ] CI 全绿（vitest + smoke）

---

## 不包含

- 人格库/AB测试筛选（子项目3，另立 sprint）
- 语气不重复机制/few-shot轮换（子项目5，另立 sprint）
- daily-report-cs 原有「日报生成」能力（不动，`daily-report` skill 职责）
- 朋友圈文案生成 `generateMomentDraft`（Path4 Step4-5，不动）
- zenithjoy-skills 仓库 `daily-report-cs/` 目录改名（另起 PR 到 zenithjoy-skills 仓库）
