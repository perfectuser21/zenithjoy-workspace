# Sprint PRD — 批量混剪加厚：文案粘贴自动生成动态分段模板 + 素材选择器在线预览 + 候选生成量提升到200+缩略图拼贴虚拟滚动浏览（选定后才真实ffmpeg渲染）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+3%（批量混剪 line05 由 thin → medium 加厚）

## 背景

已批准 GP f6f96e17（line05/批量混剪）加厚 sprint。现状 S1-S4 主链路代码已落地（打标签→槽位分配→候选生成→ffmpeg渲染+内容安全自查+内联预览，PR#1878），但体验为「固定4槽位模板、素材列表纯文字、候选十几条纯文字」。本 sprint 打包三方向升级：文案粘贴自动生成动态分段模板、素材选择器在线预览、候选生成量提升到200+并以缩略图拼贴虚拟滚动浏览，且选定后才真实ffmpeg渲染。方向四（候选内直接剪辑，决策 f076603d）另立 sprint，本次不做。

## Golden Path（核心场景）

客户从 [粘贴文案] → 经过 [在线预览挑素材、缩略图浏览候选] → 到达 [选定候选后真实渲染出成片]

1. 客户粘贴一段文案/脚本 → 系统调 TOAPIS/Gemini（复用 mashup-render.ts 调用模式，不新增合规 Gate）解析出分段结构 + 每段建议素材数量，角色标签映射现有 S1 ai_tags 枚举（未命中标「兜底映射」）→ 客户在同一界面确认/微调 → 生成新 mashup_templates 行
2. 客户在素材选择步骤（PickStep）看到素材卡片可直接在线播放预览（复用 signedUrl 模式）→ 挑选/确认各分段槽位素材
3. 客户点「生成候选」→ 系统复用 J10 去重（Jaccard 阈值 0.8）+ beamWidth 放大池生成候选，以缩略图拼贴卡片（抽帧自 video-frame-extract.ts）可视化呈现，虚拟滚动浏览；候选数如实显示实际生成数量（「共生成 N 条候选」），不承诺死数字 200
4. 客户点开候选、选中一条 → 此刻才真实调用 ffmpeg 渲染（此前所有候选均未真实渲染）；渲染并发上限=1，排队显示「第 N 位」
5.（已有，不动）渲染完成 → 客户结果页看到可在线播放的 1080P 成片，经内容安全自查

## 边界情况

- 文案解析 AI 超时/超长/鉴权失效/欠费/5xx/网络错误 → 统一归「AI服务不可用」，静默降级走固定模板（非阻断，区别于 mashup-render.ts 的 failed_pending_review 阻断转人工）
- signedUrl 过期 → 前端自动重签重试；素材损坏/格式不支持 → 卡片标「预览不可用」，不阻断选择
- 提交/保存 → 按钮禁用 + 去抖防重复点击（不上乐观锁，单租户单人操作，无并发编辑场景）
- 候选去重后不足 200 → 如实显示实际数量，不放宽阈值凑数
- 渲染失败 → 新增「渲染失败」态，客户可「重新渲染」或「换一条候选」，非死路
- 虚拟滚动 → DOM 节点数与可视区域一致，非 200+ 全量渲染

## 范围限定

**在范围内**：文案驱动动态分段模板生成（Step1）、PickStep 素材在线预览（Step2）、候选 200+ 缩略图拼贴虚拟滚动浏览 + 按需渲染（Step3-4）
**不在范围内**：方向四·候选内直接剪辑（另立 sprint，决策 f076603d）；内容安全审核逻辑改动（沿用现有 S4/S5）；声音克隆（沿用现有）

## 假设

- [ASSUMPTION: TOAPIS/Gemini 凭据 ~/.credentials/toapis.env 在执行环境可用（生产已在用）]
- [ASSUMPTION: video-frame-extract.ts 抽帧能力可复用于候选缩略图拼贴，无需新增抽帧实现]
- [ASSUMPTION: 现有 J10 去重常量 DEDUPE_JACCARD_THRESHOLD=0.8 不变]

## 预期受影响文件

- `apps/api/src/services/mashup-slot-assignment.ts`：文案解析出动态分段/槽位结构
- `apps/api/src/services/mashup-candidate-generation.ts`：候选量提升到 200+，产缩略图拼贴 URL
- `apps/api/src/services/video-frame-extract.ts`：为候选卡片抽帧拼贴
- `apps/api/src/services/mashup-render.ts`：渲染并发上限=1 队列、「渲染失败」态
- `apps/api/src/routes/materials.ts`：素材 signedUrl 在线预览接口
- `apps/dashboard/src/pages/MashupPage.tsx`：文案粘贴、PickStep 在线预览、候选缩略图虚拟滚动、按需渲染
- `apps/api/db/migrations/`：动态分段 mashup_templates 落行（沿用 20260919 槽位模板表）

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表 category=nfr 在 step/feature 级均为空 -->
- 超时/失败降级：文案解析 AI 任一失败态统一「AI服务不可用」→ 静默降级固定模板（非阻断）
- 去重阈值：Jaccard=0.8（复用 mashup-candidate-generation.ts DEDUPE_JACCARD_THRESHOLD，本 sprint 不改）
- 候选量：targetCount=200 请求，如实返回去重后实际值（≤200），不承诺死数字（决策 3ed368c3）
- 算力频控：ffmpeg 渲染并发上限=1（hk-vps 4核硬约束，决策 d6bedf80），超出排队「第 N 位」
- 防重复提交：按钮禁用 + 去抖（不上乐观锁，决策 436b6ad5）
- 可观测：渲染失败/AI降级须落 Brain log

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 级为空，取 area 级中与本 sprint 领域相关者；其余 40+ 条 harness/infra 通用铁律不逐条注入 -->
- [dashboard三件套] dashboard 页注册三件套缺一不可：navigation 组件映射 + 菜单项 + InstanceContext features 表（漏一=菜单静默不显示）（来源: area）
- [枚举单源] 枚举语义常量（如 ai_tags/状态枚举）只允许一份，落在被各消费方共同 import 的 service，禁手抄同值副本（来源: area）
- [付费调用去重] 引入外部付费调用（LLM/第三方 API）的重扫路径必须设计「是否已处理过」前置检查，禁重复付费调用（来源: area）
- [null契约显式else] 调用「失败返回 null/false」契约的函数，写完 if(成功分支) 必须显式写 else 处理失败（来源: area）
- [字段长度截断] 写入 DB 前来源数据无天然长度保证（路径/目录/文案）必须显式截断至列约束（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/bb4f2154 golden-paths 注册表返回空数组；S1-S4 代码基线见 PR#1878 但未登记为 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud（GitHub Actions windows-latest）填入。

```bash
# 占位：proposer 按 windows_cloud 填入真实脚本（dashboard build + Playwright + API/service 集成测试）
# 期望验收点（自然语言）：
# 1. 粘贴测试文案 → API 返回结构化分段（角色标签命中 ai_tags 枚举或标「兜底映射」）→ 落成新 mashup_templates 行
# 2. PickStep 素材卡片可点击播放，实际发出 signedUrl 请求并渲染 <video> 元素
# 3. targetCount=200 请求候选，返回去重后实际数（≤200），每条含缩略图拼贴 URL，前端虚拟滚动 DOM 节点数与可视区域一致（非全量）
# 4. 选定候选触发真实 ffmpeg 渲染，并发限制实测=1（第二个并发请求进入排队态）
# 5. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 核心场景经 apps/dashboard MashupPage 面向客户（粘贴文案/在线预览/浏览候选），命中 user_facing。
## target_environment: windows_cloud
## target_environment_reason: task.payload.target_environment 显式=windows_cloud（GitHub Actions windows-latest，权威源），且 zenithjoy apps/dashboard UI 走 windows_cloud 约定。
## journey_id: bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8
## step_id: line05/batch_mashup#step1-4
