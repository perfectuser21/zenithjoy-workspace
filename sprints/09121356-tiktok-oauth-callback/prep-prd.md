# 小改动 PrepPRD：TikTok OAuth 回调端点（zenithjoyai.com）

## 改什么
在 `apps/geoai`（Astro 静态站，部署为 Cloudflare Pages 项目 `zenithjoyai`）新增 `functions/` 目录，
放两个 Cloudflare Pages Function：
- `GET /api/auth/tiktok/start`    发起授权：生成 HMAC 签名 state + HttpOnly cookie，302 跳 TikTok
- `GET /api/auth/tiktok/callback` 接收回跳：校验 state → 用 code 换 token → 一次性展示

## 为什么改
申请 TikTok Content Posting API 需要一个真实可达的 OAuth 回调地址（开发者表单必填项）。
选 zenithjoyai.com 是因为：官网与回调同域，审核最省事；该站已有真实业务内容与抖音账号，
主体可信度高于新建的 myshopify 默认域名。

## 为什么是两个端点（原设计只有 callback，是硬伤）
纯静态站无服务端 session，回调端无从判断 state 是否自己签发 —— 只做非空校验等于零 CSRF 防护。
真实后果：攻击者可用自己的 code 构造回调，令本站把「攻击者账号的 token」当作自己的存下，
后续发布内容全部进入攻击者账号（account confusion）。
补 `/start` 端点做 HMAC 签名 state + HttpOnly cookie 双绑，是不引入存储设施的唯一低成本正解。

## 关联上下文
- Brain journey: 8a33a19a-71eb-4e8b-a69b-4d0507321b4e（Shopify 电商自动化）
- 历史决策匹配: 无
- GitHub 撞车检查: 无相关 open PR

## 影响范围
- 仅新增 `apps/geoai/functions/**` 与 robots.txt 一行 Disallow，不修改任何现有页面/组件
- 对站点 SEO/GEO 无影响（端点 noindex + 不进 sitemap + 无内链）
- 部署方式不变：`wrangler pages deploy`，Functions 随 dist 一并上传

## 对抗审查已覆盖的错误路径
| 场景 | 处理 |
|---|---|
| 凭据未配置（上线初期必然状态，且是审核员访问时刻） | 返回 200 友好页，绝不 5xx |
| 用户拒绝授权（error=access_denied，无 code） | 渲染"已取消"，不走换取流程 |
| 裸访问（无 code 无 error） | 健康说明页，零外发请求 |
| TikTok 出错仍返回 HTTP 200，错误在 body | 一律以 body.error 优先判定，不信状态码 |
| code 以 `*`(%2A) 结尾 | 正确 decode，否则必报 invalid_grant |
| code 二次使用（用户刷新成功页） | 提示勿刷新 |
| 网络超时 / 5xx / 非 JSON 响应 | 10s AbortSignal + try/catch + 仅 5xx 重试一次（4xx 绝不重试） |
| error_description 直插 HTML = 反射型 XSS | 全部转义 |
| 端点被搜索引擎收录污染 SEO | X-Robots-Tag: noindex + robots.txt Disallow: /api/ |
| token 展示页泄露（历史/截图/统计脚本） | no-store + no-referrer + 独立极简页面（不复用站点 layout 与统计） |
| 任意人直接 GET 触发外发 | 仅在 code 存在且 state 校验通过时才外发 |

## 验收标准
- [ ] 未配置凭据时访问 → HTTP 200 友好页（非 500）
- [ ] error=access_denied → 显示已取消，不发 token 请求
- [ ] state 签名无效 / 过期 / cookie 不匹配 → 任一不过即拒绝
- [ ] TikTok 返回 200 但 body 含 error → 判定为失败
- [ ] error_description 含 HTML 标签 → 输出被转义
- [ ] 响应头含 X-Robots-Tag: noindex
- [ ] 单元测试覆盖上述分支
- [ ] CI 全绿

## 部署后需人工执行
1. `wrangler pages deploy`（该 Pages 项目为直传模式，未连 Git，提交不会自动部署）
2. Cloudflare Pages 项目环境变量配置：TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_STATE_SECRET
3. TikTok 开发者表单回调地址填：https://zenithjoyai.com/api/auth/tiktok/callback
