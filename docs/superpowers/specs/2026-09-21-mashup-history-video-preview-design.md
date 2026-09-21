# 批量混剪：素材视频在线预览 + 混剪历史记录

- Brain Task: `2fa68b23-811c-428e-a483-242952aab1b3`
- GP-Anchor: `line05/batch_mashup#step2`
- 决策: `123c753e`（本次功能方向）；沿用 `1a20f778`（不做网格抽帧）、`623a81d7`（候选轻量预览）、`d6bedf80`（渲染并发=1 队列）

## 问题

两件客户侧的"看不见"：

1. **素材库里视频是个死图标。** `MaterialsPage.tsx:36` 的 `canPreview = !video && Boolean(item.preview_url)` 把视频挡在预览之外，弹窗固定显示"视频暂不支持在线预览"。但后端 `materials.ts:215` 的 `GET /:id/preview` 早就是为"素材卡片要在线播放，前端需要一个可直接喂给 `<video>` 的临时 URL"写的——端点在，前端没接。决策 `1a20f778` 否掉的是"网格里每条都 ffmpeg 抽帧"，不是"点开播放"；这两件事在代码里被并成了一件。

2. **混剪做过就没了。** 后端只有 `GET /runs/:id`（要先知道 id），没有租户级列表；`MashupPage.tsx` 的 `run`/`candidates`/`renderResult` 全是组件内存状态（`:94-102`），刷新或离开即丢。客户跑完一轮候选生成（真实 LLM + 向量检索成本）离开页面，回来只能从头再跑。

## 范围

做：素材详情弹窗内联播放视频；`GET /api/mashup/runs` 租户级历史列表；混剪页「历史记录」入口，支持恢复未选定候选、回看已完成成片。

不做：素材库网格视频抽帧缩略图（维持 `1a20f778`）、历史记录的删除/归档、剪辑轨道编辑器。

## A. 素材视频在线预览

### 数据来源：用 `/preview` 端点，不用列表里的 `preview_url`

`GET /materials` 返回的 `preview_url` 是列表渲染时签发的，TTL 1 小时，且前端 react-query 还会缓存 5 分钟；弹窗打开的那一刻它可能已经过期，`<video>` 拿到过期 URL 只会黑屏。`GET /materials/:id/preview` 是打开弹窗时现签的，并回 `expiresAt`。多一次请求换"点开就能播"，值。

新增 `getMaterialPreview(materialId)` 到 `materials.api.ts`，鉴权沿用同文件的 `getUploadToken()`（登录态换 license_key，再带 `X-Upload-Token`）。

### 判定点：什么算"这条能播"

后端 `previewAvailable = previewUrl !== null && mime_type.startsWith('video/')`（`materials.ts:249-250`），而前端 `isVideo()` 在 mime 不可靠时会退回看扩展名（`materials.api.ts:67-70`，注释写明"快捷指令有时传 octet-stream"）。同一条 iPhone 快捷指令上传的 `.mov`，后端说不可播、前端说是视频——两边会给出相反结论。

**取 `previewUrl !== null` 作为播放依据，不绑 `previewAvailable`**：只要签出了 URL 就喂给 `<video controls>`，浏览器解不了再由 `onError` 降级到占位 + "打开原文件"。理由：`previewAvailable=false` 的两种成因里，"签不出 URL"已被 `previewUrl === null` 覆盖，剩下的"mime 不是 video/"恰恰是 octet-stream 假阴性这一种——按它拦截就等于把能播的素材判死。误判方向也更安全：播不了最多多一次 `onError` 降级，拦错了客户永远看不到。

### 交互

`Lightbox` 的 video 分支三态：拉取中"预览地址获取中…" → 拿到 URL 渲染 `<video src controls>` → 签发失败或 `onError` 显示占位图标 + 原有"打开原文件"链接。图片分支、网格 `Tile` 一律不动。

## B. 混剪历史记录

### 后端：`GET /api/mashup/runs`

一次查询带出列表页要的全部信息，租户从凭据反查（`authenticate()`，与同文件其它端点同口径）：

```sql
SELECT r.id, r.template_id, r.status, r.created_at, r.selected_candidate_id,
       (SELECT COUNT(*) FROM zenithjoy.mashup_candidates c WHERE c.run_id = r.id) AS candidate_count,
       (SELECT c.thumbnail_url FROM zenithjoy.mashup_candidates c
         WHERE c.run_id = r.id AND c.thumbnail_url IS NOT NULL
         ORDER BY c.score DESC LIMIT 1) AS thumbnail_url,
       EXISTS (SELECT 1 FROM zenithjoy.contents ct
                WHERE ct.source_candidate_id = r.selected_candidate_id
                  AND ct.export_url IS NOT NULL) AS has_export
  FROM zenithjoy.mashup_runs r
 WHERE r.tenant_id = $1
 ORDER BY r.created_at DESC
 LIMIT $2 OFFSET $3
```

`stage` 由上面四个事实在应用层派生，四态：

| stage | 条件 | 列表上的样子 |
|---|---|---|
| `completed` | `selected_candidate_id` 非空 且 `has_export` | 已完成 → 点进去看成片 |
| `rendering` | `selected_candidate_id` 非空 且 无 export | 渲染中 → 点进去继续等 |
| `candidates_pending` | 无 selected 且 `candidate_count > 0` | 候选待选定 → 点进去接着选 |
| `assigned` | 无 selected 且 `candidate_count = 0` | 只分了槽位 → 点进去从候选生成继续 |

**"已完成"以 `contents.export_url` 非空为准，不看 `mashup_runs.status`**：`status` 列没有 CHECK 约束、由应用层写；而 `export_url` 是内容安全 Gate fail-closed 之后才写入的（`20260919_030000_mashup_export_gate.sql`：安全检查非 passed 则 export_url 必须为 NULL）。用 status 判会把"渲染跑完但被 Gate 拦下"的 run 显示成已完成，客户点进去看不到片子。

不返回 `exportUrl` 本身——列表只需要知道"有没有"，成片 URL 由点进去时 `getCandidateDetail()` 拿，少一份签名 URL 暴露在列表响应里。

分页 `limit` 默认 20、上限 100（与 `materials.ts` 同口径），越界夹取不报错。

路由注册在 `'/runs/:id'` 之前，避免以后有人把 `:id` 改成宽松匹配时意外吞掉 `/runs`。

### 前端：混剪页内的「历史记录」

`Step` 类型加 `'history'`，页面顶部在 `pick` 与 `history` 之间切换（不新增路由、不动 `navigation.config.ts`——`/mashup` 已是独立路由，历史属于同一件事的两个入口）。

`HistoryStep` 是纯展示 + 回调，不自己持有业务状态：列表项显示缩略图、创建时间、stage 徽章、候选数，点击回调交给页面。

恢复路径全部复用已有 API，不新增后端接口：

| 点的是 | 动作 | 落到哪一步 |
|---|---|---|
| `candidates_pending` / `assigned` | `getRun(runId)` + `listCandidates(runId)` | `setStep('candidates')`（`assigned` 且候选为空时落 `assigned` 步，由客户自己点生成） |
| `completed` / `rendering` | `getCandidateDetail(selectedCandidateId)` 取 `.content` | `setStep('result')` |

**恢复候选走 `listCandidates`（`GET /runs/:id/candidates`）而不是 `generateCandidates`（`POST`）** —— 这是本功能的要害：重跑一次候选生成意味着重新算向量、重新拼缩略图，客户等的就是这个。`CandidatesStep` 需要的 `materialsById` 来自页面级 `materialsQuery`（`MashupPage.tsx:105`），恢复时本来就在，不必额外拉。

`rendering` 态拿到的 `content` 可能为 `null`（还没写 contents 行），按现有 `selectAndRenderMutation` 的同口径降级成 `failed_pending_review` 呈现，不裸崩。

## 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| API | `apps/api/src/routes/__tests__/mashup.test.ts`（扩展） | 无凭据 401；只返回本租户的 run；四个 stage 各一条；limit 越界夹取 |
| 前端 | `apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx`（新） | 列表渲染四态徽章；点 `candidates_pending` 调 `listCandidates` 且**不调** `generateCandidates`；点 `completed` 调 `getCandidateDetail` 并渲染成片 |
| 前端 | `apps/dashboard/src/pages/MaterialsPage.Lightbox.test.tsx`（新） | 视频素材弹窗渲染 `<video controls>` 且 src 来自 `/preview`；签发失败落占位；`onError` 降级 |
| Smoke | `.github/workflows/scripts/smoke/mashup-history-smoke.sh`（新） | 真库真服务打 `GET /mashup/runs`：租户隔离、stage 与库里事实一致 |

新 smoke 要登记两处，缺一处就是假绿：

1. `product-map/product-map.yaml` 的 `batch_mashup.smoke_files`（再重新生成 `product-map.json`）——`lint-gp-anchor` 要求 PR 触碰锚定 GP 的 smoke_files，新脚本登记进去后本 PR 才算"推进了 step2"。
2. `.github/workflows/scripts/smoke-baseline.txt`——`ci-smoke-glob-runner` 按目录通配执行全部 `*.sh`，但只有登记进 baseline 的才是"必绿"，否则失败仅作报告不拦 PR（`lint-smoke-baseline.sh` 校验这条棘轮）。

脚本本身按 `lint-feature-has-smoke` 的门槛写：非注释非空行 ≥ 5，且至少一条真实 `curl`/`psql` 命令。

## 验收（Final E2E，`windows_cloud`）

1. 素材库点开一条视频素材 → 弹窗内 `<video controls>` 能播（真机，非 mock）
2. `GET /mashup/runs` 真实返回本租户历史，stage 正确区分候选待选定 / 已完成
3. 点"候选待选定" → 回到候选页，且未调用候选生成接口
4. 点"已完成" → 直接看到成片播放 + 下载
5. CI 全绿
