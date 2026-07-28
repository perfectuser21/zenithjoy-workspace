# Sprint Contract Draft (Round 1)

Sprint: Staff Hub 业务线健康看板（GP3 / line_health）
TASK_ID: 227824af-8c86-4e80-8a75-d57b371ba4b8

## Response Schema（推导来源: PRD字面 Golden Path 文案 + api_registry 推导为空 + 复用 GP2 已验收 `PathHealthPage.tsx` / `GET /api/staff/path-health` 现有字段命名风格）

> `sprint-prd.md` 未给出字面 `## Response Schema` 段（PrepPRD/Planner 均未产出），故本段字段名按优先级 2（api_registry 相似端点推导）确定：`api_registry` 查询 `type=api` 结果为空（无同名端点历史记录），改为对齐 Step 1.1 读到的 `apps/api/src/routes/staff.ts` 现有 `GET /api/staff/path-health` 端点（`PathHealthItem` 类型 + `PATH_DEFS` 聚合模式），字段命名延续其风格（`path_key`→`line_key`、`journey_id`/`journey_name`/`maturity`/`availability`/`message`/`feature_counts`/`smoke` 字面复用）。新增字段（`connected`/`source`/`fallback_reason`/`environments`/`recent_commit`/`related_prs`/`abilities`）为本 sprint 新增需求，按同一风格新造，标 `[NEW_PATTERN]`。

### Endpoint: `GET /api/staff/line-health`

**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": [
    {
      "line_key": "line01",
      "label": "Line 01 客户首次成功",
      "journey_id": null,
      "journey_name": null,
      "maturity": "not_connected",
      "availability": "not_connected",
      "message": null,
      "feature_counts": { "total": 0, "done": 0, "working": 0, "planned": 0 },
      "smoke": null
    }
  ],
  "source": "product_map",
  "fallback_reason": null
}
```
- `data` (array, 必填): 恒定长度 3（line01/line02/line04），顺序不作为契约（前端按 `line_key` 匹配，不依赖数组下标）
- `data[].line_key` (string, 必填): `"line01" | "line02" | "line04"` — 来源：`product-map.json` `apps[].lines[].id`（`customer_app` 下）
- `data[].label` (string, 必填): 来源：`product-map.json` `apps[].lines[].name`
- `data[].journey_id` (string|null, 必填): 未接入 Brain 的线（line01/line02）恒为 `null`；line04 恒为 `"e675da0f-1117-4301-a801-cd4753beb8c8"`（复用 `path-health` 已修复的整合后"智能客服" journey id，PR #1487） — `[NEW_PATTERN]`（path-health 无此字段，因其 PATH_DEFS 三条线全部已连 Brain，无需暴露；本端点新增"未接入"分支，需要该字段供前端/测试区分）
- `data[].journey_name` (string|null, 必填): 未接入的线为 `null`；line04 为 `"智能客服"`
- `data[].maturity` (string, 必填): `"not_connected" | "thin" | "medium" | "thick" | "mature"` — 复用 `maturityFromCounts()`，新增 `"not_connected"` 枚举值（`[NEW_PATTERN]`，判定点1）
- `data[].availability` (string, 必填): `"ready" | "degraded" | "not_connected"` — 复用 `path-health` 的 `ready|degraded`，新增 `"not_connected"`（判定点1+2）
- `data[].message` (string|null, 必填): `not_connected` 恒为 `null`（不是错误，是设计如此）；`degraded` 时非空且含 `"Brain:"` 前缀（沿用 `path-health` 现有拼接格式）；`ready` 时为 `null`
- `data[].feature_counts` (object, 必填): `{total,done,working,planned}` 全 `number`；`not_connected` 时全为 `0`（判定点1：字段仍在、值为0，前端靠 `availability==="not_connected"` 而非靠这组 0 值判断，禁止靠猜 0/0 反推状态）
- `data[].smoke` (object|null): `not_connected` 恒为 `null`；`ready`/`degraded` 时复用 `path-health` 现有 `GitHubRun` 精简结构（`id,name,status,conclusion,html_url,started_at,updated_at`），无匹配 run 时为 `null`
- `source` (string, 必填): `"product_map" | "fallback"` — `[NEW_PATTERN]`，判定点6
- `fallback_reason` (string|null, 必填): `source=="fallback"` 时非空字符串（如 `"product-map.json 读取或解析失败: <原始错误信息片段>"`）；`source=="product_map"` 时为 `null`

**禁用字段名**（防 generator 漂移到旧 `path-health` 同义词或臆造名）: `path_key`（须用 `line_key`）、`id`（对线本身用 `line_key`，不用裸 `id`）、`status`（顶层线状态字段用 `availability`，不用 `status`，避免与 `features[].status` 混淆）、`health`（避免与 `journey_features.health` 或其它模块同名字段混淆语义）

**Error (HTTP 403)**（staffGuard 拦截，body 与现有 `staffGuard` 中间件一致）:
```json
{ "success": false, "data": null, "error": { "code": "FORBIDDEN", "message": "需要员工账号权限" } }
```

---

### Endpoint: `GET /api/staff/line-health/:lineKey/deployment`

**Success (HTTP 200, `connected` 线，如 line04)**:
```json
{
  "success": true,
  "data": {
    "line_key": "line04",
    "connected": true,
    "message": null,
    "environments": [
      { "name": "dev", "status": "active", "commit_sha": "abc123...", "commit_date": "2026-07-28T00:00:00Z" },
      { "name": "staging", "status": "not_deployed", "commit_sha": null, "commit_date": null },
      { "name": "production", "status": "active", "commit_sha": "def456...", "commit_date": "2026-07-28T00:00:00Z" }
    ],
    "recent_commit": { "sha": "def456...", "message": "fix: xxx", "date": "2026-07-28T00:00:00Z", "url": "https://github.com/.../commit/def456..." },
    "related_prs": [
      { "number": 1487, "title": "fix(staff): Path4「智能客服」查询改指向整合后的 journey", "url": "https://github.com/.../pull/1487", "state": "closed", "updated_at": "2026-07-28T00:00:00Z" }
    ]
  }
}
```
- `data.line_key` (string, 必填)
- `data.connected` (boolean, 必填): line01/line02 恒 `false`；line04 恒 `true`
- `data.message` (string|null, 必填): `connected==false` 时字面等于 `"该业务线尚未接入 Brain 数据，暂无法展示"`（PRD 判定点2 原文字面复制，前端直接渲染，不重新措辞）；`connected==true` 时为 `null`
- `data.environments` (array, 必填): `connected==false` 时为 `[]`；`connected==true` 时恒长度 3，`name` ∈ `{"dev","staging","production"}`
- `data.environments[].status` (string, 必填): `"active" | "stale" | "not_deployed" | "unavailable"` — `[AI_ADDED]`（Reviewer r1 必须修复项1，见下方判定点登记表 ⚠️ 行订正说明）：`active`=对应分支存在，且按路径过滤找到匹配提交，且该提交 `commit_date` 距今 ≤ `STALE_THRESHOLD_DAYS`（固定常量 30 天，thin 阶段硬编码，不做环境变量化，登记为可调技术债）；`stale`=同上但 `commit_date` 距今 > 30 天（分支/环境本身存在、有真实提交，但明显不是"最近部署过"，防止陈旧分支被误显示成活跃）；`not_deployed`=对应分支不存在（`dev`→`develop` 分支 404），或分支存在但按路径过滤查无任何匹配提交；`unavailable`=GitHub 查询本身失败（网络/限流）。四态互斥，不得合并成统一"暂不可达"（沿用 NFR"可观测"条款的区分原则）
- `data.environments[].commit_sha`/`commit_date` (string|null): `active` 或 `stale`（两者都已找到匹配提交，只是新旧不同）时非 null；`not_deployed`/`unavailable` 时为 null
- `data.recent_commit` (object|null, 必填): 直接复用 `environments` 中 `name=="production"` 一项的 commit 数据（避免重复调用 GitHub），`environments` 未含 production 或该项无提交时为 `null`
- `data.recent_commit.sha/message/date/url` (string): `sha` 为 40 位十六进制 git commit sha
- `data.related_prs` (array, 必填): 恒为数组（即使 0 条也是 `[]`，不是 `null`），按 PR 标题关键词匹配（判定点4）；每项 `{number,title,url,state,updated_at}`

**禁用字段名**: `deploy_version`/`version`（NFR 明确排除"真实运行版本"概念，UI 文案用"最近相关提交"不用"当前部署版本"，字段名同样不得叫 `version`，须用 `recent_commit`）

**Error (HTTP 404，未知 lineKey)**:
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "unknown line_key" } }
```

---

### Endpoint: `GET /api/staff/line-health/:lineKey/abilities`

**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "line_key": "line04",
    "connected": true,
    "message": null,
    "abilities": [
      { "id": "gpb", "name": "GP-B 被动接待", "status": "planned", "thickness": "thin", "kind": "ability", "updated_at": "2026-07-28T00:00:00Z" }
    ]
  }
}
```
- `data.connected`/`message` 语义同 `deployment` 端点
- `data.abilities` (array, 必填): `connected==false` 恒为 `[]`；`connected==true` 时为 `fetchJourneyFeatures(journeyId)` 全量结果映射（字段与 `path-health` 现有 `features[]` 映射完全一致：`id,name,status,thickness,kind,updated_at`），Brain 查询失败时也返回 `[]` 但 `message` 非空（`"Brain: <错误信息>"`，与 `path-health` 现有降级消息拼接格式一致）

**禁用字段名**: `features`（`path-health` 用 `features`，本端点主题是"能力清单"，PRD 字面用词"golden path/ability 清单"，用 `abilities` 以示区分总览卡片的 `feature_counts` 计数概念 vs 详情页的清单概念，避免前端混淆两个不同粒度的同名字段）

**Error (HTTP 404，未知 lineKey)**: 同 deployment 端点

---

## 已知约束（来自回归测试 + 累积FR）

- `apps/api/src/routes/__tests__/staff.test.ts` → `[BEHAVIOR] GET /api/staff/path-health 返回 Path1/2/4 三项，含 features 与 smoke`（本 sprint 新端点复用同一文件/同一聚合风格，需保证不破坏此测试）
- `apps/api/src/routes/__tests__/staff.test.ts` → `[BEHAVIOR] path4 查询的 journey_id 必须是整合后的"智能客服" journey，不能是已废弃孤儿 journey`（本 sprint line04 的 journeyId 必须字面等于同一个 `e675da0f-1117-4301-a801-cd4753beb8c8`，不得回退到孤儿 journey，PR #1487 教训直接复用）
- `apps/api/src/routes/__tests__/staff.test.ts` → `[BEHAVIOR] 上游部分失败时仍返回 200，并把 path 标记为 degraded`（本 sprint 三个新端点同样必须在上游失败时返回 200+degraded，不得 500）
- `apps/api/src/middleware/staff.test.ts` → staffGuard 鉴权规则：`X-User-Email` 或 `X-Feishu-User-Id` 命中白名单任一放行，都未命中一律 403（本 sprint 三个新端点必须挂 `staffGuard`，不得遗漏）
- `[累积FR]` `context-manifest`: unavailable（`GET /api/brain/line/636a918c-8b23-4df5-baec-b1eb3308fffb/context-manifest` 请求无响应体返回，端点当前不可达或未部署该路由；已尝试 `curl`，返回空。已改查 `journey_features` 端点确认该 journey 下现存 feature `5e92525a-19a8-4ef6-b7a4-c7cf8aa9cd10`（业务线健康看板，thickness=thin, status=planned），与 sprint-prd.md 头部声明一致）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 员工在 Staff Hub 一页看清 3 条对外业务线（line01/02/04）健康状态（总览卡片）、部署环境状态+最近相关提交+关联PR（详情页部署tab）、内部能力完成度清单（详情页能力tab） |
| **NFR（做得多好）** | 非功能需求 | 单条线 Brain 查询超时/5xx 独立降级不阻塞其余线；GitHub 数据缓存5分钟，Brain 数据不缓存或缓存1分钟（60次/小时限额防打满） |
| **Invariant（永不违反）** | 不变量 | 每个 API 端点必须挂 `staffGuard` 鉴权；Brain 404(无数据)与5xx/timeout(故障)必须区分展示，不得合并判断；`related_prs`/`abilities` 恒为数组类型（never null，前端 `.map()` 不用做 null 检查） |
| **判定点（怎么知道）** | 见下方登记表 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | `product-map.json` 是权威业务线清单来源，若未来新增/废弃业务线（如 line01/02 之一被砍或新增 line03），本 sprint 硬编码的 `LINE_DEFS`（journeyId/relatedPaths/prTitleKeywords 映射）需要人工同步更新，未做自动漂移检测（技术债，登记但本 sprint 不做） |
| **死亡告警（停了谁知道）** | 谁会发现停摆 | 无专门告警机制（本页面是员工主动打开查看的只读监控页，不是自动化流程，若数据源全部不可达，页面本身会显示全部 `degraded`/banner，员工肉眼可见即为告警） |
| **失败语义（挂了怎么办）** | 见下方声明 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 无对外写动作 | N/A — 本 sprint 全部端点为只读聚合展示，无对外写入/发布类动作，无需效果确认机制 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| line01/02 无 Brain 数据时 UI 状态 | 0/0 显示 / 专门"未接入"态 / 隐藏卡片 | 专门"未接入"态（`availability=="not_connected"`, `maturity=="not_connected"`, `journey_id==null`） | 用户拍板（PrepPRD）：不能报错不能空白，要让员工知道这条线数据没接通 | 0/0 会让员工误读为"完成度0%"；本合同要求 `maturity` 字面区分而非靠计数字段隐含推断 |
| Brain 不可达原因判断 | 统一"暂不可达" / 区分404(无数据)与5xx/timeout(故障) | 区分：line01/02 静态标 `not_connected`（LINE_DEFS 里 `journeyId=null`，压根不发 Brain 请求）；line04 若 Brain 请求失败才标 `degraded` | 两者语义完全不同：前者是"未来要接"，后者是"现在坏了" | 合并会让员工无法判断该不该报障 |
| "版本"定义 | 全局HEAD / 按线相关路径过滤最近commit / 各环境/version端点 | 按路径过滤最近commit（GitHub commits API `path=` 参数），UI标注"最近相关提交" | 用户拍板；`/version` 端点在范围限定里明确排除 | 用全局HEAD会让三条线数值相同，字段无意义 |
| "关联PR"筛选规则 | 按PR文件路径匹配 / 标题关键词匹配 | 标题关键词匹配（GitHub Search Issues API `in:title`），接受稀疏结果 | 用户拍板：product-map当前无owned_paths字段，不做重复维护的本地路径映射 | 漏检率高但成本可控，UI已如实标注"暂无标题匹配的近期 PR" |
| 降级粒度 | 整页失败 / 整卡失败 / 按字段独立 | 按字段独立：`environments`（3个环境各自独立try/catch）/ `related_prs` / `abilities`(Brain) 三条链路互相隔离 | 复用 `path-health` 现有 per-line 独立降级模式，防止一处限流拖垮全页 | 粒度太粗会让一次限流拖垮整个面板 |
| GitHub数据缓存 | 不缓存 / 按资源类型分TTL | 按资源类型分TTL：GitHub数据5分钟，Brain数据不缓存或1分钟 | GitHub REST API未认证60次/小时限额，多员工同开会打满 | 不缓存可能导致全公司看不到数据（本 sprint thin 阶段：缓存实现方式不作为本合同强制机检点，登记为已知设计约束，generator 可用进程内内存缓存实现，验收标准是"不超过限额"而非特定缓存库） |
| 查看权限 | 分角色 / 沿用现有白名单 | 沿用现有 staffGuard 白名单，不分角色 | 只读监控页，分角色是本次范围外的额外基建投入 | N/A（低风险，后续可加厚） |
| **⚠️ 环境状态数据源**（本合同新增，PrepPRD 判定点表未覆盖） | 各环境真实 `/version` 端点探活 / GitHub Actions Deployments API / 分支存在性+按路径过滤最近commit+陈旧阈值判定 | 分支存在性+按路径过滤最近commit+陈旧阈值判定（`dev`→`develop`分支，`staging`→匹配 `release/*` 前缀的分支，`production`→`main`分支；用 GitHub commits API `?sha=<branch>&path=<related_path>` 单次调用即同时判断"分支是否存在"（404=不存在）与"该分支该路径最近提交"；再用固定阈值 `STALE_THRESHOLD_DAYS=30` 天区分 `active`（≤30天）与 `stale`（>30天），不额外调用 GH Deployments API） | 范围限定明确排除"真实运行版本 `/version` 端点"；仓库当前未使用 GitHub Environments/Deployments 功能（无历史 Deployment 记录可查）。**订正（Reviewer r1）**：r1 版本 rationale 曾声称"未见 develop/release 分支使用痕迹"，经 Reviewer 用 `git log` 核实系事实错误——`origin/develop`（末次提交2026-03-07，落后 main 1266 commit）与 `origin/release/cs-stable`（末次提交2026-06-23，落后 main 554 commit）**均真实存在**，只是均已严重陈旧。本轮已订正表述并补陈旧阈值判定，防止这两条陈旧分支被误显示为 `active` | 不加阈值时 dev/staging 会显示 `active` 且带数月前的陈旧 `commit_date`，比"没有环境"更具误导性（员工误读为"刚部署过"），此为 r1 已实证的真实风险，非假设；加阈值后风险收敛为"30天阈值本身是否合理"（proposer 保守估计值，可调，非精确业务规则），不再是 r1 版本"完全无区分"的技术债 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain journey_features 查询超时/5xx（仅 line04，line01/02 从不发起该请求） | 该线 `availability="degraded"`，`message` 含 `"Brain:"` 前缀，HTTP 仍 200，不阻塞其余线 | 否（前端手动点刷新按钮重试，无自动重试） | 该卡片单独降级 |
| GitHub commits/search API 查询失败/限流 | 对应字段（`environments[].status="unavailable"` 或 `related_prs=[]`）独立降级，不影响 `abilities`/其余环境 | 否 | 按字段独立降级 |
| `product-map.json` 读取/解析失败 | `source="fallback"`，`data` 用代码内置3条线兜底清单填充，HTTP 仍 200 | 否（重启进程或修复文件后自然恢复） | 全页兜底 + 前端顶部banner |
| 未知 `lineKey`（不在 LINE_DEFS 中） | HTTP 404，`{success:false,error:{code:"NOT_FOUND"}}` | N/A | 无降级，明确拒绝 |
| 无认证头 / 白名单外邮箱 | HTTP 403（staffGuard 统一行为） | N/A | 无降级 |

### 输入对抗面

（本任务是员工内部只读监控页，无外部用户可写入的输入面，`:lineKey` 路径参数仅有3个合法值+404兜底，无 prompt injection / 越权指令场景，N/A）

## 真实调用方请求 shape

N/A — 本 sprint 三个端点的调用方是 Staff Hub 前端 SPA（员工浏览器），通过现有 `adminFetch()` 携带 `X-User-Email` / `X-Feishu-User-Id` header（与已验收的 `path-health` 端点完全相同的调用方式，非 Android/Windows agent 或外部 webhook），不适用"真实调用方请求 shape"规则（该规则针对设备/agent 类真实调用方）。

## 第三方真调一次

本 sprint 依赖两个外部/内部第三方服务：

1. **GitHub REST API**（`api.github.com`）— DoD 至少一条 `[BEHAVIOR]` 真实调用（公共只读端点，不需要 `GH_TOKEN` 也能用，60次/小时限额对单次 CI 调用足够）。见 Golden Path Step 10。
2. **Brain journey_features API**（`localhost:5221` 或 `CECELIA_BRAIN_URL`，内部服务）— 本机/PR CI（ubuntu-latest job）环境下真实可达（已验证：本 proposer 编写合同时实测 `curl localhost:5221/api/brain/journey_features?journey_id=636a918c-...` 返回真实数据），vitest 单元测试层面 mock（见下方"未覆盖真实链路清单"第1条），但 evaluator 模式A（ubuntu 真实环境）执行时会打真实本地/CI Brain。windows_cloud final-e2e（GHA windows-latest）沙盒默认不可达，见"未覆盖真实链路清单"第2条。

## 未覆盖真实链路清单

1. **vitest 单元测试对 Brain(`axios.get` journey_features) 与 GitHub(`axios.get` REST API) 两个真实依赖打桩** — 原因：延续现有 `apps/api/src/routes/__tests__/staff.test.ts` 中 `path-health` 端点已确立的测试模式（同一文件顶部已有 `vi.mock('axios', ...)`），用于快速验证聚合/降级逻辑本身的正确性，不依赖网络稳定性。真验证补位：Golden Path Step 1/5/7/10 的 DoD `[BEHAVIOR]` 命令直接 `curl` 真实运行中的 `apps/api`（该进程内部真实调用 Brain 与 GitHub，未被 mock），且 Step 10 额外直接验证 GitHub 公共 API 本身可达。
2. **windows_cloud final-e2e（GHA windows-latest）中 `CECELIA_BRAIN_URL` 默认未配置真实可达地址** — 原因：Brain 是内网服务（`host.docker.internal:5221`），GHA windows-latest 沙盒无法直连；且 harness-generator 对共享 `.github/workflows/e2e-windows.yml` 默认禁区，不可自行新增 `BRAIN_URL` secret 注入。真验证补位计划：final-e2e 场景下 line04 会自然走 `degraded`（Brain 不可达）分支而非"真实 done/total 计数"分支，E2E 断言据此设计为"line04 卡片正确渲染 degraded 徽章 + 详情页 abilities tab 正确显示『数据暂不可达』"（而非断言具体 GP-A~F 六条真实数据，那部分留给 evaluator 模式A 在 ubuntu-latest job 中用本机可达的真实 Brain 验证，见 Golden Path Step 7）。此项 `logic-done-pending`：Brain 集成的真机/生产环境验证需要在 staging 环境或本机联通 Brain 的开发环境人工验收，不阻塞本 sprint thin 交付。
3. **陈旧阈值判定（Step 11）与 GitHub 数据缓存 TTL（Step 12）两个 NFR 的内部逻辑** — 原因：① 陈旧阈值边界（30天）本身不便靠"等真实分支自然变陈旧"来验证，需要 vitest 用 `githubMockOverride` 局部覆盖单条 GitHub 请求返回一个虚拟旧日期后复位，仅这一条测试局部打桩，不影响文件内其余测试仍走真实网络；② 缓存 TTL 无法靠简单 curl 观测"是否真的省了一次网络调用"，只能在 axios 调用边界用 `githubRealGetSpy` 计数——两次连续请求真实网络调用次数不增加即视为缓存命中，不等待真实 5 分钟。真验证补位：Step 11 的 DoD `[BEHAVIOR]` 命令另外直接用当前仓库真实 `develop`/`release/cs-stable`（均已陈旧超30天）验证"不误判为 active"这一具体事实，是对陈旧阈值逻辑的真实世界补充验证，不依赖 mock。

## 禁 mock 边清单

（本单为只读展示层聚合功能：无调度器/dispatcher、无状态机/终态判定、无生命周期钩子(startup/recovery/shutdown)、无 DB 写路径（三个端点全部只读，不 INSERT/UPDATE 任何表）。Brain 与 GitHub 均为通过 HTTP 调用的外部/第三方服务而非本仓库内部模块间的边（不是"模块A↔模块B"或"代码↔DB表"的接缝），故本单无需声明禁 mock 边，N/A。第三方 API 的 mock 豁免已在上方"未覆盖真实链路清单"单独登记。）

## Golden Path

[员工点开"业务线健康"] → [总览 GET /api/staff/line-health 展示3卡片] → [点击卡片进详情页/部署tab GET .../deployment] → [切换能力tab GET .../abilities] → [点返回复用总览数据]

### Step 1: 总览页加载，展示 3 张业务线卡片
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第1步 / prep-prd.md Golden Path 第1步
**可观测行为**: 员工打开 `/line-health`，`GET /api/staff/line-health` 返回 line01/line02/line04 三条数据；line01/line02 因未接入 Brain 显示专门"未接入"态（非 0/0、非报错）
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '.data | length == 3' || { echo "FAIL: 应返回 3 条业务线"; exit 1; }
echo "$RESP" | jq -e '[.data[].line_key] | sort == ["line01","line02","line04"]' || { echo "FAIL: line_key 集合不对"; exit 1; }
echo "$RESP" | jq -e '.data[] | select(.line_key=="line01") | .availability == "not_connected"' || { echo "FAIL: line01 应为 not_connected"; exit 1; }
echo OK
```
**硬阈值**: HTTP 200；`data.length==3`；line01/line02 `availability=="not_connected"`

---

### Step 2: line01/02 判定点——字面区分"未接入"与"0进度"，不靠 0/0 反推
**来源**: `[AI_ADDED]` — PrepPRD 判定点登记表已拍板"line01/02 无 Brain 数据时 UI 状态=专门『未接入』态"，本步骤把拍板转成机检断言：防止 generator 只把 `feature_counts` 置0就当作实现了"未接入"，那样前端无法区分"真实0进度"与"未接入"两种语义不同的状态
**可观测行为**: `maturity` 字段字面等于 `"not_connected"`（不是复用 `"thin"`），`journey_id` 字面为 `null`
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '.data[] | select(.line_key=="line02") | .maturity == "not_connected"' || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.data[] | select(.line_key=="line02") | .journey_id == null' || { echo "FAIL: line02 不应有 journey_id"; exit 1; }
echo "$RESP" | jq -e '.data[] | select(.line_key=="line02") | .message == null' || { echo "FAIL: not_connected 的 message 应为 null（不是错误）"; exit 1; }
echo OK
```
**硬阈值**: `maturity=="not_connected"`；`journey_id==null`；`message==null`

---

### Step 3: line04 单条线 Brain 查询 5xx/timeout 降级，不拖垮其余线
**来源**: `[FROM_PRD]` — sprint-prd.md 边界情况"单条线 Brain 查询 5xx/timeout：该卡片单独标『数据暂不可达』，其余线正常展示"
**可观测行为**: 当 Brain journey_features 请求失败，line04 卡片 `availability=="degraded"`，`message` 含 `"Brain:"` 前缀；line01/02（本就 not_connected，未发起 Brain 请求）不受影响，HTTP 仍 200
**验证命令**: （网络故障场景不便用真实 curl 稳定复现，由 `tests/line-health.test.ts` 覆盖：mock Brain 请求 reject，断言 line04 degraded 且 line01/02 仍 not_connected）

---

### Step 4: product-map.json 缺失/解析错误 → 全页兜底 + banner 标记
**来源**: `[FROM_PRD]` — sprint-prd.md 边界情况第三条
**可观测行为**: `source=="fallback"`，`fallback_reason` 非空字符串，`data` 仍含 3 条内置兜底线（不是空数组/500）
**验证命令**: （文件系统故障场景由 `tests/line-health.test.ts` 覆盖：临时把 `product-map.json` 指向路径改到不存在的文件，断言 fallback 行为；见测试文件 `PRODUCT_MAP_PATH` 环境变量覆盖机制）

---

### Step 5: 点击卡片进入详情页，部署 tab
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第2步
**可观测行为**: `GET /api/staff/line-health/line04/deployment` 返回三环境状态 + `recent_commit`（若有匹配提交则 sha 为合法40位hex）+ `related_prs` 恒为数组
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '.data.environments | length == 3' || { echo "FAIL: 应有 3 个环境"; exit 1; }
echo "$RESP" | jq -e '[.data.environments[].name] | sort == ["dev","production","staging"]' || { echo "FAIL: 环境名不对"; exit 1; }
echo "$RESP" | jq -e '.data.recent_commit == null or (.data.recent_commit.sha | type == "string")' || { echo "FAIL: recent_commit.sha 类型不对"; exit 1; }
echo "$RESP" | jq -e '.data.related_prs | type == "array"' || { echo "FAIL: related_prs 应始终是数组"; exit 1; }
echo OK
```
**硬阈值**: `environments.length==3`；`related_prs` 始终是数组（即使为空数组）

---

### Step 6: 详情页对 not_connected 线（line01/line02）两个 tab 均显示空态
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第2步边界"点击『未接入』状态的线：详情页仍可进入，两个 tab 均显示『该业务线尚未接入 Brain 数据，暂无法展示』空态"
**可观测行为**: `GET .../line01/deployment` 与 `GET .../line01/abilities` 均返回 200（不是 404/500），`connected==false`，`message` 字面含约定文案
**验证命令**:
```bash
RESP1=$(curl -sf localhost:3000/api/staff/line-health/line01/deployment -H "X-User-Email: staff@test.com")
echo "$RESP1" | jq -e '.data.connected == false' || { echo "FAIL"; exit 1; }
echo "$RESP1" | jq -e '.data.message == "该业务线尚未接入 Brain 数据，暂无法展示"' || { echo "FAIL: message 文案不对"; exit 1; }
echo "$RESP1" | jq -e '.data.environments == []' || { echo "FAIL: not_connected 环境应为空数组"; exit 1; }
RESP2=$(curl -sf localhost:3000/api/staff/line-health/line01/abilities -H "X-User-Email: staff@test.com")
echo "$RESP2" | jq -e '.data.connected == false and (.data.abilities | length == 0)' || { echo "FAIL"; exit 1; }
echo OK
```
**硬阈值**: HTTP 200（非404/500）；`connected==false`；`message` 字面等于约定文案；`environments==[]`/`abilities==[]`

---

### Step 7: 能力 tab（line04 真实 Brain 数据）
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第3步
**可观测行为**: `GET .../line04/abilities` 返回该线 journey_features 全量清单（thickness+status 字段齐全），字段结构与已验收的 `path-health` 现有 `features` 映射一致
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/abilities -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '.data.abilities | type == "array"' || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e 'all(.data.abilities[]; has("thickness") and has("status") and has("id") and has("name"))' || { echo "FAIL: ability 缺字段"; exit 1; }
echo OK
```
**硬阈值**: `abilities` 数组每项含 `id/name/status/thickness` 字段（数组本身可能为空——取决于当前 Brain 实际数据，字段结构齐全是硬阈值，条数不是）

---

### Step 8: 未知 lineKey 返回 404（不静默返回空数据）
**来源**: `[AI_ADDED]` — error path 覆盖，防止 generator 对非法 `lineKey` 静默返回 200 空数据（会被前端误判为"某条线数据为空"而非"参数错误"），符合 Step 2b BEHAVIOR 数量硬阈值第4类场景（error path）
**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/bogus-line/deployment -H "X-User-Email: staff@test.com")
[ "$CODE" = "404" ] || { echo "FAIL: 未知 lineKey 应返回 404，实际 $CODE"; exit 1; }
CODE2=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/bogus-line/abilities -H "X-User-Email: staff@test.com")
[ "$CODE2" = "404" ] || { echo "FAIL: 未知 lineKey (abilities) 应返回 404，实际 $CODE2"; exit 1; }
echo OK
```
**硬阈值**: HTTP 404（deployment 与 abilities 两个端点均需覆盖）

---

### Step 9: staffGuard 鉴权（三个新端点均须挂载）
**来源**: `[FROM_PRD]` — PrepPRD 前置工作"staffGuard 权限中间件 — 已就绪，本次直接复用"；沿用 `path-health` 现有鉴权测试模式
**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health)
[ "$CODE" = "403" ] || { echo "FAIL: /line-health 无认证头应 403，实际 $CODE"; exit 1; }
CODE2=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/line04/deployment)
[ "$CODE2" = "403" ] || { echo "FAIL: /deployment 无认证头应 403，实际 $CODE2"; exit 1; }
CODE3=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/line04/abilities)
[ "$CODE3" = "403" ] || { echo "FAIL: /abilities 无认证头应 403，实际 $CODE3"; exit 1; }
echo OK
```
**硬阈值**: 三个端点无 `X-User-Email`/`X-Feishu-User-Id` 头均返回 403

---

### Step 10（Rule B 第三方真调一次）: GitHub REST API 真实调用验证 commit 数据非硬编码
**来源**: `[AI_ADDED]` — 真实链路四硬规则「Rule B 第三方真调一次」，防止 generator 用固定假 sha/假 PR 顶替真实 GitHub 查询
**验证命令**:
```bash
# 1. 直接调用 GitHub 公共只读 API，确认目标仓库确实存在 main 分支与真实提交（不依赖 GH_TOKEN）
RESP=$(curl -sf "https://api.github.com/repos/perfectuser21/zenithjoy-workspace/commits?sha=main&per_page=1")
echo "$RESP" | jq -e '.[0].sha | type == "string" and (length == 40)' || { echo "FAIL: GitHub 真实 commits API 未返回合法 sha"; exit 1; }
# 2. 验证 /deployment 端点返回的 production commit_sha 是真实40位hex格式（不是占位符/写死值）
RESP2=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com")
echo "$RESP2" | jq -e '(.data.environments[] | select(.name=="production") | .commit_sha) as $s | ($s == null) or ($s | test("^[0-9a-f]{40}$"))' || { echo "FAIL: production commit_sha 格式不对"; exit 1; }
echo OK
```
**硬阈值**: GitHub 真实 commits API 返回合法 40 位 hex sha；我方 `production.commit_sha` 若非 null 必须匹配同一格式（间接证明确实打了真实 GitHub API，而非硬编码假值）

---

### Step 11（Reviewer r1 必须修复项1）: dev/staging 陈旧分支不得显示为 active
**来源**: `[AI_ADDED]` — Reviewer r1 用 `git log` 核实 `develop`（末次提交2026-03-07）/`release/cs-stable`（末次提交2026-06-23）分支真实存在但均严重陈旧，若不加阈值判定会被误显示为"活跃"，详见上方判定点登记表 ⚠️ 行订正说明
**可观测行为**: 当环境分支存在且按路径过滤找到匹配提交，但 `commit_date` 距今超过 30 天时，`environments[].status` 必须为 `"stale"` 而非 `"active"`；`commit_sha`/`commit_date` 仍非 null（陈旧不等于查不到）。当前仓库真实状态下，dev（对应 `develop`）与 staging（对应 `release/cs-stable`）两个环境天然满足"超过30天"条件，可直接用真实 curl 验证
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '(.data.environments[] | select(.name=="dev") | .status) != "active"' || { echo "FAIL: dev(develop分支，2026-03-07最后提交)不应显示active"; exit 1; }
echo "$RESP" | jq -e '(.data.environments[] | select(.name=="staging") | .status) != "active"' || { echo "FAIL: staging(release/cs-stable分支，2026-06-23最后提交)不应显示active"; exit 1; }
echo OK
```
**硬阈值**: `dev`/`staging` 两个环境的 `status` 均不得为 `"active"`（真实仓库当前状态下应为 `"stale"` 或 `"not_deployed"`）。陈旧阈值判定逻辑本身（区分 `active`/`stale` 边界）额外由 `tests/line-health.test.ts` 用可控 mock（固定虚拟 commit_date）覆盖，见 Test Contract

---

### Step 12（Reviewer r1 必须修复项2，PrepPRD 判定点6）: GitHub 数据缓存 5 分钟，短时间重复请求不二次真调
**来源**: `[FROM_PRD]` — sprint-prd.md NFR"GitHub数据缓存5分钟"；`[AI_ADDED]` 补充：Reviewer r1 指出该 NFR 此前零机检覆盖
**可观测行为**: 短时间内两次请求同一 `line04/deployment`，底层真实 GitHub 抓取调用次数不随第二次请求增加（缓存命中）
**验证命令**: （缓存 TTL 无法通过简单 curl 观测"是否真的走了网络"，只能在调用边界打点计数；由 `tests/line-health.test.ts` 用 vitest spy 包裹真实 GitHub axios 调用做计数覆盖，不等待真实 5 分钟，也不整体 mock 掉 GitHub——首次调用仍走真实网络，只统计调用次数）

---

### Step 13（Reviewer r1 必须修复项3）: recent_commit 字段存在且与 production 环境一致
**来源**: `[AI_ADDED]` — Reviewer r1 指出 `data.recent_commit` 在 r1 合同中定义但 DoD/tests 零覆盖
**可观测行为**: `GET .../line04/deployment` 响应 `data` 恒含 `recent_commit` 键；其值要么为 `null`（当 production 环境无匹配提交）要么与 `environments` 中 `name=="production"` 项的 `commit_sha`/`commit_date` 完全一致（复用同一数据，不重复调用 GitHub）
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '.data | has("recent_commit")' || { echo "FAIL: 缺 recent_commit 字段"; exit 1; }
echo "$RESP" | jq -e '((.data.recent_commit == null) and ((.data.environments[] | select(.name=="production") | .commit_sha) == null)) or (.data.recent_commit.sha == (.data.environments[] | select(.name=="production") | .commit_sha))' || { echo "FAIL: recent_commit 与 production 环境不一致"; exit 1; }
echo OK
```
**硬阈值**: `recent_commit` 字段恒存在；非 null 时 `sha` 字面等于 production 环境的 `commit_sha`

---

### Step 14（Reviewer r1 必须修复项4）: deployment/abilities 禁用字段反向检查
**来源**: `[AI_ADDED]` — Reviewer r1 指出仅顶层 `/line-health` 做了禁用字段反查，`deployment`（禁用 `deploy_version`/`version`）与 `abilities`（禁用 `features`）两个端点缺对应检查
**可观测行为**: `deployment` 响应 `data` 不得出现 `deploy_version`/`version` 键；`abilities` 响应 `data` 不得出现 `features` 键（防 generator 漂移到旧 `path-health` 同义词）
**验证命令**:
```bash
RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com")
echo "$RESP" | jq -e '(.data | has("deploy_version") | not) and (.data | has("version") | not)' || { echo "FAIL: deployment 出现禁用字段"; exit 1; }
RESP2=$(curl -sf localhost:3000/api/staff/line-health/line04/abilities -H "X-User-Email: staff@test.com")
echo "$RESP2" | jq -e '.data | has("features") | not' || { echo "FAIL: abilities 出现禁用字段 features"; exit 1; }
echo OK
```
**硬阈值**: 两个端点均不得出现各自禁用字段名

---

## E2E 验收（最终 final-e2e — target_environment: windows_cloud 变体C）

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest + Playwright，真实后端，禁 `page.route()`）

### 模式A（evaluator 逐场景跑，local_api，curl 直连本机/CI 已启动的 `apps/api`）

```bash
#!/bin/bash
set -e
# 模式A 汇总脚本 — 复用上方 Golden Path Step 1/2/5/6/7/8/9/10 的验证命令，
# 假设 apps/api 已在 localhost:3000 启动（staffGuard 白名单含 staff@test.com）
API="http://localhost:3000"
AUTH_HEADER="X-User-Email: staff@test.com"

echo "== Scenario: 总览三卡片 + not_connected 判定点 =="
RESP=$(curl -sf "$API/api/staff/line-health" -H "$AUTH_HEADER")
echo "$RESP" | jq -e '.data | length == 3' || { echo "FAIL: 应返回3条线"; exit 1; }
echo "$RESP" | jq -e '.data[] | select(.line_key=="line01") | .availability == "not_connected" and .maturity == "not_connected" and .journey_id == null' \
  || { echo "FAIL: line01 not_connected 判定点不对"; exit 1; }

echo "== Scenario: 详情页部署tab三环境 + related_prs恒为数组 =="
RESP=$(curl -sf "$API/api/staff/line-health/line04/deployment" -H "$AUTH_HEADER")
echo "$RESP" | jq -e '(.data.environments | length == 3) and (.data.related_prs | type == "array")' \
  || { echo "FAIL: deployment schema 不对"; exit 1; }

echo "== Scenario: not_connected 线两个tab空态文案 =="
RESP=$(curl -sf "$API/api/staff/line-health/line01/deployment" -H "$AUTH_HEADER")
echo "$RESP" | jq -e '.data.connected == false and .data.message == "该业务线尚未接入 Brain 数据，暂无法展示"' \
  || { echo "FAIL: line01 空态文案不对"; exit 1; }

echo "== Scenario: 未知lineKey 404 + 鉴权403 =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/staff/line-health/bogus/deployment" -H "$AUTH_HEADER")
[ "$CODE" = "404" ] || { echo "FAIL: 未知lineKey应404"; exit 1; }
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/staff/line-health")
[ "$CODE2" = "403" ] || { echo "FAIL: 无鉴权应403"; exit 1; }

echo "== Scenario: GitHub 真实第三方调用 =="
GH=$(curl -sf "https://api.github.com/repos/perfectuser21/zenithjoy-workspace/commits?sha=main&per_page=1")
echo "$GH" | jq -e '.[0].sha | type == "string" and (length == 40)' || { echo "FAIL: GitHub真实调用失败"; exit 1; }

echo "== Scenario: dev/staging 陈旧分支不得显示 active（Reviewer r1 修复项1）=="
RESP=$(curl -sf "$API/api/staff/line-health/line04/deployment" -H "$AUTH_HEADER")
echo "$RESP" | jq -e '(.data.environments[] | select(.name=="dev") | .status) != "active"' || { echo "FAIL: dev 不应 active"; exit 1; }
echo "$RESP" | jq -e '(.data.environments[] | select(.name=="staging") | .status) != "active"' || { echo "FAIL: staging 不应 active"; exit 1; }

echo "== Scenario: recent_commit 存在且与 production 一致（Reviewer r1 修复项3）=="
echo "$RESP" | jq -e '.data | has("recent_commit")' || { echo "FAIL: 缺 recent_commit"; exit 1; }

echo "== Scenario: deployment/abilities 禁用字段反查（Reviewer r1 修复项4）=="
echo "$RESP" | jq -e '(.data | has("deploy_version") | not) and (.data | has("version") | not)' || { echo "FAIL: deployment 禁用字段泄漏"; exit 1; }
RESP_AB=$(curl -sf "$API/api/staff/line-health/line04/abilities" -H "$AUTH_HEADER")
echo "$RESP_AB" | jq -e '.data | has("features") | not' || { echo "FAIL: abilities 禁用字段泄漏"; exit 1; }

echo "✅ 模式A 全部场景通过"
```

### 模式B（final-e2e，windows-latest + Playwright，真实后端）

**workflow 文件**: `.github/workflows/e2e-staff-line-health-windows.yml`（generator 需创建，双 job 模式：PR ubuntu 快反馈 + workflow_dispatch windows 深验，复用 `e2e-line02-account-role-unify-windows.yml` 结构）

**steps 梗概**（generator 必须在 `.yml` 里实现）:
```yaml
name: E2E — Staff Hub 业务线健康看板
on:
  pull_request:
    branches: [main]
    paths:
      - 'apps/api/src/routes/staff.ts'
      - 'apps/staff-hub/src/pages/LineHealthPage.tsx'
      - 'apps/staff-hub/src/pages/LineHealthDetailPage.tsx'
      - 'apps/staff-hub/e2e/line-health.spec.ts'
      - 'product-map/generated/product-map.json'
      - '.github/workflows/e2e-staff-line-health-windows.yml'
  workflow_dispatch:
jobs:
  e2e:
    # ubuntu-latest 快反馈 job：起真实 apps/api（STAFF_EMAILS=staff@test.com）+ vite（VITE_SKIP_AUTH=true）
    # spec 禁 page.route()，打真实后端；Brain 在 ubuntu CI 若不可达，line04 走 degraded 分支（仍是合法断言路径）
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Build & start apps/api
        working-directory: apps/api
        env:
          PORT: '3000'
          STAFF_EMAILS: 'staff@test.com'
        run: |
          npm run build
          node dist/index.js > /tmp/apps-api.log 2>&1 &
          for i in $(seq 1 30); do curl -fs http://localhost:3000/health >/dev/null 2>&1 && break; sleep 1; done
      - name: Install Playwright Chromium
        working-directory: apps/staff-hub
        run: npx playwright install chromium --with-deps
      - name: Start Vite (staff-hub, VITE_SKIP_AUTH=true)
        working-directory: apps/staff-hub
        env: { VITE_SKIP_AUTH: 'true', VITE_MOCK_USER_EMAIL: 'staff@test.com' }
        run: |
          npx vite --port 5175 &
          for i in $(seq 1 30); do curl -fs http://localhost:5175 >/dev/null 2>&1 && break; sleep 1; done
      - name: Run Playwright E2E
        working-directory: apps/staff-hub
        env: { E2E_BASE_URL: 'http://localhost:5175' }
        run: npx playwright test e2e/line-health.spec.ts --reporter=list
  e2e-windows:
    # windows-latest 深验 job：workflow_dispatch 手动/evaluator触发，复用 sprint 目录 e2e-verify.ps1
    runs-on: windows-latest
    if: github.event_name == 'workflow_dispatch'
    defaults: { run: { shell: pwsh } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - working-directory: apps/staff-hub
        run: npx playwright install chromium --with-deps
      - working-directory: sprints/07281207-staff-line-health-dashboard
        run: ./e2e-verify.ps1
```

**windows_cloud 变体C 死规则（全部遵守）**:
1. Playwright spec 禁止 `page.route()`
2. `e2e-verify.ps1` 必须先启动 `apps/api`（port 3000）并等待就绪，再启动 `apps/staff-hub` 的 Vite（port 5175）
3. `VITE_SKIP_AUTH=true` + `VITE_MOCK_USER_EMAIL=staff@test.com` 绕过登录界面，同时对齐后端 `STAFF_EMAILS` 白名单
4. `product-map.json` 缺失场景（Playwright spec 内一个独立 test，通过 e2e-verify.ps1 在跑该 test 前临时重命名文件、跑完恢复，不得用 `page.route()` 伪造响应体）

**e2e-verify.ps1 脚本内容**（generator 已由 proposer 预写，位于 `sprints/07281207-staff-line-health-dashboard/e2e-verify.ps1`，与本节内容一致，generator 不得删减断言，只可在实现变化时同步调整具体选择器/字段名）：见仓库同目录文件，摘要如下：
1. `npm ci` → 构建 `apps/api` → 注入 `PORT=3000`/`STAFF_EMAILS=staff@test.com` 启动 → 等待 `http://localhost:3000/health` 就绪
2. `playwright install chromium` → 构建/启动 `apps/staff-hub`（`VITE_SKIP_AUTH=true`）Vite preview（port 5175）→ 等待就绪
3. 跑 `npx playwright test e2e/line-health.spec.ts`（真实后端，无 stub），断言：
   - 总览页 3 张卡片渲染，line01/line02 显示"未接入"灰色徽章文案
   - 点击 line04 卡片进入详情页，默认「部署」tab 渲染三环境状态
   - 切换「能力」tab 渲染能力清单或"暂不可达"降级文案（Brain 在 windows_cloud 沙盒可能不可达，两种结果均视为通过，脚本按 `data-testid` 存在性断言，不强绑定具体数据）
   - product-map.json 缺失场景：脚本临时重命名文件跑一次专门 test，断言页面出现顶部 banner 文案，而非白屏/控制台报错
4. 清理进程，非 0 exit code → 整个脚本 throw 失败

**PASS 标准**：模式A 脚本 exit 0 + 模式B `e2e-verify.ps1` exit 0（Playwright 全部 spec 通过）
**FAIL 标准**：任一断言失败 / 进程未在超时内就绪 / Playwright spec 含 `page.route()`

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 总览三卡片 + not_connected 判定点 | `sprints/07281207-staff-line-health-dashboard/tests/line-health.test.ts` | `返回 line01/line02/line04 三条，line01 标 not_connected` / `maturity 字面为 not_connected 且 journey_id 为 null` / `schema keys 完整性` / `Brain 查询 5xx/timeout 时该线 degraded` | → 4 failures（路由未实现，实测返回 404） |
| product-map.json 降级路径 | 同上 | `product-map.json 读取失败时降级为兜底清单，source=fallback` | → 1 failure |
| deployment 端点 | 同上 | `line04 返回三环境状态 + related_prs 恒为数组` / `production commit_sha 若非空必须匹配真实 40 位 hex 格式` / `not_connected 线（line01）deployment 返回 200 空态` | → 3 failures |
| abilities 端点 | 同上 | `line04 返回 abilities 数组，每项字段齐全` / `Brain 查询失败时 abilities 返回 [] 且 message 含 Brain: 前缀` / `not_connected 线（line02）abilities 返回 200 空数组` | → 3 failures |
| staffGuard / 未知 lineKey（本就成立，实现后仍须保持）| 同上 | `无认证头访问返回 403` / `未知 lineKey 返回 404` | → 已通过（trivial invariant，实现前后均应保持 true，非造假） |
| 陈旧分支判定 stale vs active（Reviewer r1 修复项1）| 同上 | `分支存在且找到匹配提交，但 commit_date 超过 30 天阈值时必须标 stale，不得标 active` | → 1 failure |
| GitHub 数据缓存 TTL（Reviewer r1 修复项2）| 同上 | `短时间内两次请求同一 line04 deployment，底层 GitHub 抓取调用次数不随第二次请求增加` | → 1 failure |
| recent_commit 字段一致性（Reviewer r1 修复项3）| 同上 | `recent_commit 字段存在，且与 environments 中 production 项一致` | → 1 failure |
| deployment/abilities 禁用字段反向检查（Reviewer r1 修复项4）| 同上 | `deployment 端点响应不得出现 deploy_version/version 字段` / `abilities 端点响应不得出现 features 字段` | → 2 failures |

实测 Red 证据（本 proposer 已跑，修订轮）：`npx vitest run sprints/07281207-staff-line-health-dashboard/tests/ --config vitest.config.cjs` → **16 failed | 5 passed (21)**。r1 版本为 11 failed | 5 passed (16)；本轮新增 5 条 it()（stale判定1条 + 缓存TTL1条 + recent_commit一致性1条 + 禁用字段反查2条），实测全部落在 failed 桶（5 条通过项仍为 staffGuard 全局中间件与未实现路由的 Express 默认 404 handler 提供的平凡不变量，非假绿）。

## Notes

- `contract-gate: skipped (file not found, third-party repo)` — 本仓库（zenithjoy-workspace）不存在 `packages/brain/src/lib/contract-gate.js`（该文件属 cecelia repo），按跨 repo 跳过规则，代码层 Contract Gate 未执行，仅执行本 skill 内置规则审查（自查 checklist + Contract Gate 惯用法速查表人工过一遍，见上方各 BEHAVIOR 命令）。
- `reviewer-r1-resolved: 环境状态数据源` — r1 版本曾登记 `judgment-pending-user`，本轮已按方案(a)（陈旧阈值判定，见 Step 11 + 判定点登记表 ⚠️ 行订正）落地，不再是待用户确认的开放判定点；若用户认为 30 天阈值需要调整，请在本轮 Reviewer 反馈里指出具体天数。
