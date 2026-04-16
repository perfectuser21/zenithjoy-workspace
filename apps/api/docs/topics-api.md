# Topics / Pacing / Pipelines-Worker API

PR-a 新增端点，apps/api Express，端口 5200。

所有端点受 `internalAuth` 中间件保护：
- 请求头 `Authorization: Bearer <token>` 或 `X-Internal-Token: <token>`
- token 从 env `ZENITHJOY_INTERNAL_TOKEN` 读取
- env 未设置时，中间件放行（dev 友好）

响应统一格式：
```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2026-04-16T22:30:00Z"
}
```

---

## Topics — `/api/topics`

### GET /api/topics
列出选题（分页 + 过滤）。

Query：
- `status` — 可选，枚举：待研究/已通过/研究中/待发布/已发布/已拒绝
- `limit` — 默认 50，最大 500
- `offset` — 默认 0
- `include_deleted` — 默认 false

```bash
curl -s http://localhost:5200/api/topics \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"

curl -s "http://localhost:5200/api/topics?status=%E5%BE%85%E7%A0%94%E7%A9%B6&limit=20" \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"
```

### GET /api/topics/:id
```bash
curl -s http://localhost:5200/api/topics/f108b4d8-244e-4663-bcf6-2e7816ab00fe \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"
```

### POST /api/topics
```bash
curl -s -X POST http://localhost:5200/api/topics \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "为什么一人公司不缺订单",
    "angle": "工具选型",
    "priority": 100,
    "status": "待研究",
    "target_platforms": ["xiaohongshu","douyin"],
    "scheduled_date": "2026-04-20"
  }'
```

校验：
- `title` 1-500 字符，必填
- `status` 必须在枚举内
- `priority` 0-999 整数
- `scheduled_date` `YYYY-MM-DD` 或 null

### PATCH /api/topics/:id
```bash
curl -s -X PATCH http://localhost:5200/api/topics/f108b4d8-244e-4663-bcf6-2e7816ab00fe \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"研究中"}'
```

所有字段都是可选，至少一个。支持更新：`title / angle / priority / status / target_platforms / scheduled_date / pipeline_id / published_at`。

### DELETE /api/topics/:id
```bash
# 软删（默认）
curl -s -X DELETE http://localhost:5200/api/topics/f108b4d8-... \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"

# 硬删
curl -s -X DELETE "http://localhost:5200/api/topics/f108b4d8-...?hard=true" \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"
```

---

## Pacing Config — `/api/pacing-config`

### GET /api/pacing-config
```bash
curl -s http://localhost:5200/api/pacing-config \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"
# => {"success":true,"data":{"daily_limit":1}, ...}
```

### PATCH /api/pacing-config
```bash
curl -s -X PATCH http://localhost:5200/api/pacing-config \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"daily_limit":2}'
```

`daily_limit` 必须是 0-100 的整数。

---

## Pipelines Worker — `/api/pipelines` (pipeline-worker 专用)

### GET /api/pipelines/running
列出所有 `status='running'` 的 pipeline_runs，LEFT JOIN topics 拉出 keyword / angle / topic_status。

```bash
curl -s http://localhost:5200/api/pipelines/running \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN"
```

### POST /api/pipelines/:id/stage-complete
```bash
# 非终态阶段
curl -s -X POST http://localhost:5200/api/pipelines/<pipeline_id>/stage-complete \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "research",
    "output": {"findings_path": "/Users/administrator/content-output/xxx/findings.json"}
  }'

# 终态（export + is_final=true）→ 同时把 topic 置为 '待发布'
curl -s -X POST http://localhost:5200/api/pipelines/<pipeline_id>/stage-complete \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "export",
    "is_final": true,
    "output": {"export_path": "/Users/administrator/content-output/xxx/export.zip"}
  }'
```

合法 stage：`research / copywriting / copy_review / generate / image_review / export`

### POST /api/pipelines/:id/fail
```bash
curl -s -X POST http://localhost:5200/api/pipelines/<pipeline_id>/fail \
  -H "Authorization: Bearer $ZENITHJOY_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "error": "NotebookLM timeout after 600s",
    "stage": "research"
  }'
```

错误消息写入 `output_manifest.error`，`status` 置 `failed`。

---

## Token 生成与管理

```bash
# 生成新 token
openssl rand -hex 32

# 存 1Password（CS Vault → "ZenithJoy Internal API Token"）
# 本地双写
printf 'ZENITHJOY_INTERNAL_TOKEN=%s\n' "$(openssl rand -hex 32)" \
  > ~/.credentials/zenithjoy-internal-token
chmod 600 ~/.credentials/zenithjoy-internal-token

# apps/api .env 加一行
echo "ZENITHJOY_INTERNAL_TOKEN=<paste_token>" >> /path/to/apps/api/.env
```

## 错误码对照

| HTTP | code | 场景 |
|------|------|------|
| 400 | INVALID_ID | id 非 UUID |
| 400 | INVALID_STATUS | status 值不在枚举 |
| 400 | INVALID_PRIORITY | priority 超出 0-999 |
| 400 | INVALID_DAILY_LIMIT | daily_limit 超出 0-100 |
| 400 | INVALID_PLATFORMS | target_platforms 非数组 |
| 400 | INVALID_PIPELINE_ID | pipeline_id 非 UUID |
| 400 | INVALID_TITLE | title 空字符串 |
| 400 | TITLE_REQUIRED | title 缺失 |
| 400 | TITLE_TOO_LONG | title > 500 字符 |
| 400 | NO_FIELDS | PATCH 无可更新字段 |
| 400 | STAGE_REQUIRED | stage 缺失 |
| 400 | STAGE_INVALID | stage 值不在枚举 |
| 400 | ERROR_REQUIRED | fail 端点 error 缺失 |
| 401 | UNAUTHORIZED | token 缺失或不匹配 |
| 404 | NOT_FOUND | 资源不存在 |
| 500 | INTERNAL_ERROR | 其它异常 |
