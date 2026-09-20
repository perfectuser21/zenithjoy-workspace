# Sprint PRD — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+2%（批量混剪 line05 从 thin 加厚到 medium）

## 背景

已批准 GP f6f96e17（line05/批量混剪）S1-S4 主链路已上线（PR#1878）。本 sprint 把它从"固定 4 槽位模板、素材列表纯文字、候选十几条纯文字"升级为"文案自动解析出专属分段结构、素材在线播放预览、候选 200+ 缩略图拼贴可视化浏览、选中才真实 ffmpeg 渲染"。打包 PrepPRD 三个方向；方向四（候选内直接剪辑）另立 sprint。

## Golden Path（核心场景）

用户从 [粘贴文案] → 经过 [动态分段→在线预览选素材→浏览 200+ 候选缩略图] → 到达 [选中一条才真实 ffmpeg 渲染出成片]

具体：
1. 客户粘贴一段文案/脚本 → 系统调 TOAPIS/Gemini（复用 mashup-render.ts 同等调用模式，不新增合规 Gate）解析出**动态分段结构**（角色标签映射现有 S1 ai_tags 体系）+ 每段建议素材数量 → 客户在同一界面确认/微调（含"兜底映射"标注项） → 落成新 mashup_templates 行
   - 失败（AI 超时/超长/鉴权失效/欠费/5xx/网络）统一归"AI 服务不可用" → 静默降级走固定模板（非阻断）
2. 客户在**素材选择器**看到素材卡片，可直接**在线播放预览**（复用 signedUrl 模式渲染 `<video>`）→ 挑选/确认各分段槽位素材
   - signedUrl 过期 → 前端自动重签重试；素材损坏/格式不支持 → 卡片标"预览不可用"，不阻断选择
   - 提交/保存走按钮禁用 + 去抖防重复点击（不上乐观锁）
3. 客户点"生成候选" → 系统复用 J10 去重（Jaccard 阈值 0.8）+ beamWidth 放大池，**候选生成量提升到 200+**，以**缩略图拼贴卡片**（抽帧自 video-frame-extract.ts）呈现，**虚拟滚动浏览**
   - 候选数如实显示实际生成数量（"共生成 N 条候选"），不承诺死数字 200
   - 此阶段全部候选**均未真实渲染**（避免 hk-vps 4 核 CPU 过载）
4. 客户点开候选预览、**选中一条 → 此刻才真实调用 ffmpeg 渲染**
   - 渲染并发上限=1，排队显示"第 N 位"
   - 渲染失败 → 新增"渲染失败"态，客户可"重新渲染"或"换一条候选"，非死路
5.（已有，不动）渲染完成 → 结果页看到可在线播放的 1080P 成片，经内容安全自查

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- AI 分段返回空/超长/非法结构 → 归"AI 服务不可用"降级固定模板，不阻断
- signedUrl 过期/素材损坏 → 卡片标"预览不可用"，不阻断选择
- 候选去重后不足 200 → 如实显示实际数量，不凑数
- 第二个渲染请求 → 进排队态（并发=1），非并发执行
- 渲染失败 → "渲染失败"态可重试/换候选

## 范围限定

**在范围内**：文案驱动动态分段模板生成、素材在线预览、候选 200+ 缩略图拼贴虚拟滚动、选定后按需真实渲染 + 渲染队列/失败态
**不在范围内**：方向四·候选内直接剪辑（另立 sprint，决策 f076603d）；内容安全审核逻辑改动（沿用 S4）；声音克隆（沿用现有）

## 假设

- [ASSUMPTION: 动态分段的角色标签复用现有 S1 ai_tags 枚举，语义对不齐时标"兜底映射"手动调整（决策 f33415af）]
- [ASSUMPTION: 单租户单人操作，无同批素材多会话并发编辑，故仅去抖不上乐观锁（决策 436b6ad5）]
- [ASSUMPTION: TOAPIS/Gemini 凭据 ~/.credentials/toapis.env 已就绪，生产在用]

## 预期受影响文件

- `apps/api/src/services/mashup-slot-assignment.ts`：接入文案动态分段结构
- `apps/api/src/services/mashup-candidate-generation.ts`：候选量提升到 200+、缩略图拼贴 URL
- `apps/api/src/services/video-frame-extract.ts`：抽帧供缩略图拼贴（复用）
- `apps/api/src/services/mashup-render.ts`：选中才渲染 + 并发=1 队列 + 渲染失败态
- `apps/api/src/routes/materials.ts` / `apps/api/src/routes/mashup.ts`：素材 signedUrl 预览、候选浏览接口
- `apps/api/db/migrations/*`：mashup_templates 动态分段结构落库
- `apps/dashboard/src/pages/MashupPage.tsx`：文案粘贴、素材在线预览、候选缩略图虚拟滚动、渲染队列/失败态 UI

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下为 PrepPRD 显式值（主源优先） -->
- 渲染并发: 上限=1，第二请求进排队态显示"第 N 位"（hk-vps 4 核硬约束，决策 d6bedf80）
- 去重阈值: Jaccard=0.8（复用现有 DEDUPE_JACCARD_THRESHOLD）
- 候选目标量: targetCount=200，如实显示去重后实际数量，不承诺死数字（决策 3ed368c3）
- 前端性能: 虚拟滚动，DOM 节点数与可视区域一致，非 200+ 全量渲染
- 降级: AI 服务不可用静默降级固定模板（非阻断，区别于 S4 内容安全的阻断式转人工）
- 可观测: 渲染失败必须落态可重试；signedUrl 过期自动重签
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line/feature 级 API 返回空） -->
- [串行] 单 slot 串行任务，并行只许跨 slot（来源: area）——本 sprint ffmpeg 渲染并发=1 即此律落地
- [租户隔离] 记忆/数据按租户隔离，测试默认多租户（来源: area）
- [环境] 禁止写死环境假设值（来源: area）
- [真验] 真环境验证才算 done（来源: area）
- [安全] 凭据安全、日志脱敏、端点鉴权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/:id/golden-paths API 返回空数组；以下据 PrepPRD 记录的已上线 PR#1878 补记 -->
- 批量混剪 S1-S4（PR#1878，已上线）: S1 打标签抽帧 → S2 槽位分配 → S3 候选生成（J10 去重 Jaccard 0.8/beamWidth）→ S4 ffmpeg 渲染 + 内容安全自查 + 内联视频预览

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud（GitHub Actions windows-latest）填入。

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（windows_cloud → .ps1 / CI job）
# 期望验收点（自然语言）：
#  1. 粘贴测试文案 → API 返回结构化动态分段（角色标签命中 ai_tags 枚举或标"兜底映射"）→ 落成新 mashup_templates 行
#  2. PickStep 素材卡片可点击播放，实际发出 signedUrl 请求并渲染 <video> 元素
#  3. targetCount=200 请求候选生成 → 返回候选数≤200（去重后实际值），每条含缩略图拼贴 URL，前端虚拟滚动 DOM 节点数与可视区一致
#  4. 选定候选触发真实 ffmpeg 渲染，并发实测=1（第二并发请求进排队态）；渲染失败进"渲染失败"态可重试
#  5. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 变更落在 apps/dashboard/MashupPage.tsx 前端交互（粘贴文案/在线预览/候选浏览），面向客户可见流程
## target_environment: windows_cloud
## target_environment_reason: task.payload 显式指定 windows_cloud，且候选阶段不真实渲染、真实 ffmpeg 仅在选中后触发，E2E 可在 GitHub Actions windows-latest 干净 VM 全绿
## journey_id: bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8
## step_id: line05/batch_mashup#step1-4
