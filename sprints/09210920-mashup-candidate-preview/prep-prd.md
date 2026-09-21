# PrepPRD：批量混剪（line05/batch_mashup）— 候选真实轻量预览 + 终版渲染轮询修复

GP-Anchor: line05/batch_mashup#step3

## 背景 / 纠偏

决策 `623a81d7` 纠偏 `d6bedf80`：PR#1905 落地的候选可视化是"纯缩略图拼贴 + 盲选"，
用户对比剪映/CapCut 反馈不满足"合成前先看到真实效果才决定选谁"的诉求。用户拍板
分两步：**Step1（本 sprint）= 候选真实轻量预览**；Step2（另立 sprint）= 剪辑轨道
编辑器（方向四，自建网页版）。

排查过程中额外发现一个真实回归（非本次引入，但必须一并修）：PR#1905 把
`POST /candidates/:id/render` 从同步返回终版结果改成异步入队（`enqueueRender`，
决策 d6bedf80），但 Dashboard 前端 `MashupPage.tsx`/`mashup.api.ts` 从未同步更新，
仍假设该端点同步返回 `RenderResult`——实际每次点"选这个渲染成片"都会把队列态
`{renderStatus:'rendering', contentId:null}` 误判成"安全审核未通过"。本 sprint
一并修复（改成轮询 `GET /candidates/:id` 直到落终态）。

## Golden Path（本次覆盖的一段）

1. 客户在候选列表看到每条候选的缩略图 → 点"先看看效果" → 几秒内出现可播放的
   低清预览视频（真实拼接素材，非最终画质）→ 客户看完决定要不要选它
2. 客户点"选这个，合成正式成片" → 前端进入渲染中态（轮询）→ 渲染完成后自动
   跳到成片页展示高清成片（原有 ResultStep 不变）

## 技术方案

- 预览走**独立于终版渲染的并发=1队列**（`mashup-preview-queue.ts`），复用终版渲染
  的候选→素材解析逻辑（提取为 `resolveOrderedMaterials`），但用更快/更小的
  ffmpeg 档位（480p/24fps/ultrafast/crf32，`mashup-preview-render.ts`），不跑
  Gemini 内容安全审核（预览不是可下载交付物），不写 `contents` 表。
- 新增候选详情端点 `GET /candidates/:id`，同时带出预览态与终版渲染态+content，
  供前端轮询。
- 两把并发=1的锁合计最坏 2 个并发 ffmpeg 进程，hk-vps 4 核可接受（决策 d6bedf80）。

## 涉及文件

- `apps/api/db/migrations/20260921_000000_mashup_candidate_preview.sql`：
  `mashup_candidates.preview_status`/`preview_url`
- `apps/api/src/services/mashup-preview-render.ts`（新）、
  `mashup-preview-queue.ts`（新）
- `apps/api/src/services/mashup-render.ts`：提取 `resolveOrderedMaterials` 共享逻辑
- `apps/api/src/services/mashup-render-ffmpeg.ts`：`concatAndScale` 加轻量档位 opts
- `apps/api/src/routes/mashup.ts`：`POST /candidates/:id/preview`、
  `GET /candidates/:id`
- `apps/dashboard/src/api/mashup.api.ts`：候选/渲染/预览类型对齐后端真实契约
- `apps/dashboard/src/pages/MashupPage.tsx`：候选卡片预览按钮+内联播放、
  渲染改轮询

## 前置工作

- [x] hk-vps ffmpeg 已装（PR#1878 验证过）
- [x] 现有 storage/材料签名链路复用，无新增凭据

## 验收标准

- [ ] 后端单测全绿（mock DB，不连真 Postgres/真 ffmpeg，CI L3 job 无 DB 容器）
- [ ] 前端组件测试覆盖预览按钮三态（未预览/生成中/就绪播放）
- [ ] CI 全绿
- [ ] 人工在 staging 走一遍：粘文案→选素材→候选出现→点预览看到真实播放→选定→
      轮询到成片
