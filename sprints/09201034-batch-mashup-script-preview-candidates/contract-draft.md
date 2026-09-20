# Sprint Contract Draft (Round 1)

**Sprint**: 批量混剪加厚 — 文案动态分段 + 素材在线预览 + 候选200+可视化浏览
**journey_type**: user_facing
**target_environment**: local_api
**锚定父路声明**: 覆盖父路 `line05/batch_mashup`（批量混剪）第 1-4 步（Step5 内容安全自查沿用现有 S4，不动）

> **PRD 正文来源**：`inputs.prep_prd_body` + `sprint-prd.md`（一致）。
> **Contract Gate**：`packages/brain/src/lib/contract-gate.js` 不存在（第三方 repo / zenithjoy worktree）→ 跳过代码层 Contract Gate，仅执行 skill 内置规则审查。见 notes：`contract-gate: skipped (file not found, third-party repo)`。

---

## Response Schema（推导来源: PRD字面 + api_registry 为空 → 沿用现有 routes/mashup.ts 惯例）

> `api_registry?type=api` 对 mashup 返回空；字段命名沿用现有 `apps/api/src/routes/mashup.ts` 惯例（camelCase data payload、`{success,data,error,timestamp}` 信封、错误 `{code,message}`）。新字段标 `[NEW_PATTERN]` 但与现有 `runId/slotFill/selectedCandidateId/safetyCheckStatus` 同风格。

### Endpoint 1: `POST /api/mashup/templates/from-script`（Step1 文案动态分段，[NEW]）

鉴权：`X-Upload-Token: <license_key>` header（见「真实调用方请求 shape」段）。

**Success (HTTP 200)**:
```json
{"success": true, "data": {
  "templateId": "<uuid>",
  "segments": [{"slotKey": "seg_1", "matchTags": ["开场","悬念"], "suggestedCount": 2, "fallbackMapped": false}],
  "fallbackUsed": false
}, "error": null, "timestamp": "<iso>"}
```
- `templateId` (string uuid, 必填): 新落库的 `zenithjoy.mashup_templates` 行 id（tenant 归属=凭据租户）— 来源 PRD Golden Path Step1「落成新 mashup_templates 行」
- `segments` (array, 必填): 每段含 `slotKey`(string) / `matchTags`(string[], 映射现有 ai_tags 词表) / `suggestedCount`(number≥1, 每段建议素材数) / `fallbackMapped`(boolean, 该段角色未命中 ai_tags 词表→兜底映射标 true) — 来源 PRD Step1
- `fallbackUsed` (boolean, 必填): AI 服务不可用时静默降级走固定四槽位模板→true；AI 正常解析→false — 来源 PRD 边界情况「Step1 AI 不可用」

**禁用字段名**: `id`（用 `templateId`）、`tenant_id`（凭据反查，绝不回显/入参）、`status`（Step1 非阻断，无 `failed_pending_review` 态）、`segment`（单数，用 `segments`）

**Error (HTTP 4xx)**:
```json
{"success": false, "data": null, "error": {"code": "INVALID_BODY", "message": "script 必填且非空"}, "timestamp": "<iso>"}
```
- 空/缺 `script` → 400 `INVALID_BODY`（不触碰 DB）
- **注意**：AI 服务不可用**不是** error path —— 归 200 + `fallbackUsed:true`（PRD Step1 非阻断死规则，区别于 S4 `failed_pending_review` 阻断态）

### Endpoint 2: `POST /api/mashup/runs/:id/candidates`（Step3 候选生成，已有，加厚）

**Success (HTTP 200)** data 在现有基础上新增字段：
```json
{"success": true, "data": {
  "runId": "<uuid>",
  "generatedCount": 137,
  "candidates": [{"id": "<uuid>", "score": 1.8, "slotFill": {"seg_1": "<matId>"}, "thumbnailUrls": ["<signed-jpg-url>"]}]
}, "error": null, "timestamp": "<iso>"}
```
- `generatedCount` (number, 必填, [NEW]): 去重后实际候选数 == `candidates.length` == DB 落库数（诚实展示，决策 3ed368c3，不承诺死数字 200）
- `candidates[].thumbnailUrls` (string[], 必填, [NEW]): 该候选各已填槽位素材的抽帧缩略图签名 URL 列表（抽帧自 `video-frame-extract.ts`，per-material 缓存于 `materials.thumbnail_key`，前端拼贴呈现）— 来源 PRD Step3
- `targetCount` 入参 ≤ 200 走现有 `HARD_MAX_TARGET_COUNT=300` 夹逼路径（无需放宽上限，PRD 假设）

**禁用字段名**: `count`（用 `generatedCount`，语义明确）、`total`、`thumbnailUrl`（单数；拼贴是多帧，用 `thumbnailUrls` 复数）

### Endpoint 3: `GET /api/mashup/runs/:id/candidates`（已有，加厚）
返回同 Endpoint 2 的 `candidates[]`（含 `thumbnailUrls`），供前端虚拟滚动浏览。租户隔离：别租户 run → 404。

### Endpoint 4: `POST /api/mashup/candidates/:id/render`（Step4 渲染，已有，改异步队列）

**Success (HTTP 200)**:
```json
{"success": true, "data": {
  "jobId": "<uuid>",
  "renderStatus": "queued",
  "queuePosition": 1
}, "error": null, "timestamp": "<iso>"}
```
- `jobId` (string uuid, 必填, [NEW]): 落库 `zenithjoy.mashup_render_jobs` 行 id
- `renderStatus` (string enum, 必填, [NEW]): `queued` | `rendering` | `rendered` | `render_failed`（PRD Step4「渲染失败态」+「排队态」）
- `queuePosition` (number, 必填, [NEW]): 队列位次；渲染槽空闲被立即领取时=0（或 `rendering`），忙时≥1（「第 N 位」）— 来源 PRD NFR「并发上限=1，超出进排队显示第 N 位」

### Endpoint 5: `GET /api/mashup/render-jobs/:id`（Step4 轮询作业状态，[NEW]）

**Success (HTTP 200)**:
```json
{"success": true, "data": {
  "jobId": "<uuid>", "renderStatus": "rendered", "queuePosition": 0,
  "contentId": "<uuid>", "safetyCheckStatus": "passed", "exportUrl": "<signed-url>"
}, "error": null, "timestamp": "<iso>"}
```
- `render_failed` 态：`contentId` 存在、`exportUrl` 缺省，客户可再次 POST render 新建作业（重试非死路，PRD Step4）
- 内容安全 fail-closed 不动（INV-3）：`safetyCheckStatus != passed` → `exportUrl` 恒缺省

---

## 真实调用方请求 shape（规则A — 涉及 Dashboard→API 真实调用方）

生产真实调用方 = `apps/dashboard/src/api/mashup.api.ts`（已核对源码 `authHeaders()`）：

- **认证**：走 header `X-Upload-Token: <license_key>`（**不是** body 传 tenant_id）。license_key 由 Dashboard 先 `GET /account/me` 换出。租户永远从凭据 `validateLicense(token)` 反查（`routes/mashup.ts` `authenticate()`），绝不信客户端自报 tenant_id。
- **Content-Type**: `application/json`
- **body 字段（逐字）**：
  - `POST /templates/from-script` → `{ "script": "<文案文本>" }`
  - `POST /runs/:id/candidates` → `{ "targetCount": 200 }`
  - `POST /candidates/:id/render` → `{}`（candidateId 在 URL path）
- DoD 的 supertest 集成测试构造的请求认证方式/字段名与此逐字段一致（`X-Upload-Token` header + 上述 body key），禁止 body 传 tenant_id 的双路径分叉。

---

## Golden Path

[粘贴文案] → [确认动态分段模板] → [在线预览挑素材] → [生成候选·缩略图墙浏览] → [选中·真实渲染排队] → [看到成片]

### Step 1: 客户粘贴文案 → 生成动态分段模板
**来源**: `[FROM_PRD]` — PRD Golden Path Step1（第 17 行）+ prep_prd_body Step1

**可观测行为**: 客户 POST 一段文案 → 返回结构化 `segments`（角色标签映射现有 ai_tags 词表，对不齐标 `fallbackMapped:true`）+ 每段 `suggestedCount` → 新 `mashup_templates` 行落库（tenant 归属=凭据租户）。AI 不可用时静默降级固定四槽位模板（`fallbackUsed:true`），仍返回 200 + 有效 templateId（非阻断）。

**验证命令**:
```bash
# 通过服务层真跑（与现有 mashup-*-smoke.sh 直调 service 口径一致）；AI 未配置 key → 走 fallback
RESULT=$(env -u TOAPIS_API_KEY node -e "
const { generateTemplateFromScript } = require('./apps/api/dist/services/mashup-script-template.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateTemplateFromScript({ tenantId: process.env.T, script: '开场三秒钩子，然后产品特写，最后引导下单' })
  .then((r) => { console.log('J:' + JSON.stringify(r)); })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^J:' | sed 's/^J://')
echo "$RESULT" | node -e 'const r=JSON.parse(require("fs").readFileSync(0));if(!r.templateId||!Array.isArray(r.segments)||r.segments.length<1||typeof r.fallbackUsed!=="boolean")process.exit(1)'
```
**硬阈值**: 返回含 `templateId`(uuid) + `segments[≥1]`（每段有 `matchTags[]`/`suggestedCount`/`fallbackMapped`）+ `fallbackUsed`(bool)；DB `mashup_templates` 新增 1 行且 `tenant_id`=凭据租户；AI 不可用时 `fallbackUsed=true` 仍 200（不落 `failed_pending_review`）

### Step 2: 素材在线预览挑素材
**来源**: `[FROM_PRD]` — PRD Golden Path Step2（第 18 行）

**可观测行为**: 素材列表接口对每个 video 素材返回可播放的签名 `preview_url`（复用 `materials.ts` `getSignedUrl` 模式），前端渲染 `<video>`。签名失败该条 `preview_url:null` 不阻断整页（现有行为，本 sprint 前端补 `<video>` 播放 + 过期重签重试）。

**验证命令**:
```bash
# 后端契约：seed 的 video 素材 getSignedUrl 能签出非空 URL（preview_url 数据源）
node -e "
const { createMaterialStorage } = require('./apps/api/dist/services/material-storage.js');
const s = createMaterialStorage();
s.getSignedUrl('$STORAGE_KEY').then((u) => { if(!u||typeof u!=='string')process.exit(1); console.log('URL:'+u.slice(0,8)); }).catch((e)=>{console.error(e.message);process.exit(1);});
"
```
**硬阈值**: `getSignedUrl` 返回非空 string（前端据此渲染 `<video src>`）；前端 `<video>` 渲染 + 虚拟滚动由 dashboard jsdom 组件测试锁定（见 B-09），真浏览器 E2E 非 local_api 范围（登记未覆盖清单）

### Step 3: 生成候选（targetCount=200）→ 缩略图墙浏览
**来源**: `[FROM_PRD]` — PRD Golden Path Step3（第 19 行）+ 决策 3ed368c3（诚实展示）

**可观测行为**: 客户请求 targetCount=200 → 复用现有 J10 去重(Jaccard 0.8)+beamWidth 放大池 → 返回候选数 ≤ 200（去重后实际），每条候选带 `thumbnailUrls[]`（抽帧自 `video-frame-extract.ts`，per-material 缓存），`generatedCount` 如实=实际去重后数量。前端虚拟滚动浏览（DOM 节点数与可视区一致，非 200+ 全量）。

**验证命令**:
```bash
RESULT=$(node -e "
const { generateCandidates } = require('./apps/api/dist/services/mashup-candidate-generation.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateCandidates({ tenantId: process.env.T, runId: process.env.RID, targetCount: 200 })
  .then((r) => { console.log('J:' + JSON.stringify(r)); })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^J:' | sed 's/^J://')
echo "$RESULT" | node -e 'const r=JSON.parse(require("fs").readFileSync(0));if(r.candidates.length>200)process.exit(1);if(r.generatedCount!==r.candidates.length)process.exit(1);if(!r.candidates.every(c=>Array.isArray(c.thumbnailUrls)&&c.thumbnailUrls.length>=1))process.exit(1)'
```
**硬阈值**: `candidates.length ≤ 200`；`generatedCount == candidates.length == DB落库数`（psql 交叉核对）；每条候选 `thumbnailUrls[≥1]` 均为非空 string；被使用素材 `materials.thumbnail_key` 已缓存（真抽帧过）

### Step 4: 选中候选 → 真实 ffmpeg 渲染（并发=1 排队 + 失败态）
**来源**: `[FROM_PRD]` — PRD Golden Path Step4（第 20 行）+ NFR 并发上限=1（决策 d6bedf80）

**可观测行为**: 选中候选后 POST render → 此刻才真实 ffmpeg 渲染（此前候选全部未渲染）。渲染并发上限=1：渲染槽空闲→领取并 `rendering`；已有渲染在跑→新请求 `queued` + `queuePosition≥1`（第 N 位）。渲染失败→ `render_failed` 态，客户可再 POST render 重试（非死路）。内容安全 fail-closed 不动（safety!=passed → 无 exportUrl）。

**验证命令**:
```bash
# 两个并发 render 请求 → 一个 rendering/rendered、一个 queued(position≥1)（接缝，evaluator 重复 2 次判 FLAKY）
STATES=$(node -e "
const { enqueueRender } = require('./apps/api/dist/services/mashup-render-queue.js');
const pool = require('./apps/api/dist/db/connection.js').default;
const storage = { getSignedUrl: async () => process.env.MAT_URL, putObject: async () => {}, deleteObject: async () => {}, presignPut: async () => '', headObject: async () => null };
Promise.all([
  enqueueRender({ tenantId: process.env.T, candidateId: process.env.C1 }, { storage }),
  enqueueRender({ tenantId: process.env.T, candidateId: process.env.C2 }, { storage }),
]).then((rs) => { console.log('J:' + JSON.stringify(rs.map(r => ({s:r.renderStatus,p:r.queuePosition})))); })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^J:' | sed 's/^J://')
echo "$STATES" | node -e 'const a=JSON.parse(require("fs").readFileSync(0));const q=a.filter(x=>x.s==="queued"&&x.p>=1);if(q.length<1)process.exit(1)'
```
**硬阈值**: 并发 2 个请求，至少 1 个 `renderStatus:queued` 且 `queuePosition≥1`（并发=1 生效）；真 ffmpeg 输出 1920x1080（`ffprobe` 验，沿用 render-smoke）；渲染失败→ `render_failed` 且可重试

---

## 禁 mock 边清单

本单涉及 DB 写路径 + 状态机 + 跨模块数据传递，以下边**禁 mock**（真 Postgres、真相邻模块）：

- 代码 ↔ DB 表 `zenithjoy.mashup_templates`（Step1 `from-script` 新增模板行写入，测试必须真 PG 验行落库 + tenant_id 归属）
- 代码 ↔ DB 表 `zenithjoy.materials.thumbnail_key`（Step3 per-material 抽帧缓存写回，测试真 PG 验列落库）
- 代码 ↔ DB 表 `zenithjoy.mashup_candidates`（Step3 候选落库 + `thumbnailUrls` 由 slot_fill join materials 派生，测试真 PG）
- 代码 ↔ DB 表 `zenithjoy.mashup_render_jobs`（Step4 渲染作业状态机 queued→rendering→rendered/render_failed 写路径，测试真 PG）
- `mashup-render-queue` ↔ render worker 调度边（并发信号量=1 的派发决策，测试真调度，**不 mock** 队列/worker）
- HTTP router ↔ `validateLicense` ↔ `pool`（`X-Upload-Token` 鉴权边，supertest 真 pool + 真 license 行，锁真实调用方 shape）

**允许 mock 的更外层无关依赖**（不在被改边上）：
- TOAPIS/Gemini 第三方（成本/抖动，按未覆盖清单登记 + E2E 有 key 时真调，无 key 走 fallback 真降级）
- COS 对象存储 `getSignedUrl`/`putObject`（外部对象存储，E2E 用本地 http server 顶替素材下载，与现有 `mashup-render-smoke.sh` 口径一致）

---

## 未覆盖真实链路清单（规则C）

| 真实链路点 | 为什么 mock/降级 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| TOAPIS/Gemini 文案解析真调用 | 标准 sprint 测试与无 key E2E 走 `fallbackUsed:true` 真降级路径（不烧真 key、不引外部抖动），与 `material-tagging-smoke.sh`/`mashup-render-smoke.sh` 只在有 key 专门 job 跑真调用同口径 | E2E 脚本在 `TOAPIS_API_KEY` 存在时执行真调用分支并断言 `fallbackUsed:false` + 真 segments；由 CI has-key job / 生产覆盖 |
| 前端真浏览器虚拟滚动 + `<video>` 播放（真 DOM/媒体解码） | `target_environment=local_api` 无浏览器；虚拟滚动 DOM 节点数、`<video>` src、signedUrl 过期重签由 dashboard jsdom 组件测试（B-09）覆盖 | dashboard vitest 组件测试锁 DOM 节点数<<200 + `<video src>`；真浏览器 E2E 非本 sprint 范围（另立或人形验收） |
| COS 真签名/真下载 | E2E 用本地 http server 顶替素材下载（真 mp4、真 ffmpeg 抽帧/合成），只不打真 COS | 真 COS 由生产/staging 环境覆盖，同现有 mashup smoke 口径 |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | ①文案→动态分段模板 ②素材在线预览 ③候选200+缩略图墙+虚拟滚动 ④选中才真实渲染+并发1排队+失败态 |
| **NFR（做得多好）** | | ffmpeg 渲染并发上限=1（hk-vps 4核）；signedUrl TTL 3600s；候选去重 Jaccard 0.8；前端 DOM 节点数=可视区（非200全量）；targetCount≤200 走现有[50,300]夹逼 |
| **Invariant（永不违反）** | | 见「Invariant 约束」4 条（诚实展示/租户隔离无乐观锁/安全Gate不动/Step1非阻断），映射 INV-1~4 |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | signedUrl 3600s 过期→前端自动重签；embedding/thumbnail 缓存长期有效（素材不变则不重算） |
| **死亡告警（停了谁知道）** | | 渲染 worker 卡死→作业滞留 `queued/rendering`，客户在结果页可见「排队第N位」不推进；ffmpeg 缺失由现有 `runStartupBinaryCheck()` 启动期红日志（0919 事故已加） |
| **失败语义（挂了怎么办）** | | 见失败语义声明表 |
| **效果确认（已发≠已生效）** | | Step1 落库=查 `mashup_templates` 行；Step3 候选=查 `mashup_candidates` 行数；Step4 渲染成功=`mashup_render_jobs.status=rendered` 且 `contents.export_url` 非空（安全通过时） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录API不稳 | 静默丢消息 |
| Step1 AI 是否"不可用"（该降级） | A. 仅超时判; B. 超时/超长/鉴权失效/欠费/5xx/网络错误统一归"不可用" | B（统一归"AI服务不可用"→静默降级固定模板） | PRD 边界情况明确列举；Step1 是输入结构化非内容安全判定，不阻断客户 | 误判为可用→客户拿到空/半截分段；误判为不可用→退固定模板（可接受降级，非阻断） |
| ⚠️ 文案角色标签是否命中 ai_tags 词表 | A. 严格枚举匹配→不中即拒; B. 命中则用，不中标 `fallbackMapped:true` 交客户手调 | B（兜底映射，决策 f33415af 用户拍板复用 S1 ai_tags） | 优先实现速度，个别语义对不齐可后续迭代 | 个别段落标签语义对不齐，客户手调；标 ⚠️ 因误判静默会让分段结构错位影响成片 |
| Step4 渲染槽是否空闲（可立即领取 vs 排队） | A. DB 行锁计数 active 作业; B. 进程内信号量=1 | B（进程内信号量，hk-vps 单 API 进程，4核硬约束决策 d6bedf80） | 单进程单机足够，避免引入分布式锁基础设施 | 误判空闲→并发>1 撑爆 4 核 CPU；误判忙→客户多等（可接受） |
| Step3 候选是否"重复"（去重） | 沿用现有 J10 Jaccard≥0.8 | 沿用（不改） | 决策 3ed368c3 + 现有 DEDUPE_JACCARD_THRESHOLD | 不动，无新增误判面 |

> ⚠️ 行（角色标签命中判定）误判后果=分段结构错位影响成片，属需主理人关注级；PrepPRD 决策 f33415af 已拍板走"兜底映射交客户手调"，故不阻塞。`judgment-pending-user: 无`（已拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Step1 TOAPIS/Gemini 不可用 | 返回 200 + `fallbackUsed:true` + 固定四槽位模板（非阻断） | 是（客户可重粘贴重试） | 静默降级固定模板 |
| Step1 空 script | 400 `INVALID_BODY`，不触碰 DB | 是 | 无（输入校验） |
| Step3 素材抽帧失败（单条） | 该素材 thumbnail 缺省，候选其余 thumbnail 正常（不阻断整批） | 是（下次生成重试抽帧） | 该槽位缩略图占位 |
| Step4 ffmpeg 渲染失败 | 作业落 `render_failed`，`contents` 落 `failed_pending_review`，无 exportUrl | 是（再 POST render 新建作业） | 客户「重新渲染」或「换一条候选」 |
| Step4 内容安全 != passed | fail-closed：`exportUrl` 恒缺省（INV-3 沿用 S4） | 是 | 转人工（现有 S4 逻辑，不改） |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 客户粘贴文案（Step1 script） | 低（客户自填文本，喂给 Gemini 结构化解析） | 文案仅用于结构化分段解析（非执行指令），解析结果只取 segments/matchTags/suggestedCount 结构化字段，忽略自由文本指令；tenant 从凭据反查不受文案影响 | 解析输出越界（非预期结构）→ 归 AI 不可用降级固定模板；不因文案内容执行任何越权 DB/渲染操作 |

---

## 已知约束（来自回归测试 + 累积 FR）

**回归测试约束**（读 `apps/api/src/routes/__tests__/mashup.test.ts` / `services/__tests__/mashup-*.test.ts`）：
- [mashup.test.ts] 无凭据 → 401；缺 templateId → 400 不触碰 DB；模板不存在 → 404（不 500 不泄露内部异常）
- [mashup.test.ts] 别租户 run/candidate → 404（租户隔离，不是"越权可见但拒绝"）
- [mashup.test.ts] 渲染 fail-closed 时 exportUrl 缺省
- [mashup-candidate-generation.test.ts / smoke] S2 `reshoot_skipped`/`unfilled` 槽位在候选里原样透传为空；run 不存在 loud-fail；DB 落库数=返回数
- [mashup-render.test.ts / smoke] 未配 TOAPIS_API_KEY → `failed_pending_review`、`export_url` NULL（fail-closed A1）；真 ffmpeg 输出 1920x1080（A2）；候选不存在 loud-fail；`verifyStartupBinaries()` ffmpeg 缺失判 ok=false

**累积 FR**（`context-manifest` 端点：本 line 返回空，来源 prep_prd_body + PR#1878）：
- 批量混剪 S1-S4（PR#1878）：打标签→槽位分配→候选生成(J10 去重 Jaccard0.8+beamWidth)→ffmpeg 渲染1920x1080+内容安全自查+内联预览。本 sprint **不得回退**：去重阈值不改、fail-closed 不改、1920x1080 不改、租户隔离不改。

**Unified Map 半径**：`map_scope=[batch_mashup]`、`map_repo=null`、`expected_files=null` → `must_run_assertions` 无（radius 未计算，expected_files 空）。标 `[MAP_RADIUS_EMPTY]`，回归约束以上述回归测试 + 累积 FR 为准。

---

## Invariant 约束（铁律 → INV 覆盖，映射 contract-dod.md）

- INV-1 [诚实展示] 候选 `generatedCount` == 去重后 `candidates.length` == DB 落库数，不放宽阈值凑数、不承诺死数字 200（决策 3ed368c3）
- INV-2 [租户隔离] `from-script` 模板 `tenant_id`=凭据租户，别租户不可见；不引入乐观锁（决策 436b6ad5，单租户单人操作）
- INV-3 [安全Gate不动] 渲染沿用现有 S4 content-safety fail-closed：`safetyCheckStatus != passed` → `export_url` NULL（不改内容安全判定）
- INV-4 [Step1非阻断] AI 不可用时 `fallbackUsed:true` 走固定模板，**禁止**落 S4 阻断式 `failed_pending_review`

---

## GP-Anchor

GP-Anchor: line05/batch_mashup#step1-4

> 已用 jq 核实 `line05/batch_mashup` 存在于 `product-map/generated/product-map.json`（返回 1）。本合同 Golden Path 触碰该 GP 的 smoke_files（`apps/api/src/services/mashup-*`、`routes/mashup.ts`、`mashup-*-smoke.sh`）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> **journey_type**: user_facing ｜ **target_environment**: local_api
> **执行者**: 本地 evaluator，ubuntu smoke runner（psql + node + ffmpeg + ffprobe + python3 + Fleet 注入 `$DB_URL`）。
> **口径**：与现有 `mashup-candidate-generation-smoke.sh` / `mashup-render-smoke.sh` 一致——直调 service（真 DB + 真 ffmpeg + 真本地 embedding）+ psql 交叉核对。HTTP 路由 + `X-Upload-Token` 鉴权 shape 由 sprint supertest 集成测试（`tests/mashup-http-contract.integration.test.ts`，真 pool）在 CI Sprint Tests job 锁定；本脚本聚焦深层 DB/ffmpeg/并发接缝。
> **身份 late-binding**：本脚本不写任何 attempt/capability UUID 字面值；如需运行角色身份从 Runner 注入的 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` 读取（本 sprint 无此断言需求）。

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL (第三方 repo 必须显式传 DB_URL)}"
export DATABASE_URL="$DB_URL"

REPO_ROOT="$(pwd)"
fail() { echo "FAIL: $*"; exit 1; }
ok()   { echo "  OK: $*"; }

for bin in psql node ffmpeg ffprobe python3; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令: $bin"
done
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 || fail "数据库连不上: $DB_URL"

echo "== 0. 空库跑真实 migration + schema 断言 =="
( cd apps/api && DATABASE_URL="$DB_URL" npm run migrate ) || fail "migration 失败"
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.mashup_templates') IS NOT NULL" | grep -qx t || fail "mashup_templates 缺失"
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.mashup_candidates') IS NOT NULL" | grep -qx t || fail "mashup_candidates 缺失"
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.mashup_render_jobs') IS NOT NULL" | grep -qx t || fail "mashup_render_jobs 缺失（本 sprint 新增 migration 未生效）"
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='materials' AND column_name='thumbnail_key'" | grep -qx 1 || fail "materials.thumbnail_key 缺失"
ok "migration 生效，新表/列就位"

if [ ! -f apps/api/dist/services/mashup-candidate-generation.js ]; then
  echo "  dist 缺失，现场构建"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi

# ── 前置：真实 tenant + license（真实调用方凭据来源）+ 本地 http 素材源（真 ffmpeg 可下载） ──
SFX="$(date +%s)$RANDOM"
export T="mash-e2e-$SFX"
WORKDIR="$(mktemp -d)"
HTTP_PORT=$((19000 + RANDOM % 2000))
HTTP_PID=""
cleanup() {
  [ -z "$HTTP_PID" ] || kill "$HTTP_PID" 2>/dev/null || true
  psql "$DB_URL" -q -c "DELETE FROM zenithjoy.materials WHERE tenant_id = '$T'" >/dev/null 2>&1 || true
  psql "$DB_URL" -q -c "DELETE FROM zenithjoy.mashup_runs WHERE tenant_id = '$T'" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

ffmpeg -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -y "$WORKDIR/a.mp4" >/dev/null 2>&1 || fail "造测试素材失败"
ffmpeg -f lavfi -i "testsrc2=duration=1:size=640x480:rate=10" -y "$WORKDIR/b.mp4" >/dev/null 2>&1 || fail "造测试素材失败"
( cd "$WORKDIR" && python3 -m http.server "$HTTP_PORT" >/dev/null 2>&1 ) &
HTTP_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$HTTP_PORT/a.mp4" -o /dev/null 2>&1 && break; sleep 0.5; done
export MAT_URL="http://127.0.0.1:$HTTP_PORT/a.mp4"

TENANT_ID=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('$T', 'ZJ-F-$SFX', 'free') RETURNING id" | tr -d '[:space:]')
[ -n "$TENANT_ID" ] || fail "建 tenant 失败"
psql "$DB_URL" -q -c "INSERT INTO zenithjoy.licenses (license_key, tenant_id, status, expires_at) VALUES ('ZJ-F-$SFX', '$TENANT_ID', 'active', NOW() + interval '1 year')" >/dev/null || fail "建 license 失败"
export TOKEN="ZJ-F-$SFX"
export T="$TENANT_ID"

seed_material() {
  psql "$DB_URL" -tAc "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags) VALUES ('$T', '$MAT_URL', 'seed-$1.mp4', 'video/mp4', 1024, 'dk-$1-$SFX', 'tagged', '$2'::jsonb) RETURNING id" | tr -d '[:space:]'
}
MAT_HOOK=$(seed_material "hook" '["开场","悬念"]')
MAT_PROD=$(seed_material "prod" '["产品特写","细节"]')
MAT_CTA=$(seed_material "cta" '["行动号召","结尾"]')
export STORAGE_KEY="$MAT_URL"
ok "tenant/license/素材 就位 tenant=$T"

echo "== 1. Step1 文案→动态分段模板（无 key → 真降级；有 key → 真调用）=="
if [ -n "${TOAPIS_API_KEY:-}" ]; then EXPECT_FALLBACK=false; RUNNER=node; else EXPECT_FALLBACK=true; RUNNER="env -u TOAPIS_API_KEY node"; fi
S1=$($RUNNER -e "
const { generateTemplateFromScript } = require('./apps/api/dist/services/mashup-script-template.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateTemplateFromScript({ tenantId: '$T', script: '开场三秒钩子，接着产品特写展示细节，最后引导下单购买' })
  .then((r) => { console.log('J:' + JSON.stringify(r)); })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^J:' | sed 's/^J://')
[ -n "$S1" ] || fail "Step1 无返回"
echo "  返回: $S1"
node -e "const r=JSON.parse(process.argv[1]);if(!r.templateId)process.exit(1);if(!Array.isArray(r.segments)||r.segments.length<1)process.exit(1);if(!r.segments.every(s=>Array.isArray(s.matchTags)&&typeof s.suggestedCount==='number'&&typeof s.fallbackMapped==='boolean'))process.exit(1);if(typeof r.fallbackUsed!=='boolean')process.exit(1);if(String(r.fallbackUsed)!=='$EXPECT_FALLBACK')process.exit(1)" "$S1" || fail "Step1 schema/fallbackUsed 不符（期望 fallbackUsed=$EXPECT_FALLBACK）"
S1_TID=$(node -e "console.log(JSON.parse(process.argv[1]).templateId)" "$S1")
DB_TENANT=$(psql "$DB_URL" -tAc "SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id='$S1_TID'" | tr -d '[:space:]')
[ "$DB_TENANT" = "$T" ] || fail "Step1 模板 tenant_id 不是凭据租户（INV-2 租户隔离）实际=$DB_TENANT"
# INV-4：降级路径绝不落 failed_pending_review 阻断态
psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents WHERE tenant_id='$T' AND status='failed_pending_review'" | grep -qx 0 || fail "Step1 误落 failed_pending_review 阻断态（违反 INV-4 非阻断）"
ok "Step1 分段模板落库 tenant 隔离正确，非阻断"

echo "== 2. Step2 素材在线预览 URL 可签出 =="
node -e "
const { createMaterialStorage } = require('./apps/api/dist/services/material-storage.js');
createMaterialStorage().getSignedUrl('$STORAGE_KEY').then((u)=>{if(!u||typeof u!=='string')process.exit(1);}).catch((e)=>{console.error(e.message);process.exit(1);});
" || fail "Step2 getSignedUrl 签不出"
ok "Step2 素材 preview_url 可签出（前端 <video> 数据源）"

echo "== 3. Step3 候选生成 targetCount=200 + 缩略图 + 诚实计数 =="
RUN_ID=$(node -e "
const { assignSlots } = require('./apps/api/dist/services/mashup-slot-assignment.js');
const pool = require('./apps/api/dist/db/connection.js').default;
assignSlots({ tenantId: '$T', templateId: '$S1_TID', materialIds: ['$MAT_HOOK','$MAT_PROD','$MAT_CTA'] })
  .then((r)=>{console.log('R:'+r.runId);}).catch((e)=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
" | grep '^R:' | sed 's/^R://')
[ -n "$RUN_ID" ] || fail "assignSlots 未产出 runId"
export RID="$RUN_ID"
S3=$(node -e "
const { generateCandidates } = require('./apps/api/dist/services/mashup-candidate-generation.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateCandidates({ tenantId: '$T', runId: '$RID', targetCount: 200 })
  .then((r)=>{console.log('J:'+JSON.stringify(r));}).catch((e)=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
" | grep '^J:' | sed 's/^J://')
[ -n "$S3" ] || fail "Step3 无返回"
CN=$(node -e "console.log(JSON.parse(process.argv[1]).candidates.length)" "$S3")
GC=$(node -e "console.log(JSON.parse(process.argv[1]).generatedCount)" "$S3")
[ "$CN" -le 200 ] || fail "候选数 $CN > 200"
[ "$GC" = "$CN" ] || fail "generatedCount($GC) != candidates.length($CN)（违反 INV-1 诚实展示）"
DB_CN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_candidates WHERE run_id='$RID'" | tr -d '[:space:]')
[ "$DB_CN" = "$CN" ] || fail "DB 落库数($DB_CN) != 返回数($CN)"
node -e "const r=JSON.parse(process.argv[1]);if(!r.candidates.every(c=>Array.isArray(c.thumbnailUrls)&&c.thumbnailUrls.length>=1&&c.thumbnailUrls.every(u=>typeof u==='string'&&u.length>0)))process.exit(1)" "$S3" || fail "候选 thumbnailUrls 缺失/空"
TK=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.materials WHERE tenant_id='$T' AND thumbnail_key IS NOT NULL" | tr -d '[:space:]')
[ "$TK" -ge 1 ] || fail "被使用素材未缓存 thumbnail_key（真抽帧未发生）"
ok "Step3 候选=$CN(≤200) generatedCount 诚实=DB落库=$DB_CN，缩略图与抽帧缓存就位"

echo "== 4. Step4 真实渲染 + 并发=1 排队 + 失败态可重试（接缝×2）=="
C1=$(psql "$DB_URL" -tAc "SELECT id FROM zenithjoy.mashup_candidates WHERE run_id='$RID' ORDER BY score DESC LIMIT 1" | tr -d '[:space:]')
C2=$(psql "$DB_URL" -tAc "SELECT id FROM zenithjoy.mashup_candidates WHERE run_id='$RID' ORDER BY score DESC OFFSET 1 LIMIT 1" | tr -d '[:space:]')
[ -n "$C1" ] || fail "无候选可渲染"
[ -n "$C2" ] || C2="$C1"
export C1 C2
STATES=$(env -u TOAPIS_API_KEY node -e "
const { enqueueRender } = require('./apps/api/dist/services/mashup-render-queue.js');
const pool = require('./apps/api/dist/db/connection.js').default;
const storage = { getSignedUrl: async () => '$MAT_URL', putObject: async () => {}, deleteObject: async () => {}, presignPut: async () => '', headObject: async () => null };
Promise.all([
  enqueueRender({ tenantId: '$T', candidateId: '$C1' }, { storage }),
  enqueueRender({ tenantId: '$T', candidateId: '$C2' }, { storage }),
]).then((rs)=>{console.log('J:'+JSON.stringify(rs.map(r=>({s:r.renderStatus,p:r.queuePosition,j:r.jobId}))));})
  .catch((e)=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
" | grep '^J:' | sed 's/^J://')
[ -n "$STATES" ] || fail "Step4 并发渲染无返回"
echo "  返回: $STATES"
node -e "const a=JSON.parse(process.argv[1]);const q=a.filter(x=>x.s==='queued'&&x.p>=1);if(q.length<1)process.exit(1)" "$STATES" || fail "并发2请求无一进入 queued(position≥1)——并发=1 排队未生效"
# 未配 TOAPIS_API_KEY：渲染必走 fail-closed，作业终态应为 render_failed，且 contents.export_url NULL（INV-3）
DEADLINE=$((SECONDS+60))
until [ "$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$T' AND status IN ('render_failed','rendered')" | tr -d '[:space:]')" -ge 1 ]; do
  [ $SECONDS -lt $DEADLINE ] || fail "within 60s 渲染作业未到终态"
  sleep 2
done
FAILED_JOBS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$T' AND status='render_failed'" | tr -d '[:space:]')
[ "$FAILED_JOBS" -ge 1 ] || fail "未配 key 应有 render_failed 作业（渲染失败态未落）"
psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents WHERE tenant_id='$T' AND safety_check_status <> 'passed' AND export_url IS NOT NULL" | grep -qx 0 || fail "安全未通过却给了 export_url（违反 INV-3 fail-closed）"
ok "Step4 并发=1 排队生效 + 渲染失败态落库可重试 + fail-closed 不动"

echo "✅ 批量混剪加厚 Golden Path E2E 全部通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /templates/from-script` 传 `script` 为超长文本(>50k 字)/空对象/非字符串数组 → 应 400 或降级，不裸 500
- 错输入: `POST /runs/:id/candidates` 传 `targetCount=999999`/负数/非数字 → 应夹逼到 [50,300] 或 400，不 OOM
- 重复提交: 对同一候选连点两次「渲染」→ 应各自入队或复用作业，不产生两条并发渲染撑爆 CPU（并发仍=1）
- 中途中断: 渲染 `rendering` 中 kill worker/进程重启 → 作业不应永久卡 `rendering`（应可被重新领取或标失败重试）
- 边界值: 候选生成时 0 个 tagged 素材 / 1 个素材 → 候选数=0 时 `generatedCount=0` 诚实返回（不报错、不凑数）
- 越权: 用租户 A 的 token 请求租户 B 的 run/candidate/render-job → 一律 404（租户隔离，INV-2）
发现分级: P0/P1（丢数据/跨租户越权/CPU 撑爆/直接面客错误）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Step4 渲染队列并发=1 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts` | 并发上限1，第二个入队 queued position≥1 | 模块 `mashup-render-queue` 不存在 → import fail |
| Step1 文案分段服务 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-template.test.ts` | AI 不可用降级 fallbackUsed、空 script 拒绝、segments 结构 | 模块 `mashup-script-template` 不存在 → import fail |
| HTTP 路由 + 鉴权 shape + 候选缩略图 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-http-contract.integration.test.ts` | from-script 200 落库、X-Upload-Token 鉴权、候选 thumbnailUrls、别租户 404 | 新端点未注册 → 404 / 无 thumbnailUrls |
| 前端 PickStep 预览 + 候选虚拟滚动（补充） | `apps/dashboard/src/pages/__tests__/MashupPage.thickening.test.tsx` | `<video src>` 渲染、虚拟滚动 DOM 节点数<<候选总数 | 组件未实现 `<video>`/虚拟滚动 → 断言 fail |
