# PrepPRD：客户首次成功 — 积分自助充值链路（微信/支付宝扫码 → 订单 → 回调 → 自动到账）

Brain task: `1fa2d737-f482-4e6f-afb9-b862e323e2bd`
归位：横切件「计费与额度守卫」+ 共享前置「付费开通段」（非新 GP）
GP-Anchor: `line01/customer_first_success#step1`

## 本 PrepPRD 涵盖的所有事项（防信息丢失）

- [x] 本次包含：payment_orders 订单表 + 微信支付 Native 下单 + 支付宝当面付 + 回调验签/幂等入账 + 主动查单 + 过期兜底 + dashboard 充值页 + 消费端点接入 + 注册送积分补漏
- [ ] 另立 Sprint（本次不做）：退款链路（含 pending_refund 追缴）、每日对账 job、发票、自动续费代扣、套餐 tier 与积分联动
- [ ] 待主理人确认（不阻塞刀1）：①微信支付商户号是否已开通（主理人称"好像有"，明日同事核实）②备案域名与备案主体 ③回调落地方案（见 Gate 0）

## Journey 当前状态

GP：`line01/customer_first_success`（客户首次成功，6 步）

- ✅ step1 注册自动登录（含 free license）— 已有，但 **initial_grant 送积分从未真正执行**（本次补）
- ✅ tenant_credits / credit_transactions 表 + 事务安全的 recharge/consume — 已有（PR-C 基建，2026-04-29）
- ✅ credit-charge 中间件 + CREDIT_COSTS 常量 — 已有，但**零业务端点接入**（本次补）
- ⬜ 订单 / 支付 / 回调 / 充值 UI — 全部空白（本次主体）

## 本次要做的

商家在网页 Dashboard 点「充值」，选金额，页面出一个二维码，用微信或支付宝扫码付款，付完积分自动到账，能在流水里看到这笔充值；充的积分能被「对标分析」功能真实扣掉。

> 查实修正：`CREDIT_COSTS` 里的 `ai_writing`（5 分）**对应功能在系统里不存在**（dashboard 无入口、api 无端点，是 2026-04-29 定的预留常量）。本次只接 `competitor_research`（10 分，端点为 `apps/api/src/routes/competitor-research.ts`）。

## Golden Path（用户操作流程）

1. 商家（owner/admin）在 Dashboard 侧边栏点「积分充值」→ 页面显示当前余额、历史流水、可选充值档位
2. 商家选一档金额、选微信或支付宝 → 系统创建订单（status=created）并向支付平台下单 → 页面显示二维码 + 倒计时（30 分钟）
3. 商家扫码付款 → 支付平台回调中台 → 中台**验签 → 主动查单确认真实状态 → CAS 置 paid → 同事务内入账积分**
4. 页面轮询（或商家点「我已支付」触发主动查单）→ 显示「充值成功，余额 X」→ 流水新增一条带订单号/渠道/实付金额的记录
5. 商家使用「对标分析」→ 积分按 `CREDIT_COSTS.competitor_research`（10）真实扣减 → 流水出现 -10 记录，看得出钱花在哪

**错误路径（必须覆盖）**

- 下单失败 / 二维码生成失败 → 「生成二维码失败，请重试」，订单标 create_failed，不留死单
- 二维码过期 → 「二维码已过期，点击刷新」，**过期前先主动查单一次**再标 expired（防边界回调丢失误判）
- 回调迟到 / 丢失 → 商家点「我已支付」主动查单，走同一入账函数（天然幂等）
- 验签失败 → 403 拒绝，不落库不处理，记安全审计 + 告警
- 金额不一致 → 不入账，标 amount_mismatch，人工核实，**禁止自动重试**
- 余额不足 → 使用功能时提示「积分不足，请充值」并给充值入口

## 客户视角

商家第一次能自己把钱付进来，不用再加销售微信人工开通；充完立刻能用，花了多少、花在哪一笔笔看得见。

## 完成后用户能

1. 自助充值，不依赖人工
2. 在流水里还原每一笔钱的去向（订单号 / 渠道 / 实付金额 / 消耗项）
3. 积分真实驱动 AI 文案与对标分析

## 涉及的 Ability / Feature

- 积分自助充值（新增，thin）
- 支付回调入账（新增，thin）
- 积分消费接入（加厚：中间件已存在 → 首次接入真实端点）

## GP-Anchor 声明

```
GP-Anchor: line01/customer_first_success#step1
```

> 本次确实推进 step1（补上注册 initial_grant）。充值链路主体属**新横切件「计费与额度守卫」**，`product-map` 与 Brain 地图 zenithjoy-workspace scope 下均无 crosscut 节点，待主理人拍板后走 capability-mapper Mode 2 补登，届时锚点迁移。

## 不包含

- 退款链路（回调收到退款只落 pending_refund，不自动扣回积分）
- 每日对账 job（本次只建 reconciliation 所需字段）
- 发票、自动续费代扣、套餐 tier 与积分联动
- 生产部署（刀2，需商户号与备案域名）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 这笔支付到底成没成功 | A.只信被动回调 B.只信主动查单 C.回调触发查单，以查单结果为准 | **C** | 微信/支付宝官方口径：回调仅作触发器，真实状态以查询接口为准 | 只信回调 → 伪造回调即可骗出积分（直接资损）；只信查单 → 到账延迟体验差 |
| ⚠️ 这笔充值有没有入过账 | A.先查流水再插入 B.UNIQUE 约束 + INSERT ON CONFLICT DO NOTHING | **B** | 铁律「幂等必须原子声明，禁止先查后写」 | A：并发回调都查到"不存在"各自入账 → 积分翻倍（资损） |
| ⚠️ 订单能不能转到新状态 | A.先 SELECT 读状态再 UPDATE B.UPDATE...WHERE status=ANY(合法前置) 的 CAS | **B** | 铁律「超时重试就是并发」 | A：乱序回调下状态倒退，已 refunded 被 paid 覆盖 |
| ⚠️ 退款时积分已花掉了怎么办 | A.自动 consume 反扣 B.落 pending_refund 等人工 | **B** | 铁律「外部状态未收敛禁止自动处理」；A 会撞 balance>=0 的 CHECK | A：抛异常漏处理，或产生无审计轨迹的账目黑洞 |
| 长时间 pending 订单该不该标过期 | A.按 expire_at 直接标 B.标记前先主动查单一次 | **B** | 回调丢失是已知常态，过期前再 check 一次成本极低 | A：回调恰在过期边界丢失 → 已付款订单被误判过期 → 商家钱付了没到账 |
| DB 异常时回调怎么响应 | A.返 200 避免平台重试 B.返 5xx 让平台重试 | **B** | 返 200 = 告诉平台"已处理"，平台不再重推，该笔永久丢失 | A：静默资损且无从发现 |

## 命中的铁律（自动 enforce）

- 幂等必须原子声明（UNIQUE + ON CONFLICT DO NOTHING），禁止先查后写
- 状态机一律 CAS：`UPDATE ... WHERE status = ANY(合法前置集合)`，靠 rowCount 判生效
- 租户隔离：新表必带 tenant_id 且走 tenantContext
- 外部状态未收敛禁止自动重试，必须人工核实
- Dashboard 新页三件套缺一不可：navigation.config.ts 菜单项 + 路由表 + **InstanceContext.tsx features 映射**（漏第三件菜单静默不显示）
- 枚举语义常量只允许一份，落在各消费方共同 import 的 service

## 硬约束（DB / 代码层，不可协商）

1. `payment_orders` 加 `UNIQUE(tenant_id, provider, out_trade_no)` 与 `UNIQUE(provider, provider_transaction_id)`
2. 回调入账与订单状态变更**必须同一事务**；只有 CAS 的 `rowCount=1` 一方才调 `recharge()`
3. `recharge()` 新增 `order_id` / 幂等键参数（现签名完全无幂等保护，是本次最大火药桶）
4. `tenant_credits.balance CHECK(balance>=0)` 保留；退款 / 调账一律走函数，禁止脚本直改库
5. **回调路由必须在 `app.ts` 全局 `express.json()`（line 96）之前挂载**，用 `express.raw()` 保留原始字节 —— APIv3 验签基于原始 body，被 json 解析后验签必然失败（同 line 75 better-auth 的处理方式）
6. **PEM 私钥走文件挂载，绝不进 env**：`~/.credentials/wechat-miniapp.env` 已有把 PEM 多行内联进 env 的先例，本 session 一次常规 awk 就把私钥打进了终端 —— 此为实证，不可重演
7. 验签失败 / 金额不一致：不落库不处理，禁止任何"先记录再补偿"旁路

## Gate 0（前置门，刀2 部署前必须全过）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | 营业执照 | ✅ 有 | 主理人确认 |
| 2 | 微信支付商户号 | ❓ 待核实 | 1Password CS 有 `WeChat Pay API Client Private Key`（2026-05-08），`~/.credentials/apiclient_key.pem` 存在 → **商户号大概率已开通**（该文件只能从商户平台下载）。缺 mchid / APIv3 密钥 / 证书序列号 |
| 3 | 支付宝当面付 | ❌ 未办 | open.alipay.com 创建应用 + 签约当面付 |
| 4 | 备案域名与主体 | ❌ 未确认 | 现用 `autopilot.zenjoymedia.media` 走 Cloudflare、服务器在 **hk-vps（香港）**，拿不到大陆 ICP 备案 |
| 5 | 回调落地方案 | ⏸ 待拍板 | A. 大陆最小服务器只跑回调端点（备案域名）转发香港【建议】 B. 走支付服务商已备案回调地址 C. 整个 API 迁大陆 |

**Gate 0 不阻塞刀1**：刀1 全程 mock，验收到 DB 为止。

## 切刀

| 刀 | 范围 | 验收 | 依赖 Gate 0 |
|---|---|---|---|
| **刀1（本次）** | 订单表 + 下单/回调/查单/过期全套逻辑 + 充值页 + 消费端点接入 + 注册送积分 | mock 支付网关，断言见验收标准 | ❌ 不依赖 |
| 刀2（后续） | 换真实商户凭据，部署到备案域名 | 真扫码付 1 分钱 → psql 查余额真变 | ✅ 依赖 |

## 前置工作（刀1）

### 凭据
- [x] 刀1 不需要真实支付凭据（mock）
- [ ] 刀2 需要 `WX_PAY_MCHID` / `WX_PAY_V3_KEY` / `WX_PAY_SERIAL_NO` / `WX_PAY_PRIVATE_KEY`（模板已在 `~/.credentials/wechat-pay.env.template`）

### 基础设施
- [x] 测试库：本机 cecelia_scratch / test / staging
- [x] `startup-check.ts` + `env-registry.test.ts` 环境接缝守卫机制已存在，直接复用
- [x] `middleware/simple-rate-limit.ts` 已存在（按 tenantId 限流），直接复用
- [x] 无鉴权公网回调先例：`routes/douyin-auth.ts` 的 `GET /douyin-auth/callback`

### 测试环境路由
- [x] E2E 环境：**ZenithJoy → `windows_cloud`（GitHub Actions windows-latest）**，不用 mac_web

## 守卫清单（proven-to-fire 才算数）

| 接缝 | 类型 | 守卫形态 | 放哪 | 怎么证明它会报红 |
|---|---|---|---|---|
| 回调验签 | 逻辑 | CI 单测：正确签名通过 / 错误签名 403 | `apps/api/src/routes/__tests__/payment-callback.test.ts` | 故意传错签名断言拒绝 |
| 回调幂等 | 逻辑 | CI 单测：同一 out_trade_no 回调两次，余额只加一次 | 同上 | 仿 credits.service.test.ts 并发扣减用例 |
| 金额篡改 | 逻辑 | CI 单测：回调金额 ≠ 订单金额 → 不入账 | 同上 | 构造不符金额断言 status=amount_mismatch |
| 商户私钥可解析 | 环境 | 启动自检新增文件类检查（existsSync + createPrivateKey 试解析） | `startup-check.ts` 新增 `REQUIRED_FILE_ENV` | staging 改坏 pem 重启，断言 /health 报红 |
| staging 误用生产商户号 | 环境 | 启动自检：非 production 时 mchid 命中生产白名单 → 拒绝启动 | `startup-check.ts` | 把生产 mchid 塞进 staging 重启，断言拒绝启动 |
| 回调公网可达 | 环境 | smoke 从 GHA runner（公网出口）curl 回调 URL | `.github/workflows/scripts/smoke/payment-smoke.sh` | 域名 / nginx 漂移即 CI 红 |

## 告警阈值

- 下单失败率 > 5%（10 分钟滚动）→ P1 飞书
- pending 订单 > 50 笔，或最老一笔 > 2 小时 → P1 飞书
- 对账不一致 > 0 笔 → 当天 P1（零容忍）
- 回调验签失败 > 10 次/小时 → P2（疑似伪造或证书未同步）
- 商户凭据 401 → **P0 立即停收款入口 + 专项告警，不重试**（复用决策 a32929d4）

## 日志红线

- 可记：`payment_order_id` / `tenant_id` / `amount_fen`（整数分）/ `status` / `out_trade_no` / 耗时 / HTTP code
- **绝不能记**：私钥与 APIv3 密钥、完整回调 body 原文、openid / 银行卡明文

## 验收标准（刀1 Final E2E）

- [ ] psql 查 `payment_orders`：下单后有 created 记录，含 out_trade_no / amount_fen / tenant_id / expire_at
- [ ] 模拟回调两次（同一 out_trade_no）→ psql 断言 `tenant_credits.balance` 只增加一次，`credit_transactions` 只有一条对应记录
- [ ] 模拟验签失败回调 → 断言 403 且订单状态未变、余额未变
- [ ] 模拟金额篡改回调 → 断言 status=amount_mismatch 且余额未变
- [ ] 并发两个回调打同一订单 → 断言只有一方入账（CAS rowCount）
- [ ] DB 异常时回调返回 5xx（不是 200）
- [ ] 过期兜底：pending 超时订单标记前先查单
- [ ] Dashboard 三件套齐全：菜单可见（InstanceContext features 含 credits）、路由可达、页面显示余额 + 流水 + 二维码
- [ ] 消费接入：调用对标分析端点后 psql 断言余额减 10、流水出现 -10 的 competitor_research 记录
- [ ] 注册新租户后 psql 断言 tenant_credits 有行且 balance=100，流水含 initial_grant
- [ ] CI 全绿
