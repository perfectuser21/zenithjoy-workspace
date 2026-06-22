# Sprint PRD — Line04 每客服独立配置 + 客户机按身份拉配置

## OKR 对齐

- **对应 KR**：客户私域 AI 接管（Line 04）— 客服层多租户隔离从 thin 加厚至 medium
- **当前进度**：客服层多租户隔离 thin/planned；全局单行配置导致人设串台（Issue defe1a42）
- **本次推进预期**：每客服配置按微信号 key 物理隔离，钉死串台 bug；客户机按身份拉自己那份配置

## 背景

当前中台只有一行全局 `wechat_cs_config`，客户 A 设人设=「萌萌」后所有客户都变萌萌（Issue defe1a42 串台 bug）。本 sprint 让"一个公司 N 个客服"成立：每客服 = 一个微信号 + 一台 PC + 自己的人设/开关/营业时间/关键人/白名单，互不干扰。真发由中台该客服开关控制，不再靠装包写死 env。

存储 invariant（决策 04c34b86）：每客服运行时配置存中台 Postgres，前台客户管理页编辑，客户机按自己微信号轮询读。**客户机永远只跟中台 Postgres 通信，绝不直连飞书**。

## Golden Path（核心场景）

管理员在前台分别配每个客服 → 客户机按自己微信号身份拉自己那份 → 真发跟随该客服开关。

具体：
1. 管理员在客户管理页「某客服设置区」填【该客服微信号 + 人设/营业时间/关键人/白名单/自动回复开关】→ 系统按微信号 key 写中台「该客服那一行」→ 仅该客服生效，不覆盖其他客服
2. 客户机 Agent 启动 → 读出自己登录微信号 → 上报中台校验；登录号 ≠ 管理员绑定号则报红、中台诊断页标异常、不按错配置跑
3. 客户机校验通过 → 向中台拉「自己那份」配置 → 用自己的人设/白名单/营业时间跑
4. 管理员打开该客服「自动回复开关」→ 客户机下一轮拉到 `auto_agent_enabled=ON` → 该客服真发生效；开关 OFF = 演练 dryrun，绝不误真发
5. 名单内客户私聊该客服微信 → 客户机按自己那份人设/白名单判定 → 真发回复 → 读回验证真送达
6. 第二台客户机（另一客服微信）同时跑 → 各自拉各自配置 → 人设/名单/开关互不串

## 边界情况

- 客户机拉配置失败（中台不可达）→ 用上次缓存的自己那份 + **强制 dryrun** → 中台恢复后自动重拉
- 客户机登录微信号 ≠ 管理员绑定微信号 → 客户机开机自检报红 + 中台诊断页标异常 → 不按错配置跑
- 用未注册微信号向中台拉配置 → 拒绝/报异常，不返回任意一份配置

## 范围限定

**在范围内**：
- 中台 Postgres 每客服配置表（key=绑定微信号，含人设/开关/营业时间/关键人/白名单/生效快照）
- 前台客户管理页「每客服设置区」编辑该客服那一行
- 客户机按自己微信号身份拉自己那份配置 + 登录号校验报红
- 真发 gate = 该客服 `auto_agent_enabled`（默认 dryrun；OFF=演练，ON=真发，拉失败=强制 dryrun）
- 存量全局 `wechat_cs_config` migration 迁为 xian-rog 现客服那一行（向后兼容）

**不在范围内**：
- D 真客户 onboarding 一键化、转人工接管 UI、好友扫描自动同步白名单
- 飞书名单/画像 SSOT + 单向 sync（归 D sprint）
- 中台全局 NFR（频控/超时/去重/操作间隔）任何改动 — 保持全局

## 假设

- [ASSUMPTION: 微信号作为每客服配置主 key，全局唯一，由管理员手填绑定]
- [ASSUMPTION: 客户机轮询拉配置（非推送），轮询周期沿用现有 line04 agent 心跳周期]
- [ASSUMPTION: 中台内部鉴权沿用现有 X-Internal-Token，客户机拉配置带此 token]

## 预期受影响文件

- `apps/api/`（或 packages/brain）: 每客服配置 CRUD 端点（按微信号 key 读写）+ 客户机拉配置端点（身份校验）
- `apps/dashboard/`: 客户管理页「每客服设置区」UI（编辑该客服那一行）
- 客户机 line04 agent: 读本机登录微信号 → 上报校验 → 拉自己那份配置 → 真发 gate 跟随 `auto_agent_enabled`
- DB migration: 新增每客服配置表（key=微信号）+ 存量全局单行迁移脚本

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本地不可达，返回空）+ PrepPRD 显式值优先 -->
- 真发 gate 默认值: **dryrun**（auto_agent_enabled 默认 OFF；拉配置失败强制 dryrun）
- 频控/超时/去重/操作间隔: 沿用中台全局 NFR，本 sprint 不动
- 可观测: 客户机身份校验失败（登录号≠绑定号）必须中台诊断页标异常 + 客户机报红
- 配置隔离 invariant: 每客服配置按微信号 key 物理分行，写一行不影响其他行（决策 04c34b86）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（curl 中台 API + psql 验 DB）。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本
# 期望验收点（自然语言）：
# 1. 前台给客服A设人设=「萌萌」、客服B设人设=「天下第一」+ 各自白名单/auto_agent 开关
#    → API 查中台为两独立行（按微信号 key）互不覆盖（复现并钉死 Issue defe1a42 串台 bug）
# 2. 模拟客户机用自己微信号 GET 配置 → 只拿到自己那份（A 拿萌萌、B 拿天下第一）
#    用未注册微信号拉 → 拒绝/报异常
# 3. 真发 gate：auto_agent_enabled=OFF → dryrun；ON → 真发判定为真（不读 env）；拉配置失败 → 强制 dryrun
# 4. migration 向后兼容：存量全局 wechat_cs_config 迁移为 xian-rog 现客服那一行，旧单客服行为不破
# 5. CI 全绿（含 lint-feature-has-smoke / lint-tdd-commit-order）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 客户管理页每客服设置区（优先级链首条命中）
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 产品（CLAUDE.md E2E 死规则 ZenithJoy UI/Dashboard → windows_cloud）+ PrepPRD 显式钉 windows_cloud，GitHub Actions windows-latest 干净 sandbox 跑 curl 中台 API + psql 验 DB
## journey_id: bfeed805
## step_id: 客服层多租户隔离（Notion 383c40c2，thin→medium）
