# Sprint PRD — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — line05 视频剪辑（批量混剪 thin→medium 加厚）
- **当前进度**：77%
- **本次推进预期**：+3%（批量混剪从固定模板/纯文字候选升级为文案驱动分段 + 在线预览 + 大批量可视化浏览）

## 背景

已批准 GP f6f96e17（line05/批量混剪）主链路 S1-S4 已实现（PR#1878）。本 sprint 打包三个加厚方向：文案驱动动态分段模板、PickStep 素材在线预览、候选量提升到 200+ 并以缩略图拼贴虚拟滚动浏览（选定后才真实 ffmpeg 渲染，规避 hk-vps 4 核 CPU 过载）。方向四（候选内直接剪辑）另立 sprint，本次不做。

## Golden Path（核心场景）

客户从 [粘贴文案] → 经过 [确认分段模板 → 在线预览挑素材 → 刷缩略图选候选] → 到达 [选中候选后真实渲染出成片]。

具体：
1. 客户粘贴一段文案/脚本 → 系统调 TOAPIS/Gemini（复用 mashup-render.ts 同等调用模式，不新增合规 Gate）解析出分段结构（角色标签映射现有 S1 ai_tags 体系，命中则标签、未命中标"兜底映射"）+ 每段建议素材数量 → 客户在同一界面确认/微调 → 落成新 mashup_templates 行
   - 失败（AI 超时/超长/鉴权失效/欠费/5xx/网络错误）统一归为"AI 服务不可用" → 静默降级走固定模板，不阻断客户流程
2. 客户在素材选择步骤看到素材卡片，可直接在线播放预览（复用 signedUrl 模式），渲染 `<video>` 元素 → 挑选/确认各分段槽位素材
   - signedUrl 过期 → 前端自动重签重试；素材损坏/格式不支持 → 卡片标"预览不可用"，不阻断选择
3. 客户点"生成候选" → 系统复用现有 J10 去重（Jaccard=0.8）+ beamWidth 放大池生成候选，以缩略图拼贴卡片（抽帧自 video-frame-extract.ts）虚拟滚动呈现 → 客户如实看到"共生成 N 条候选"（不承诺死数字 200）
4. 客户点开候选预览、选中一条 → 此刻才真实调用 ffmpeg 渲染（此前全部候选均未真实渲染）
   - 渲染并发上限=1，排队显示"第 N 位"；渲染失败 → 新增"渲染失败"态，客户可"重新渲染"或"换一条候选"，非死路
5.（已有，不动）渲染完成 → 结果页看到可在线播放的 1080P 成片，经内容安全自查

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- AI 分段解析失败/超时 → 静默降级固定模板（非阻断）
- signedUrl 过期 → 自动重签；素材损坏 → 卡片标"预览不可用"
- 候选去重后不足 200 → 如实显示实际数量，不凑数
- 渲染失败 → 独立"渲染失败"态，可重渲/换候选
- 并发渲染请求 → 第 2 个进入排队态（并发=1）

## 范围限定

**在范围内**：文案→动态分段模板生成、PickStep 素材在线预览、候选 200+ 缩略图拼贴虚拟滚动浏览、选定后按需 ffmpeg 渲染 + 渲染排队/失败态。
**不在范围内**：方向四候选内直接剪辑（另立 sprint）、内容安全审核逻辑改动（沿用 S4）、声音克隆（沿用现有）。

## 假设

- [ASSUMPTION: TOAPIS/Gemini 凭据 `~/.credentials/toapis.env` 在 hk-vps 上可用（现有 mashup-render.ts/material-tagging.ts 生产在用）]
- [ASSUMPTION: 单租户单人操作，无同批素材多会话并发编辑，提交仅需去抖防重复，不上乐观锁（决策 436b6ad5）]
- [ASSUMPTION: 文案角色标签复用 S1 ai_tags 枚举，个别语义对不齐可后续迭代（决策 f33415af）]

## 预期受影响文件

- `apps/api/src/services/mashup-slot-assignment.ts`：新增文案→动态分段模板解析
- `apps/api/src/services/mashup-candidate-generation.ts`：候选量提升到 200+ + 缩略图拼贴 URL 产出
- `apps/api/src/services/mashup-render.ts`：渲染并发=1 队列 + 渲染失败态
- `apps/api/src/services/video-frame-extract.ts`：候选缩略图抽帧复用
- `apps/api/src/routes/materials.ts`：素材在线预览 signedUrl
- `apps/api/db/migrations/*`：mashup_templates 动态分段结构（如需）
- `apps/dashboard/src/pages/MashupPage.tsx`：文案粘贴/确认、素材在线预览、候选虚拟滚动、渲染排队/失败态

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；下列取自 PrepPRD 显式值（主源） -->
- 渲染并发：ffmpeg 并发上限=1，第 2 个请求进排队（hk-vps 4 核硬约束）
- 去重：候选生成 Jaccard 阈值=0.8（复用现有 DEDUPE_JACCARD_THRESHOLD）
- 降级：AI 分段失败静默降级固定模板，不阻断
- 可观测：渲染失败/AI 不可用需可见（失败态 + 排队位次）
- 前端性能：候选虚拟滚动，DOM 节点数与可视区域一致，非 200+ 全量渲染

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 line 暂无） -->
- [租户隔离] 素材/模板/候选按租户隔离，跨租户不可见（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [端点鉴权] 所有 API 端点必须鉴权（来源: area）
- [凭据安全] TOAPIS/Gemini 凭据不硬编码，从 ~/.credentials 读取（来源: area）
- [日志脱敏] 日志不得输出敏感信息（来源: area）
- [禁写死环境值] 禁止写死环境假设值（如候选数固定 200）（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [测试多租户] 测试默认多租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: product-map line05/batch_mashup（active）+ PR#1878；journey golden-paths 端点暂无结构化行 -->
- 批量混剪(S1-S4): Step1 素材打标签生成 ai_tags → Step2 槽位模板分配 → Step3 语义检索候选生成(J10 去重 Jaccard0.8/beamWidth) → Step4 选中方案 ffmpeg 渲染 + 内容安全 Gate + 内联视频预览

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=linux_server 填入（SSH hk-vps：curl API + psql + ffmpeg 并发观测）。

```bash
# 占位：proposer 将按 target_environment=linux_server 填入真实脚本（SSH hk-vps → curl + psql + 进程观测）
# 期望验收点（自然语言）：
# 1. 粘贴测试文案 → API 返回结构化分段（角色标签命中 ai_tags 枚举或标"兜底映射"）→ psql 查到新 mashup_templates 行
# 2. PickStep 素材卡片可点击播放，实际发出 signedUrl 请求并渲染 <video> 元素
# 3. targetCount=200 请求候选生成 → 返回候选数≤200（去重后实际值），每条含缩略图拼贴 URL，前端虚拟滚动 DOM 节点数与可视区一致
# 4. 选定候选触发真实 ffmpeg 渲染；第 2 个并发渲染请求进入排队态（并发实测=1）
# 5. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/src/pages/MashupPage.tsx 客户交互（粘贴文案/在线预览/浏览候选），命中 user_facing。
## target_environment: linux_server
## target_environment_reason: 核心验收（模板落库、候选 200 生成、ffmpeg 并发=1）依赖 hk-vps 上真实 ffmpeg + TOAPIS 凭据 + DB，走 SSH hk-vps curl+psql；GHA/windows_cloud 无这些资源会全部假绿。
## journey_id: bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8
## step_id: line05/batch_mashup#step1-4
