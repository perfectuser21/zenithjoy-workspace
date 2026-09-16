# Cloudflare Pages Functions — zenithjoyai.com

跑在 Workers runtime（**不是 Node**），只能用 Web 标准 API。不参与 Astro 构建，
故本目录有独立 `tsconfig.json`，且 `apps/geoai/tsconfig.json` 已将本目录排除。

## 路由

| 路径 | 作用 |
|---|---|
| `/api/auth/tiktok/start` | 发起 TikTok 授权：签发 HMAC state + HttpOnly cookie，302 跳转 |
| `/api/auth/tiktok/callback` | 接收回跳：三重校验 state → 换 token → 一次性展示 |
| `/api/meta/status` | Bearer 鉴权后只读核验 Facebook Page 与 Instagram Business Account |
| `/api/meta/publish` | 默认预览；通过多重门禁后发布 Facebook Page / Instagram 单图内容 |

以 `_` 开头的文件（`_lib.ts`）不会被当成路由。

## ⚠️ 部署是手动的

Pages 项目 `zenithjoyai` 是**直传模式，未连接 Git 仓库** —— 合并到 main **不会**自动部署。

```bash
cd apps/geoai
npm run build
npx wrangler pages deploy dist --project-name=zenithjoyai
```

`wrangler pages deploy` 会把 `functions/` 与 `dist/` 一并上传。

## 必需的环境变量

在 Cloudflare Pages 项目设置中配置（**不要**加 `PUBLIC_` / `VITE_` 前缀，
那会被打进前端 bundle 导致 secret 泄露）：

| 变量 | 来源 |
|---|---|
| `TIKTOK_CLIENT_KEY` | TikTok 开发者后台 |
| `TIKTOK_CLIENT_SECRET` | TikTok 开发者后台 |
| `TIKTOK_STATE_SECRET` | 自行生成的长随机串，仅用于 state 签名 |

三者缺任一，两个端点都会返回 **200 友好页**（而非 5xx）——这是刻意设计：
端点上线到拿到凭据之间必然存在空窗期，而这段时间恰好是 TikTok 审核员访问的时刻，
返回 5xx 会让端点看起来是坏的。

### Meta 自建发布变量

| 变量 / 绑定 | 作用 |
|---|---|
| `META_GRAPH_API_VERSION` | 显式指定 Graph API 版本；不在代码里静默漂移 |
| `META_PAGE_ID` | Facebook Page ID |
| `META_INSTAGRAM_BUSINESS_ACCOUNT_ID` | 与 Page 关联的 Instagram Business Account ID |
| `META_PAGE_ACCESS_TOKEN` | 长期 Page Access Token；Cloudflare secret |
| `META_PUBLISH_API_KEY` | 内部调用鉴权；Cloudflare secret |
| `META_PUBLISH_ENABLED` | 只有严格等于 `true` 才允许真实发布 |
| `META_IDEMPOTENCY` | Cloudflare KV binding；真实发布必需，防止重试重复发帖 |

`META_APP_ID` / `META_APP_SECRET` 可在后续 Token 生命周期自动化中使用，当前发布桥不要求。
所有 Meta 接口都要求 `Authorization: Bearer <META_PUBLISH_API_KEY>`。Token 只通过
Graph API 的 `Authorization` 请求头发送，不进入 URL、响应或日志。

`POST /api/meta/publish` 默认 `mode: "preview"`，不会访问 Graph 写接口。真实发布同时要求：

1. 服务端 `META_PUBLISH_ENABLED=true`；
2. 请求体 `mode: "publish"` 且 `confirm: "PUBLISH"`；
3. 8–128 字符的 `idempotencyKey`；
4. `META_IDEMPOTENCY` KV 已绑定。

这些门禁只防技术误触；正式外发仍必须遵守业务审批规则。

## 授权流程

1. 浏览器打开 `https://zenithjoyai.com/api/auth/tiktok/start`
2. 在 TikTok 页面完成授权
3. 跳回 callback，页面**一次性**显示 access_token / refresh_token
4. **立即存入 1Password**——本站不做任何存储，刷新即失效（授权码一次性）

## 测试

```bash
npx vitest run sprints/09121356-tiktok-oauth-callback/tests/tiktok-oauth.test.ts
npx vitest run sprints/09161245-meta-publishing/tests/meta-publishing.test.ts
```

## Meta 发布（Facebook / Instagram）

| 路由 | 作用 |
|---|---|
| `GET /api/meta/status` | 只读核验：配置齐否、发布开关、幂等存储是否就绪。不回显任何密钥。 |
| `POST /api/meta/publish` | 默认 `mode: "preview"`；真实发布需 `mode:"publish"` + `confirm:"PUBLISH"` + `META_PUBLISH_ENABLED=true` 三者同时满足。 |

### 幂等：为什么必须用 D1，不能用 KV

发布是**不可逆的对外动作**，防重复必须依赖原子声明。Cloudflare KV 给不了：

1. **无 compare-and-set**：`get` 后 `put` 之间是 TOCTOU 窗口，两个并发请求会双双读到空、双双写 pending、双双发帖；
2. **最终一致**：写入全球传播可达 60 秒，即便请求不并发、只是落在不同边缘节点，也可能都读不到刚写的值。

Cloudflare 官方亦说明 KV 不适合协调/加锁。

本实现改用 **D1 主键约束**做原子声明：`INSERT ... ON CONFLICT DO NOTHING`，
`changes === 1` 才算抢到 key，由数据库保证同一 key 只有一个调用者能成功。

建表：
```bash
wrangler d1 execute <DB_NAME> --file=sprints/09161245-meta-publishing/schema.sql
```

绑定名 `META_PUBLISH_DB`。回归测试 `sprints/09161245-meta-publishing/tests/`
含并发竞态用例，**proven-to-fire**：把 claim 退化成非原子的读-写两步后，
测试立刻报 `expected 2 to be 1`（真的发了两次），证明 KV 方案确会重复发布。

### 状态机

```
(无记录) --claim--> pending --[IG]--> instagram_container_created --> succeeded
                      |                                                  ^
                      +--------------------[FB]--------------------------+
```

- `pending` 被他人持有 → 409 `publish_outcome_requires_review`，**绝不盲目重试**
  （上次结果可能已成功只是回执丢失，重试＝重复发帖）
- `instagram_container_created` → 重试复用同一容器，不在 IG 侧留下第二个容器
- 同 key 不同内容 → 409 `idempotency_key_conflict`

### 必需环境变量

| 变量 | 说明 |
|---|---|
| `META_GRAPH_API_VERSION` | 如 `v24.0` |
| `META_PAGE_ID` | Facebook Page ID |
| `META_INSTAGRAM_BUSINESS_ACCOUNT_ID` | IG 商业账号 ID |
| `META_PAGE_ACCESS_TOKEN` | 长期 Page Token（**secret**） |
| `META_PUBLISH_API_KEY` | 调用本端点的认证密钥（**secret**） |
| `META_PUBLISH_ENABLED` | 初次上线保持 `false` |
| `META_PUBLISH_DB` | D1 绑定，幂等存储 |

`META_APP_ID` / `META_APP_SECRET` 仅在做 Token 生命周期管理时需要。
