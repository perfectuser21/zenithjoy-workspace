# Sprint PRD — 智能获客：关键词扩展 + 抖音主号视频搜索 + DeepSeek评分 + Dashboard Leads查看页

## OKR 对齐

- **对应 KR**：KR-acquisition（智能获客模块能力就绪）
- **当前进度**：25%（acquisition/overview 端点已上线）
- **本次推进预期**：75%（关键词→视频→评论→评分→飞书→Dashboard 全链路打通）

## 背景

客户抖音主号评论区有大量潜在获客线索。本 sprint 打通：关键词扩展 → Agent 主号 CDP 搜视频 → 抓评论 → DeepSeek 3级评分 → 落飞书 → Dashboard 查看。

## Golden Path（核心场景）

用户在 Dashboard 输入行业关键词 → 中台扩词派 Agent 任务 → Agent 搜视频抓评论上报 → 中台打分写飞书 → `/dashboard/leads` 展示分级 Leads

具体：
1. 用户 POST `/api/acquisition/keyword-search`，body: `{"keyword": "装修"}`
2. 中台调 OpenRouter DeepSeek 扩展5个变体词，派搜索任务给主号 Agent
3. Agent 主号 Chrome CDP 逐词搜索，每词取最多5条热门视频，POST 回 `/api/acquisition/video-search-result`
4. 中台派评论抓取任务；Agent 进每个视频留言区抓 top 50 条评论，POST 回 `/api/acquisition/comment-score-result`
5. 中台收评论，逐条调 OpenRouter DeepSeek 打分 → 写飞书 `table_id_leads`
6. 用户访问 `/dashboard/leads`，看到带等级标签（🟡感兴趣 🟠精准 🔴高意向）的 Leads 表格

## Response Schema

### POST /api/acquisition/keyword-search

**Request Body**: `{"keyword": "<string>"}`

**Success (HTTP 200)**:
```json
{"task_id": "<uuid>", "keywords": ["装修", "室内设计", "旧房改造", "家装风格", "装修预算"]}
```
- `task_id` (string uuid, 必填)；`keywords` (string[5], 必填，含原词)
- **禁用字段名**: `id`/`job_id`/`result`/`data`/`expanded`/`variants`
- **禁用字段数**: 顶层 keys 完全等于 `["keywords", "task_id"]`

**Error (HTTP 400)**: `{"error": "MISSING_KEYWORD"}`；body 唯一 key 为 `error`

---

### GET /api/acquisition/leads

**Query Parameters**:
- `grade` (string, 可选): 筛选，枚举 `感兴趣|精准|高意向`；禁用别名 `level`/`type`/`score`/`filter`

**Success (HTTP 200)**:
```json
{
  "leads": [
    {
      "commenter_id": "@user_123",
      "comment_text": "怎么联系你",
      "source_video_url": "https://www.douyin.com/video/xxx",
      "crawled_at": "2026-05-24T10:00:00Z",
      "grade": "高意向",
      "keyword": "装修"
    }
  ],
  "total": 1
}
```
- `grade` 枚举字面量: `"感兴趣"` | `"精准"` | `"高意向"`，禁用英文或数字变体
- **禁用字段名**: `data`/`items`/`records`/`rows`/`result`
- **顶层 keys 完全等于** `["leads", "total"]`

**Error (HTTP 400)**: `{"error": "INVALID_GRADE"}` — grade 传非法值时

## 边界情况

- Agent 离线 → `keyword-search` 返 HTTP 503 + `{"error": "AGENT_OFFLINE"}`
- 飞书 token 过期 → `leads` API 返 503 + `{"error": "FEISHU_TOKEN_EXPIRED"}`
- 某视频评论0条 → 跳过不写飞书，不计入 total
- grade 非法值 → 400 + `{"error": "INVALID_GRADE"}`

## 范围限定

**在范围内**：
- `POST /api/acquisition/keyword-search` — 扩词 + 派任务
- `POST /api/acquisition/video-search-result` — Agent 上报视频列表（含 keyword 归属）
- `POST /api/acquisition/comment-score-result` — Agent 上报评论 → 打分 → 写飞书
- `GET /api/acquisition/leads` — 读飞书 Leads 表，支持 grade 筛选
- `apps/api/src/services/lead-writer.ts` 扩展 `grade`/`keyword` 两字段写飞书
- `apps/dashboard/src/pages/LeadsPage.tsx` — 等级标签表格，列: 抖音号/评论内容/等级/来源视频/时间
- `apps/dashboard/src/config/navigation.config.ts` 注册 `/dashboard/leads`

**不在范围内**：主号绑定（复用现有）、飞书重绑定、Leads 删除/编辑、任务历史查询

## 假设

- [ASSUMPTION: 主号 Chrome CDP 端口由 Agent 通过 agent_platform_sessions 上报，role 为 'main'，复用 Sprint B-1 session 机制]
- [ASSUMPTION: OpenRouter API key 从 `op item get "OpenRouter API Key" --vault CS` 取 `api_key` 字段，运行时注入 API 环境变量]
- [ASSUMPTION: `tenant_feishu_bindings.table_id_leads` 已由 Sprint A 创建，不需要新建飞书表]
- [ASSUMPTION: `lead-writer.ts` 现有5字段保持，追加 `grade`/`keyword` 两飞书字段]

## 预期受影响文件

- `apps/api/src/routes/acquisition.ts`: 新增3个 endpoint（keyword-search / video-search-result / comment-score-result）+ GET leads
- `apps/api/src/services/lead-writer.ts`: 扩展写入 grade + keyword
- `apps/dashboard/src/pages/LeadsPage.tsx`: 新页面（thin — 读 API 展示表格）
- `apps/dashboard/src/config/navigation.config.ts`: 注册 /dashboard/leads 入口

## E2E 验收

```bash
# WS3 smoke — GET /api/acquisition/leads schema 校验（local_api + feishu mock）
curl -sf "http://localhost:$API_PORT/api/acquisition/leads" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  | jq -e '(keys | sort) == ["leads","total"]
      and (.leads | type == "array")
      and (.total | type == "number")'
echo "✅ GET /api/acquisition/leads schema 正确"

# grade 筛选参数名校验
curl -sf "http://localhost:$API_PORT/api/acquisition/leads?grade=高意向" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  | jq -e '.leads | map(.grade) | all(. == "高意向")' && echo "✅ grade 筛选正确"

# grade 非法值 → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:$API_PORT/api/acquisition/leads?grade=invalid" \
  -H "Authorization: Bearer $TEST_TOKEN")
[ "$STATUS" = "400" ] && echo "✅ 非法 grade → 400"
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/src/pages/LeadsPage.tsx，用户可见 /dashboard/leads 页面
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 产品，Agent 运行在客户 Windows 机器 Chrome CDP，Dashboard E2E 走 GitHub Actions windows-latest runner
