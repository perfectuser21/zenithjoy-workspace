# Sprint PRD — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

## OKR 对齐

- **对应 KR**：KR「ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付」
- **当前进度**：77%
- **本次推进预期**：+3%（line05/批量混剪 从 thin 加厚到 medium，S1-S4 可用性提升）

## 背景

批量混剪 S1-S4 主链路已实现（PR#1878：打标签→槽位分配→候选生成→ffmpeg 渲染+内容安全）。当前体验是「固定 4 槽位模板、素材列表纯文字、候选十几条纯文字」。本 sprint 加厚三方向：文案粘贴自动生成动态分段模板、素材在线预览、候选 200+ 缩略图拼贴可视化浏览且选中才真实渲染。方向四（候选内直接剪辑，决策 f076603d）另立 sprint，不在本次范围。

## Golden Path（核心场景）

客户从 [粘贴文案] → 经过 [确认分段→预览挑素材→浏览候选→选中] → 到达 [看到渲染成片]。

1. 客户粘贴一段文案/脚本 → 系统调 TOAPIS/Gemini（复用 mashup-render.ts 同等调用模式，不新增合规 Gate）解析出分段结构（角色标签映射现有 S1 ai_tags 枚举，对不齐的标「兜底映射」）+ 每段建议素材数量 → 客户在同一界面确认/微调 → 落成新 mashup_templates 行
2. 客户进入素材选择步骤 → 素材卡片可直接在线播放预览（复用 materials 路由 previewUrl / getSignedUrl 模式，渲染 `<video>`）→ 挑选/确认各分段槽位素材
3. 客户点「生成候选」（targetCount=200）→ 系统复用现有 J10 去重（Jaccard 阈值 0.8）+ beamWidth 放大池 → 每条候选带缩略图拼贴 URL（抽帧自 video-frame-extract.ts）→ 前端虚拟滚动浏览，如实显示实际去重后数量（「共生成 N 条候选」，不承诺死数字 200）
4. 客户点开候选、选中一条 → 此刻才真实调用 ffmpeg 渲染（此前候选全部未真实渲染）；渲染并发上限=1，第 2 个请求进排队态显示「第 N 位」
5.（已有，不动）渲染完成 → 客户结果页看到可在线播放的 1080P 成片，经内容安全自查

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- **Step1 AI 不可用**：超时/超长/鉴权失效/欠费/5xx/网络错误统一归为「AI 服务不可用」→ 静默降级走固定模板（非阻断，区别于 S4 content-safety 的 failed_pending_review 阻断式转人工——Step1 是输入结构化，非内容安全判定）
- **Step2 signedUrl 过期** → 前端自动重签重试；素材损坏/格式不支持 → 卡片标「预览不可用」，不阻断选择
- **Step2 重复提交** → 按钮禁用 + 去抖（不上乐观锁，决策 436b6ad5：单租户单人操作，无并发编辑场景）
- **Step4 渲染失败** → 新增「渲染失败」态，客户可「重新渲染」或「换一条候选」，非死路

## 范围限定

**在范围内**：文案→动态分段模板生成；素材卡片在线视频预览；候选 200+ 缩略图拼贴 + 虚拟滚动；选中才真实 ffmpeg 渲染 + 并发=1 排队 + 渲染失败态。
**不在范围内**：方向四候选内直接剪辑（另立 sprint）；内容安全审核逻辑改动（沿用现有 S4）；声音克隆（沿用现有）。

## 假设

- [ASSUMPTION: 文案解析角色标签复用 S1 ai_tags 枚举，语义对不齐的个别项标「兜底映射」交客户手调（决策 f33415af）]
- [ASSUMPTION: targetCount=200 在服务端现有区间 [50,300] 内（HARD_MAX_TARGET_COUNT=300），无需放宽上限]
- [ASSUMPTION: 缩略图拼贴复用 video-frame-extract.ts 抽帧能力，不新引入抽帧依赖]

## 预期受影响文件

- `apps/api/src/routes/mashup.ts`：新增文案→分段模板端点、候选响应补缩略图拼贴 URL、渲染并发排队态
- `apps/api/src/services/mashup-slot-assignment.ts` / `apps/api/db/migrations/*mashup_slot_templates.sql`：动态分段模板落库
- `apps/api/src/services/mashup-candidate-generation.ts`：targetCount=200 路径 + 候选缩略图字段（去重/beamWidth 不改）
- `apps/api/src/services/mashup-render.ts` / `mashup-render-ffmpeg.ts`：渲染并发上限=1 队列 + 渲染失败态（新增，当前无并发控制）
- `apps/api/src/services/video-frame-extract.ts` / `apps/api/src/routes/materials.ts`：缩略图抽帧复用 + previewUrl 供 Step2 预览
- `apps/dashboard/src/pages/MashupPage.tsx` / `apps/dashboard/src/api/mashup.api.ts`：粘贴文案确认分段、素材 `<video>` 预览、候选虚拟滚动缩略图墙、渲染排队/失败态 UI

## NFR 约束

<!-- 来源: PrepPRD 显式值（主源），本 line decisions?category=nfr 端点当前返回空 -->
- 超时/降级：Step1 AI 解析失败统一归「AI 服务不可用」→ 静默降级固定模板（非阻断）
- 频控/并发：Step4 ffmpeg 渲染并发上限=1，超出进排队显示「第 N 位」（hk-vps 4 核硬约束，决策 d6bedf80）
- signedUrl TTL：3600s（复用 DEFAULT_SIGNED_URL_TTL_SECONDS），过期前端自动重签
- 候选去重：Jaccard 阈值 0.8（复用现有 J10 DEDUPE_JACCARD_THRESHOLD，不改）
- 前端性能：候选虚拟滚动，DOM 节点数与可视区域一致，非 200+ 全量渲染
- 可观测：渲染失败落「渲染失败」态可重试/换候选；候选数如实显示实际去重后数量（决策 3ed368c3）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: PrepPRD 判定点登记表引用的已拍板决策；本 line Brain invariants 端点（step/feature/area 三源）当前均返回空 -->
- [租户隔离] 记忆/素材/模板按租户隔离，单租户单人操作，不引入乐观锁（来源: 决策 436b6ad5）
- [诚实展示] 候选数如实显示实际去重后数量，不放宽阈值凑数、不承诺死数字 200（来源: 决策 3ed368c3）
- [安全 Gate 不动] Step5 内容安全自查沿用现有 S4 逻辑，本 sprint 不改动内容安全判定（来源: PrepPRD 不包含项）
- [Step1 非阻断] 文案解析是输入结构化，AI 不可用时静默降级固定模板，禁止套用 S4 阻断式 failed_pending_review（来源: PrepPRD Golden Path Step1）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: PrepPRD「Journey 当前状态」+ PR#1878；本 line Brain journeys/:id/golden-paths 端点当前返回空 -->
- 批量混剪 S1-S4（PR#1878）: Step1 素材打标签（material-tagging.ts）→ Step2 槽位模板分配（mashup-slot-assignment.ts）→ Step3 语义检索候选生成（mashup-candidate-generation.ts，J10 去重 Jaccard 0.8 + beamWidth）→ Step4 ffmpeg 渲染 1920x1080 + 内容安全自查 + 内联视频预览

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl 本地 API + psql + 真 ffmpeg，与现有 mashup-*-smoke.sh 一致）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl+psql+ffmpeg）
# 期望验收点（自然语言）：
# 1. 粘贴测试文案 → API 返回结构化分段（角色标签命中现有 ai_tags 枚举或标「兜底映射」）→ 落成新 mashup_templates 行
# 2. PickStep 素材卡片可点击播放，实际发出 signedUrl/previewUrl 请求并渲染 <video> 元素
# 3. targetCount=200 请求候选生成 → 返回候选数 ≤200（去重后实际值），每条含缩略图拼贴 URL，前端虚拟滚动 DOM 节点数与可视区一致（非全量）
# 4. 选定候选触发真实 ffmpeg 渲染，渲染并发实测限制为 1（第 2 个并发请求进入排队态「第 N 位」）
# 5. CI 全绿（mashup-candidate-generation-smoke.sh / mashup-render-smoke.sh 保持全绿）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/MashupPage.tsx 客户界面，客户粘贴文案/预览素材/浏览候选/选中渲染的端到端使用路径
## target_environment: local_api
## target_environment_reason: 硬验收点为后端契约 + 真 DB + 真 ffmpeg（渲染并发=1、候选去重数、分段落库），与本 line 现有 mashup-*-smoke.sh 一致，由本地 evaluator 在 ubuntu smoke runner 上跑 curl 本地 API + psql + ffmpeg
## journey_id: bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8
## step_id: line05/batch_mashup#step1-4
