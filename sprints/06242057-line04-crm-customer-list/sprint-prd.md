# Sprint PRD — Line04 中台 AI-native CRM·客户列表页（第一块）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 从"手填白名单"升级到"中台一屏管客户"
- **当前进度**：客服层多租户隔离 medium（读接口待补）；CRM 客户列表 ability 全新（0%）
- **本次推进预期**：交付客户列表页 thin 版（姓名+状态A1-A5+最后联系+接管开关）+ 接管开关驱动白名单 + 修两处上线刚需 bug

## 背景

Line 04 现状：客服只回 `wechat_cs_account_config.whitelist` 里手填的名字，管理员要手敲昵称、易错、看不到全貌。本次在中台 dashboard 做 AI-native CRM 第一页——一张客户列表，把"谁是客户/聊到哪步/最后啥时候聊/要不要 AI 接管"一屏呈现，勾接管开关即写白名单，替代手填。顺带修上线前两个刚需：写白名单时登录态没传到接口导致"未登录"报错、读接口缺租户隔离。

## Golden Path（核心场景）

管理员打开中台「客户列表」页 → 看到本租户自己客服机的客户表 → 勾接管开关 → AI 当场只回勾了的人 → 给客户打状态标签。

具体（单线性步骤）：

1. 管理员在中台打开「客户列表」页 → 系统列出**当前租户自己客服机**的客户行，每行：姓名 | 微信号 | 状态(A1-A5 下拉) | 最后联系时间 | 接管开关。数据读本地 DB：从消息记录 distinct 出已聊过的人 + 手动加的人。
2. 管理员把某客户「接管开关」打开 → 系统把该客户（微信昵称）写入该客服 `wechat_cs_account_config.whitelist` → 返回"保存成功"（登录态正确传递，**不再报"未登录"**）。
3. 该客户私聊进来 → 客服读白名单命中 → AI 真回复；未开接管的人进来 → 不回（沿用现有 gate）。
4. 管理员下拉把某客户状态改为 A3（议价）→ 系统持久化 → 列表刷新仍显示 A3。
5. 管理员点「+加客户」→ 填姓名/微信号 → 入册（为还没聊过的人预先设接管/状态）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 写接管开关/状态返回 401/无权限 → 页面提示"登录已失效，请重新登录"，重新登录后重试成功（**本次必修 cs-config-guard 登录态未传到写接口的 bug**）。
- 跨租户：管理员 A 的读/写接口绝不返回/改动管理员 B 的客服机数据（读写都加租户闸）。
- 空状态：客服机暂无任何已聊客户 → 列表显示空态，仍可「+加客户」。
- 同名客户：第一刀身份 key 用微信昵称，重名暂按昵称处理（升级到 wechat_id 留后）。

## 范围限定

**在范围内**：
- 中台客户列表页（姓名/微信号/状态下拉/最后联系/接管开关）
- 接管开关 → 写 `wechat_cs_account_config.whitelist`（替代手填）
- 状态 A1-A5 手动下拉 + 持久化
- 手动「+加客户」入册
- 名册来源 = 消息记录 distinct（已聊过的人）+ 手动加
- 修白名单写接口"未登录"bug（登录态传递）
- 读接口补租户隔离闸

**不在范围内**：
- 客户详情页（Profile/状态时间线/对话原文气泡）
- 状态 A1-A5 的 AI 自动判定（本次纯手动下拉）
- 日报 HTML 美化、扫微信通讯录种子、主动营销（定时/草稿/审核）
- 飞书任何对接（降级为可选导出口，本次不接）
- 身份 key 从昵称升级到 wechat_id

## 假设

- [ASSUMPTION: 名册"已聊过的人"从 `cs_memory_messages`（或现有消息表）按租户×客服机 distinct 联系人得出。]
- [ASSUMPTION: dashboard E2E 沿用现有惯例（VITE_SKIP_AUTH 或测试 session）注入登录态。]
- [ASSUMPTION: 状态 A1-A5 落库字段为客户/contact 维度新增列或现有可承载字段，具体表结构由 Proposer 倒推。]

## 预期受影响文件

- `apps/dashboard/`：新增客户列表页面 + 接管开关/状态下拉/加客户交互
- 中台 API（:5200）：客户列表读接口（含租户闸）、接管开关写接口（修登录态）、状态更新接口、加客户接口
- `wechat_cs_account_config.whitelist`：写入消费方从手填改为接管开关驱动
- cs-config-guard / 写接口鉴权链：修登录态未传递 bug
- `.github/workflows/scripts/smoke/`：新增白名单闸 + 租户隔离 smoke
- `apps/dashboard/e2e/`：新增客户列表 Playwright spec

## NFR 约束

<!-- 来源: decisions 表 category=nfr（Brain 不可达，取 PrepPRD 显式约束 + Line04 铁律）；PrepPRD 显式值优先 -->
- 租户隔离：读/写接口都必须加租户闸，管理员 A 取不到/改不动租户 B 的客服机数据
- 端点鉴权：写接口必须正确传递并校验登录态（修"未登录"bug）
- Line04 铁律：不回自己 / 不进群 / 防假成功 / 记忆按租户×联系人隔离
- 真环境验证才算 done；禁止写死环境假设值；日志脱敏
- 超时/频控/版本要求：PrepPRD 未指定，留待 Proposer 阶段确认

## E2E 验收

> Planner 初稿留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment（windows_cloud → Playwright .spec.ts + smoke.sh）产出。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入 Playwright spec + smoke.sh
# 期望验收点（自然语言）：
# 1. Playwright(windows_cloud)：打开客户列表页 → 断言出现 ≥1 客户行含姓名/状态下拉/接管开关；
#    勾接管 → 出现"保存成功"；下拉改状态 → 刷新后新状态仍在。
# 2. 数据写入验证：勾接管后 psql 查 wechat_cs_account_config.whitelist 真含该客户；状态改动真落库。
# 3. 白名单闸 smoke：勾了接管的 contact 命中(should_reply=true)、没勾的不命中(false)。
# 4. 租户隔离 smoke：租户 A 的读/写接口取不到/改不动租户 B 的客服机。
# 5. 登录态修复验证：登录管理员调写接口返回 200（不再 401"未登录"）。
# 6. smoke.sh 存在并接入 CI；commit-1 失败 test / commit-2 实现。
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 客户列表页，管理员在浏览器中可见可交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy dashboard E2E 走 GitHub Actions windows-latest（PrepPRD 明确 dashboard E2E 走 windows_cloud GHA）
## journey_id: Line04（客户私域 AI 接管；来源 = PrepPRD 锚定，Brain 不可达故取 Journey code）
## step_id: L04-CRM-S1（中台 AI-native CRM·客户列表页，新增 ability thin；来源 = PrepPRD Golden Path 锚定）
