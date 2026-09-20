# Sprint PRD — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+2%（批量混剪 thin→medium 加厚，line05 Journey 前进一格）

## 背景

批量混剪（line05/batch_mashup，journey_features `028570eb-b461-4bfe-802a-d450ab59de73`）已实现 S1-S4 主链路（打标签→槽位分配→候选生成→ffmpeg 渲染，PR#1878）。当前体验为「固定 4 槽位模板、素材纯文字列表、候选十几条纯文字」。本 sprint 打包 GP f6f96e17 已批准的三个加厚方向，让客户可粘贴文案得到专属分段、在线预览素材、缩略图拼贴浏览大批候选，选中才真实渲染。（方向四「候选内直接剪辑」已拍板另立 sprint，决策 `f076603d`，本次不做。）

## Golden Path（核心场景）

客户从 [粘贴文案] → 经过 [动态分段 / 在线预览素材 / 浏览候选缩略图] → 到达 [选中候选并真实渲染出成片]

1. 客户粘贴一段文案/脚本 → 系统调 TOAPIS/Gemini（复用 mashup-render.ts 同款调用模式，不新增合规 Gate）解析出**动态分段结构**（角色标签映射现有 S1 ai_tags 枚举，未命中标「兜底映射」）+ 每段建议素材数 → 客户在同界面确认/微调 → 落成新 mashup_templates 行
   - AI 超时/超长/鉴权失效/欠费/5xx/网络错误 → 统一归「AI 服务不可用」→ **静默降级走固定模板**（非阻断，区别于 S4 内容安全的 failed_pending_review 阻断）
2. 客户在素材选择步骤看到素材卡片可**在线播放预览**（复用 signedUrl 模式，渲染 `<video>`）→ 挑选/确认各分段槽位素材
   - signedUrl 过期 → 前端自动重签重试；素材损坏/不支持 → 卡片标「预览不可用」，不阻断选择
3. 客户点「生成候选」→ 复用现有 J10 去重（Jaccard 阈值 0.8）+ beamWidth 放大池生成**候选 200+**，以**缩略图拼贴卡片**（抽帧自 video-frame-extract.ts）**虚拟滚动**浏览
   - 候选数如实显示实际生成数量（「共生成 N 条候选」），不承诺死数字 200（决策 `3ed368c3`）
4. 客户点开候选、选中一条 → **此刻才真实调 ffmpeg 渲染**（此前候选全部未真实渲染）
   - 渲染并发上限=1，排队显示「第 N 位」（hk-vps 4 核硬约束）
   - 渲染失败 → 新增「渲染失败」态，可「重新渲染」或「换一条候选」，非死路
5.（已有，不动）渲染完成 → 结果页在线播放 1080P 成片，经 S4 内容安全自查

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- AI 分段返回空/非法结构 → 降级固定 4 槽位模板，不报错阻断
- 候选去重后不足 200 → 如实显示实际数量（决策 `3ed368c3`）
- 提交/保存去抖 + 按钮禁用防重复提交（不上乐观锁——单租户单人操作场景不存在，决策 `436b6ad5`）
- 200+ 候选虚拟滚动：DOM 节点数与可视区一致，禁止全量渲染

## 范围限定

**在范围内**：文案动态分段模板生成、PickStep 素材在线预览、候选 200+ 缩略图拼贴虚拟滚动浏览、选定后按需 ffmpeg 渲染 + 渲染队列/失败态
**不在范围内**：方向四候选内直接剪辑（另立 sprint）、内容安全审核逻辑改动（沿用 S4）、声音克隆（沿用现有）

## 假设

- [ASSUMPTION: 文案解析复用现有 mashup-render.ts 的 TOAPIS/Gemini 调用与 `~/.credentials/toapis.env` 凭据，不新增第三方依赖]
- [ASSUMPTION: 缩略图拼贴 URL 由 video-frame-extract.ts 抽帧产出，不新引入图像合成服务]

## 预期受影响文件

- `apps/api/src/services/mashup-slot-assignment.ts`：文案动态分段结构生成
- `apps/api/src/services/mashup-candidate-generation.ts`：候选量提升 200+，候选懒渲染（生成期不渲染）
- `apps/api/src/services/mashup-render.ts` / `mashup-render-ffmpeg.ts`：渲染并发=1 队列 + 渲染失败态
- `apps/api/src/services/video-frame-extract.ts`：候选缩略图拼贴抽帧
- `apps/api/src/routes/mashup.ts` / `apps/api/src/routes/materials.ts`：分段/预览 signedUrl/候选浏览接口
- `apps/api/db/migrations/`：mashup_templates 动态分段 + 候选渲染态 schema 增量
- `apps/dashboard/src/pages/MashupPage.tsx` / `apps/dashboard/src/api/mashup.api.ts`：文案输入、素材在线预览、候选虚拟滚动浏览、渲染队列/失败 UI

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下为 PrepPRD 显式 NFR（主源），优先生效 -->
- 算力/并发: ffmpeg 真实渲染并发上限=1，第 2 个并发进入排队态（hk-vps 4 核硬约束，决策 `d6bedf80`）
- 降级: AI 服务不可用（超时/超长/鉴权/欠费/5xx/网络）统一静默降级固定模板，非阻断
- 去重: 候选 Jaccard 去重阈值=0.8（复用现有，不改）
- 前端性能: 200+ 候选虚拟滚动，DOM 节点数与可视区一致
- 凭据/可观测: TOAPIS 凭据走 env 不硬编码；渲染失败必须落库记态供前端呈现

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 [系统] + 本 line 已验收行为 -->
- [租户隔离] 模板/素材/候选按租户隔离，跨租户不可见（来源: area）
- [真环境验证] 只有 hk-vps 真机 ffmpeg 渲染跑通才算 done，禁写死环境假设值（来源: area）
- [单slot串行] 真实渲染单 slot 串行，并发只许跨 slot（对应渲染并发=1）（来源: area）
- [凭据安全] TOAPIS/Gemini 凭据不硬编码、日志脱敏、端点鉴权（来源: area）
- [内容安全自查] 成片必须经 S4 内容安全自查后才呈现（来源: 本 line S4/S5）
- [防假成功] 渲染须确认真实产出成片才判成功，失败落「渲染失败」态而非假绿（来源: 本 line）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 S1-S4 主链路（PR#1878）；journey golden-paths 端点暂未登记，取 PrepPRD 实证 -->
- 批量混剪 S1-S4: Step1 素材打标签（ai_tags 抽帧）→ Step2 槽位分配 → Step3 候选生成（J10 Jaccard 0.8 去重 + beamWidth）→ Step4 ffmpeg 渲染 + 内容安全自查 + 内联视频预览

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=linux_server（hk-vps）产出，写进 contract-draft.md 的 `## E2E 验收`。

```bash
# 占位：proposer 将填入 curl(apps/api)+psql+ffmpeg 真机脚本（hk-vps），dashboard UI 用 Playwright 对已部署 staging
# 期望验收点（自然语言）：
# 1. 粘贴测试文案 → API 返回结构化动态分段（角色标签命中 ai_tags 枚举或标「兜底映射」）→ 落成新 mashup_templates 行
# 2. PickStep 素材卡片可点击播放，实际发出 signedUrl 请求并渲染 <video> 元素
# 3. targetCount=200 生成 → 返回候选数≤200（去重后实际值），每条含缩略图拼贴 URL，前端虚拟滚动 DOM 节点数=可视区
# 4. 选定候选触发真实 ffmpeg 渲染，实测并发上限=1（第二个并发请求进入排队态）；渲染失败落「渲染失败」态可重试
# 5. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 核心 Golden Path 由客户在 apps/dashboard MashupPage 操作（粘贴文案、在线预览、浏览候选），命中 apps/dashboard/ → user_facing。
## target_environment: linux_server
## target_environment_reason: 分段/候选/ffmpeg 渲染核心逻辑在 apps/api 服务、真实渲染与并发=1 约束只能在 hk-vps 4 核真机验证（决策 d6bedf80），SSH hk-vps + curl + psql；dashboard UI 用 Playwright 对已部署 staging 验证。
## journey_id: bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8
## step_id: line05/batch_mashup#step1-4
