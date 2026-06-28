# 设计：微信客服「以号为中心」信息架构重设计

- 日期：2026-06-28
- Journey：Line 04 客户私域 AI 接管
- 起因：用户验收 staging 时反复反映「客服话术知识库」和「客服机」两处 persona 重复、"两个地方在抢"。深挖发现是整块 IA 按"动作"堆、数据归属（全局 vs 每号）和概念（配置/运行/客户）没分层。

## 1. 问题（现状）

私域客服现有 5 个平级页面 + 一个凌驾其上的"全局话术库"：

| 页面 | 路由 | 管什么 |
|---|---|---|
| 话术知识库 WechatCustomerServiceConfigPage | /wechat/cs-config | **全局** persona(自称/语气/称呼/emoji/禁用词/few_shot) + business_kb(公司/产品/QA/人群) |
| 我的客服机 CsOneClickSetupPage | /wechat/setup | 选机器 + **每号** persona.self_name + 真发开关/营业时间/每日上限 |
| 工作汇总 CsWorkStatsPage | /wechat/cs-stats | 每号工作数据（接收/回复/接待/时长） |
| 客户好友表 CustomerListPage | /wechat/crm | CRM 客户名册 |
| 客户详情 CustomerProfilePage | /wechat/crm/:contactKey | 单客户画像/时间轴/记忆 |

**根本病**：persona 被劈成"全局 style + 每号 self_name"两半（PR#940 的折中），用户在两个页面都看到人设字段、且语义矛盾（AI 实际读每号的，全局那份成死字段）。健康诊断散在三处（ListenerHealth × 2 + 工作汇总）。

## 2. 约束（用户 2026-06-28 拍板）

1. **人设/话术每号完全独立**：每个客服号要不同名字+语气+话术（不是全公司共用）。
2. **知识库也每号独立**：用户倾向"每个号完全不同"（不同号可扮不同业务）。
3. **多租户/席位模型**（已有后端基础）：公司=租户(tenant)；席位=license_machines（买 N 席=N 台客服机）；账号↔微信号 1:1（service_agents：account_id→machine_id→wechat_id）。
4. **可见性=角色分级**（匹配已有 per-operator 决策5，PR#883）：超管/老板账号看公司全部号+可切换；普通运营账号只看自己绑的号。

## 3. 设计：以「客服号」为中心

```
私域客服
│
├─ 【客服号总览】（超管/老板账号进这里）
│    一张表：公司每个号 × [在线·微信健康·今日接待·真发/演练] → 点一个号下钻
│    （普通运营账号跳过这层，直接进自己绑的那个号）
│
└─ 【单个客服号工作台】（账号↔号 1:1）
     顶部状态条：在线 · 微信登录态 · 今日数据（健康集中一处，不再散三页）
     ├─ 人设话术  这个号怎么说话（self_name/address_style/tone/sentence_style/use_emoji/banned_phrases/few_shot）
     ├─ 知识库    这个号说什么（company/products/audience_segments/qa_docs）
     ├─ 运营设置  auto_agent_enabled/business_hours/daily_limit + 机器绑定
     ├─ 客户      这个号的好友表 + 详情（复用现有 CRM 页，按号过滤）
     └─ 成效      这个号的工作汇总 + 日报
```

**与现状的根本区别**：删掉"全局话术库"这一层。人设+知识库变成某个号工作台里的 Tab，每号一份，物理上不可能重复。用户进来始终在"某个号"的上下文里，不再有"这是全局还是每号"的困惑。

## 4. 数据归属

- **每号一份完整配置**收敛到 `wechat_cs_account_config`（按 wechat_id 分行，已存在），扩展承载：
  - `persona` JSONB（**完整** self_name + style 全套，不再只 self_name）
  - `business_kb` JSONB（公司/产品/人群/QA，从全局迁来）
  - 既有：auto_agent_enabled / business_hours / daily_limit / whitelist
- **废弃** `wechat_cs_config`（全局 key='persona'/'business_kb'）：迁移到各号。
- 可见性：沿用 `resolveReadScope`（超管全 / 运营自己），列表/工作台查询按 scope 过滤。

## 5. 分期（避免一次性巨型重构）

### 第一期（本设计落地范围，直接解决用户痛点）
1. 数据层：`wechat_cs_account_config.persona` 扩为完整 persona；新增 `business_kb` 列（每号）。迁移：把全局 `wechat_cs_config` 的 persona/business_kb 复制到每个现有号（作为初值），保留全局表数据但代码不再读（一期标 deprecated，二期删表）。
2. API：每号 persona/business_kb 的读写端点（按 machineId/wechatId scope）；AI 回复 `wechat-draft.ts` 改读每号完整 persona + 每号 business_kb。
3. 前端：
   - 删「全局话术库」页对 persona/business_kb 的全局编辑入口。
   - 客服号工作台：人设话术 Tab + 知识库 Tab（每号），运营设置 Tab（迁入现有客服机配置）。
   - 超管「客服号总览」表 + 下钻；运营直接进自己号。
4. 健康集中：工作台顶部状态条复用 ListenerHealth 数据，单号视角。

### 后续期（不在本次，Explore 查出的其他乱点，免得搅一起）
- CRM 四源合并透明化（来源标记 / 名册 vs 会话分离）
- A1-A5 一词两意改名（目标人群 vs 客户意向）
- 接管模型统一（whitelist / identity / managed 三处合一）
- 「模板」机制（开新号一键套用一份人设/知识库模板再改）——第一期不做，新号空白手填（YAGNI）

## 6. 风险与兼容

- **数据迁移幂等**：纯 SQL 迁移（避开历史 ts-node migration 坑），把全局 persona/business_kb 回填到每个 service_agents/wechat_cs_account_config 行；无号时不丢全局数据。
- **AI 回复连续性**：迁移后每号 persona 至少等于"原全局 + 原每号 self_name"合并值，保证回复行为不退化。
- **向后兼容**：一期保留 `wechat_cs_config` 表（标 deprecated 不读），二期再删，避免一刀切。
- **可见性回归**：超管/运营 scope 必须有测试守卫（运营看不到别人号）。

## 7. 验收（第一期 DoD）
- [ ] persona/business_kb 在 UI 上只存在于"某个号的工作台 Tab"，全局话术库页不再有重复入口（截图/e2e）
- [ ] AI 回复读每号完整 persona + 每号 business_kb（vitest）
- [ ] 超管看全部号、运营只看自己号（vitest scope 守卫）
- [ ] 数据迁移幂等、不丢已配人设（迁移测试）
- [ ] CI 全绿；到 staging，生产由用户手点 promote
