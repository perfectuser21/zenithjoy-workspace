# Cloudflare Pages Functions — zenithjoyai.com

跑在 Workers runtime（**不是 Node**），只能用 Web 标准 API。不参与 Astro 构建，
故本目录有独立 `tsconfig.json`，且 `apps/geoai/tsconfig.json` 已将本目录排除。

## 路由

| 路径 | 作用 |
|---|---|
| `/api/auth/tiktok/start` | 发起 TikTok 授权：签发 HMAC state + HttpOnly cookie，302 跳转 |
| `/api/auth/tiktok/callback` | 接收回跳：三重校验 state → 换 token → 一次性展示 |

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

## 授权流程

1. 浏览器打开 `https://zenithjoyai.com/api/auth/tiktok/start`
2. 在 TikTok 页面完成授权
3. 跳回 callback，页面**一次性**显示 access_token / refresh_token
4. **立即存入 1Password**——本站不做任何存储，刷新即失效（授权码一次性）

## 测试

```bash
npx vitest run sprints/09121356-tiktok-oauth-callback/tests/tiktok-oauth.test.ts
```
