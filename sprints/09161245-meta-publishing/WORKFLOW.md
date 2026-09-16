# Meta 发布工作流

> 状态：端点已上线，**`META_PUBLISH_ENABLED=false`，尚未执行过任何真实发帖**。
> 真实发帖需徐啸对**具体内容与账号**逐次明确批准。

## 全链路

```
①内容输入 → ②素材URL校验 → ③preview → ④人工审批 → ⑤发布(原子声明) → ⑥结果/失败记录
                                                          ↑
                                              ⑦Token到期/权限失效告警
```

## ① 内容输入

| 平台 | 必填 | 上限 |
|---|---|---|
| facebook | `message` 或 `caption`（纯文字可发） | 63,000 字符 |
| instagram | `caption` + **`mediaUrl` 必填**（IG 不支持纯文字） | 2,200 字符 |

请求体还需：`idempotencyKey`（`[A-Za-z0-9._:-]{8,128}`，同一条内容全程复用同一个 key）。

## ② 素材 URL 校验

Meta 侧会自己去拉 `mediaUrl`，所以该 URL 必须**公网可达、非 403/302 到登录页**。
建议发布前先 `curl -I` 确认 200 + `Content-Type: image/*`。
本端点不代拉素材，也不做转存——素材挂在 Cloudflare Pages 或对象存储上即可。

## ③ preview（默认行为）

```bash
curl -s -X POST https://www.zenithjoyai.com/api/meta/publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $META_PUBLISH_API_KEY" \
  -d '{"platform":"facebook","message":"...","idempotencyKey":"post-2026-09-16-001"}'
```

不传 `mode` 即 preview，**只回显将要发送的内容摘要，不触碰 Graph API**。

## ④ 人工审批

preview 结果交徐啸确认「内容 + 目标账号」。**未获逐次批准不得进入第 ⑤ 步。**

## ⑤ 发布

三道闸**同时**满足才会真发：

| 闸 | 值 |
|---|---|
| 请求体 `mode` | `"publish"` |
| 请求体 `confirm` | `"PUBLISH"` |
| 环境变量 `META_PUBLISH_ENABLED` | `"true"` |

缺任一 → 403 `publishing_not_confirmed`。

## ⑥ 幂等与结果记录

原子声明由 D1 主键约束保证（**不能退回 KV**，原因见 `../../apps/geoai/functions/README.md`）。

| 返回 | 含义 | 该怎么办 |
|---|---|---|
| 200 `{ok:true, result:{id}}` | 首次发布成功 | 记录 post id |
| 200 `{ok:true, replayed:true}` | 同 key 重放，未重复发帖 | 正常，无需处理 |
| 409 `publish_outcome_requires_review` | key 已被声明但未收敛 | **人工去 FB/IG 后台核实是否已发出**，绝不自动重试 |
| 409 `idempotency_key_conflict` | 同 key 换了内容 | 换新 key |
| 503 `idempotency_store_not_configured` | D1 未绑定 | 配 `META_PUBLISH_DB` |
| 403 `publishing_not_confirmed` | 三道闸未齐 | 见第 ⑤ 步 |
| 401 | API key 错 | 核对 `META_PUBLISH_API_KEY` |

### 为什么 409 不自动重试

上游失败可能是「已发出但回执丢失」。盲目重试＝重复发帖，且对外不可撤回。
因此状态停在 `pending`，强制人工判定。这是刻意设计，不是缺陷。

## ⑦ Token 到期 / 权限失效告警

Meta 长期 Page Token 约 60 天过期；权限也可能因用户改授权而失效。

**检测**：定期打 `GET /api/meta/status`（只读、不发帖、不回显 token）。
返回体含 `tokenValid` / `missing` 等字段，任一异常即告警。

建议挂 cron 每日一次，失败推飞书。**该 cron 尚未创建**——属待办。

## 尚未实现（不要假装有）

- 批量/排期发布：当前一次一条
- 视频、多图轮播：当前仅 FB 文字/单图、IG 单图
- 自动重试：**刻意不做**（见上）
- Token 自动续期：需 `META_APP_ID`/`META_APP_SECRET`，尚未配置
- 告警 cron：未创建
