# 积分自助充值链路 — 技术设计

- Brain task: `1fa2d737-f482-4e6f-afb9-b862e323e2bd`
- PrepPRD: `sprints/09222247-credits-recharge-payment/prep-prd.md`
- GP-Anchor: `line01/customer_first_success#step1`
- 日期: 2026-09-22

## 1. 现状与边界

已存在（不动）：

| 组件 | 位置 |
|---|---|
| `zenithjoy.tenant_credits`（余额，`CHECK(balance>=0)`） | `apps/api/db/migrations/20260429_161614_create_credits.sql` |
| `zenithjoy.credit_transactions`（流水） | 同上 |
| `getBalance / recharge / consume / listTransactions` | `apps/api/src/services/credits.service.ts` |
| `createCreditCharger` 扣减中间件 + `CREDIT_COSTS` | `apps/api/src/middleware/credit-charge.ts` |
| `tenantContext` 租户闸 | `apps/api/src/middleware/tenant-context.ts` |
| `simpleRateLimit`（按 tenantId） | `apps/api/src/middleware/simple-rate-limit.ts` |
| `startup-check.ts` + `env-registry.test.ts` 环境守卫 | `apps/api/src/startup-check.ts` |

本次新增：订单表、支付网关适配层、回调入账、充值页、消费端点接入、注册送积分。

## 2. 架构

```
Dashboard CreditsPage
   │ POST /api/credits/orders           (tenantContext + owner/admin + rateLimit)
   ▼
orders.service ──► PaymentProvider 接口 ──┬─► WechatNativeProvider
   │                                      └─► AlipayFaceToFaceProvider
   │                                      （测试环境注入 MockProvider）
   ▼
payment_orders (created → pending → credited)
   ▲
   │ POST /api/payment/callback/:provider   ← 公网，无 tenantContext，验签即鉴权
   │      （挂载在全局 express.json() 之前，用 express.raw()）
   ▼
settlement.service ── 同一事务 ──► CAS 订单状态 + recharge(order_id)
```

`PaymentProvider` 接口隔离支付平台差异，三个实现（wechat / alipay / mock）互换。业务代码不出现任何平台 SDK 调用。

```ts
interface PaymentProvider {
  readonly name: 'wechat' | 'alipay' | 'mock';
  createOrder(input: CreateOrderInput): Promise<{ qrCodeUrl: string; providerOrderRef?: string }>;
  verifyCallback(rawBody: Buffer, headers: Record<string, string>): CallbackEvent;  // 验签失败抛 SignatureError
  queryOrder(outTradeNo: string): Promise<{ status: 'success'|'pending'|'closed'; amountFen?: number; transactionId?: string }>;
}
```

## 3. 数据模型

### `zenithjoy.payment_orders`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL → tenants | 租户隔离 |
| `out_trade_no` | TEXT NOT NULL | 我方订单号，提交给平台 |
| `provider` | TEXT NOT NULL | wechat / alipay / mock |
| `amount_fen` | INTEGER NOT NULL CHECK(>0) | **分**为单位，整数，绝不用浮点 |
| `credits` | INTEGER NOT NULL CHECK(>0) | 该订单对应积分数 |
| `status` | TEXT NOT NULL | 见状态机 |
| `provider_transaction_id` | TEXT | 平台流水号，回调/查单后回填 |
| `qr_code_url` | TEXT | |
| `expire_at` | TIMESTAMPTZ NOT NULL | 默认 now()+30min |
| `credited_at` | TIMESTAMPTZ | |
| `failure_reason` | TEXT | create_failed / amount_mismatch 的原因 |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

约束：

```sql
UNIQUE (provider, out_trade_no)
CREATE UNIQUE INDEX ... ON payment_orders(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX ... ON payment_orders(tenant_id, created_at DESC);
CREATE INDEX ... ON payment_orders(status, expire_at) WHERE status = 'pending';
```

### `zenithjoy.payment_callbacks`（审计 + 乱序识别）

`id / provider / provider_transaction_id / event_type / order_id / tenant_id / raw_digest / received_at`，
`UNIQUE(provider, provider_transaction_id, event_type)` —— 用 `INSERT ... ON CONFLICT DO NOTHING` 判定首次投递。
`raw_digest` 只存回调体的 SHA256，**不存原文**（日志红线）。

`tenant_id` 与 `order_id` 均**可空**：回调路由先按 `out_trade_no` 定位订单再写审计，
定位得到就带上租户归属（租户隔离铁律）；伪造或乱序的回调对不上任何订单，
此时两列为 null 但审计痕迹照留。

### `credit_transactions` 增列

新增 `order_id UUID REFERENCES payment_orders(id)`，并加部分唯一索引：

```sql
CREATE UNIQUE INDEX idx_credit_tx_order ON zenithjoy.credit_transactions(order_id)
  WHERE order_id IS NOT NULL;
```

这是入账幂等的**第二道 DB 级保险**（第一道是订单 CAS）。

## 4. 状态机

```
created ──下单成功──► pending ──验签+查单确认──► credited (终态)
   │                    │
   │下单失败             ├─ 超时且查单非成功 ──► expired (终态)
   ▼                    ├─ 金额不符 ──────────► amount_mismatch (待人工)
create_failed(终态)      └─ 收到退款事件 ──────► refund_pending (待人工)
```

**所有转移一律 CAS**，靠 `rowCount` 判生效：

```sql
UPDATE zenithjoy.payment_orders
   SET status='credited', provider_transaction_id=$2, credited_at=now(), updated_at=now()
 WHERE id=$1 AND status = ANY('{pending}')
RETURNING *;
```

`rowCount=0` ⇒ 别人已处理或状态非法 ⇒ 本次不入账，直接返回成功给平台。

不引入 `paid` 中间态：入账与状态变更在同一事务，要么都成要么都不成。事务失败时订单留在 `pending`，由平台重试或兜底 job 主动查单自愈。

## 5. 关键流程

### 5.1 下单 `POST /api/credits/orders`

1. `tenantContext` → `requireTenantRole(['owner','admin'])` → `simpleRateLimit(10/min per tenant)`
2. 校验档位（服务端白名单，**金额与积分数均由服务端决定，绝不信客户端传的金额**）
3. 60 秒窗口内同租户同档位已有 `pending` 且未过期订单 → 直接复用，返回原二维码（防连点/多 tab）
4. INSERT `created` → 调 `provider.createOrder()` → CAS `created→pending` 回填二维码
5. 下单抛错 → CAS `created→create_failed` 记 `failure_reason`，返回可重试错误

### 5.2 回调 `POST /api/payment/callback/:provider`

**挂载位置**：`app.ts` 中 `express.json()`（line 96）**之前**，用 `express.raw({type:'*/*'})`，与 line 75 better-auth 同样的理由 —— APIv3 验签基于原始字节。

1. `provider.verifyCallback(rawBody, headers)` → 失败：403，不落库，记审计 + 告警
2. `INSERT INTO payment_callbacks ... ON CONFLICT DO NOTHING` → 冲突即已处理过，直接 200
3. **不信回调内容**，用 `out_trade_no` 调 `provider.queryOrder()` 拿权威状态
4. 查单金额 ≠ 订单 `amount_fen` → CAS 置 `amount_mismatch`，告警，返回 200（不重试，待人工）
5. 查单成功 → **BEGIN** → CAS `pending→credited` → `rowCount=1` 才 `recharge(tenantId, credits, 'recharge', {order_id, provider, amount_fen})` → **COMMIT**
6. 退款事件 → CAS `credited→refund_pending`，**不自动扣回积分**，告警待人工
7. 任何己方异常（DB 断连等）→ 返回 **5xx**，让平台重试。**绝不在未成功入账时返回 200**

### 5.3 主动查单 `POST /api/credits/orders/:id/sync`

商家点「我已支付」或前端轮询触发，复用 5.2 的第 3-5 步（同一 `settleOrder()` 函数），天然幂等。

### 5.4 过期兜底（定时任务）

扫 `status='pending' AND expire_at < now()`：**逐单先 `queryOrder()`**，成功则入账，否则才 CAS 置 `expired`。防回调在过期边界丢失导致"钱付了被判过期"。

### 5.5 消费接入

`CREDIT_COSTS` 定义了两项，但**只有一项对应的功能真实存在**：

| reason key | 单价 | 功能现状 | 本次处理 |
|---|---|---|---|
| `competitor_research` | 10 | ✅ 端点存在：`apps/api/src/routes/competitor-research.ts` | **本次接入** `createCreditCharger('competitor_research')` |
| `ai_writing` | 5 | ❌ **功能不存在**：dashboard 无入口、api 无对应端点，是 2026-04-29 定的预留常量 | 不接入，保留常量；该功能落地时再挂 |

余额不足返回 402 + 结构化错误码，前端提示并给充值入口。

### 5.6 注册送积分

租户创建路径 `apps/api/src/auth-bridge.ts` 的 free fallback 事务（建 free license + free tenant 的同一事务）内补 `recharge(tenantId, 100, 'initial_grant')`。入账失败不阻断注册，但记 error 日志 + 告警。

## 6. 密钥与配置

| 类型 | 方式 |
|---|---|
| 字符串（mchid / APIv3 key / serial_no / alipay appid） | `~/.credentials/wechat-pay.env`、`alipay.env` → 容器 `env_file` |
| **PEM 私钥/证书** | **文件挂载**：hk-vps `/opt/zenithjoy/{staging,prod}-api/secrets/`（`chmod 700` 目录 / `600` 文件）→ compose 加 `- ...secrets:/run/secrets/payment:ro`；代码用 `WX_PAY_PRIVATE_KEY_PATH` 指路径 + `fs.readFileSync` |

**绝不把 PEM 塞进 env**：`~/.credentials/wechat-miniapp.env` 已有内联 PEM 的先例，本次会话一条普通 awk 就把私钥打进了终端输出 —— 实证过的泄露路径。

全部新 env 登记进 `startup-check.ts` 的 `REQUIRED_ENV` / `CRITICAL_ENV_USAGE`，由既有 `env-registry.test.ts` 强制，漏登记即 CI 红。

## 7. 错误处理总表

| 场景 | 处理 | 返回平台 | 商家看到 |
|---|---|---|---|
| 验签失败 | 不落库，审计 + 告警 | 403 | 无感知 |
| 重复回调 | `ON CONFLICT DO NOTHING` + CAS rowCount=0 | 200 | 无感知 |
| 金额不符 | `amount_mismatch`，告警，不入账 | 200 | 「处理中，请联系客服」 |
| 回调乱序（退款先到） | CAS 前置状态不合法 → `refund_pending` | 200 | 不影响，人工介入 |
| 查单超时 | 不改状态，平台会重试；兜底 job 也会扫 | 5xx | 「确认中」 |
| DB 异常 | 事务回滚，订单留 pending | **5xx** | 「确认中」，靠重试/兜底自愈 |
| 下单超时/失败 | `create_failed` | — | 「生成二维码失败，请重试」 |
| 二维码过期 | 先查单再 `expired` | — | 「已过期，点击刷新」 |
| 退款后积分已花光 | `refund_pending`，**禁止 consume 反扣**（会撞 CHECK） | 200 | 客服人工 |

## 8. 前端

`apps/dashboard/src/pages/CreditsPage.tsx` + `src/api/credits.api.ts`，仿 `LicensePage` 既有模式。

**三件套缺一不可**（漏第三件菜单静默不显示）：
1. `src/config/navigation.config.ts` 菜单项：`{ path:'/credits', icon: Coins, label:'积分充值', featureKey:'credits', component:'CreditsPage' }`
2. `src/config/navigation.config.ts` 路由表：`{ path:'/credits', component:'CreditsPage', requireAuth:true }`
3. `src/contexts/InstanceContext.tsx` features 映射：`'credits': true`

页面：余额卡 + 档位选择 + 渠道选择 + 二维码 + 倒计时 + 「我已支付」按钮 + 流水表格（含订单号/渠道/实付金额）。轮询 5s 一次，最多 30 分钟，页面隐藏时暂停。

## 9. 测试策略

**E2E 环境：`windows_cloud`（GitHub Actions windows-latest）** — ZenithJoy 死规则，不用 mac_web。

| 层 | 覆盖 |
|---|---|
| unit | 状态机 CAS 转移表（每个非法转移断言 rowCount=0）；档位金额服务端计算；`PaymentProvider` 各实现的验签/查单解析 |
| integration（真 DB） | 重复回调只入账一次；并发双回调只一方生效；金额不符不入账；验签失败 403；DB 异常返 5xx；过期兜底先查单；注册送 100 积分；`competitor_research` 扣减 10 后余额与流水正确 |
| E2E | MockProvider 全链路：下单 → 出码 → 模拟回调 → 页面显示成功 → 余额与流水正确 |
| smoke | `payment-smoke.sh`：从 GHA runner 公网 curl 回调 URL 断言可达 |

TDD：每个 plan task 先 commit failing test（commit-1），再 commit 实现（commit-2）。

## 10. 文件清单

**新增**
```
apps/api/db/migrations/20260922_120000_payment_orders.sql
apps/api/src/services/payment/types.ts                 # PaymentProvider 接口 + 状态枚举（唯一一份）
apps/api/src/services/payment/wechat-native.provider.ts
apps/api/src/services/payment/alipay-f2f.provider.ts
apps/api/src/services/payment/mock.provider.ts
apps/api/src/services/payment/orders.service.ts        # 下单 / 复用 / 过期
apps/api/src/services/payment/settlement.service.ts    # 验签后的统一入账（回调与查单共用）
apps/api/src/routes/payment-callback.ts                # raw body，挂 express.json 之前
apps/api/src/routes/credits-orders.ts                  # 下单 / 查单 / 列表
apps/dashboard/src/pages/CreditsPage.tsx
apps/dashboard/src/api/credits.api.ts
.github/workflows/scripts/smoke/payment-smoke.sh
```

**修改**
```
apps/api/src/app.ts                      # 回调路由前置挂载 + 新 router 注册
apps/api/src/services/credits.service.ts # recharge 增 order_id 幂等参数
apps/api/src/startup-check.ts            # 新增 REQUIRED_FILE_ENV 文件类检查 + 支付 env 登记
apps/dashboard/src/config/navigation.config.ts
apps/dashboard/src/contexts/InstanceContext.tsx
deploy/docker-compose.staging-api.yml    # secrets 卷挂载
deploy/docker-compose.prod-api.yml
apps/api/src/auth-bridge.ts              # free fallback 事务内补 initial_grant(100)
apps/api/src/routes/competitor-research.ts  # 挂 createCreditCharger('competitor_research')
```

## 11. 明确不做

退款自动扣回、每日对账 job、发票、自动续费代扣、套餐 tier 与积分联动、生产部署（刀2）。
