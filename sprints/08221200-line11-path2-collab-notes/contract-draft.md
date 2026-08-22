# Contract Draft — 路② 协同笔记/文档 第一刀（S1+S2+S3）

本合同草案由 planner 从签好的 `gp-contract-v2.json` + `proposal-v2.md` 倒推本刀（S1+S2+S3，单 org 端到端可用；不含 S4/S5 AI）。CONTRACT IS LAW：下列 [BEHAVIOR]/[ARTIFACT] 全实现，合同外一字不加；`tests/*.test.ts` 从本合同断言原样落地，commit 1 后不可改。

## GP-Anchor

line11/collaborative_docs#step1

（锚定 capability collaborative_docs 骨干前 3 步 S1/S2/S3；GP golden_paths=301bd18f-ba56-4e57-b99f-3d0a1e90fad5，journey=da60cb26。行内引用格式：GP-Anchor: line11/collaborative_docs#step1）

## journey_type

user_facing

## target_environment

windows_cloud（UI 全链）+ local_api（服务端安全断言随 CI vitest）

## 假设的 API/WS 表面（proposer 可微调路径，行为不可变）

- `POST /api/workbench/documents` {parent_id?, title, content?} → 201 {id, org_id, parent_id, title, visibility, ...}
- `GET /api/workbench/documents/:id` → 200 doc | 404（无权=不存在同形状）
- `PATCH /api/workbench/documents/:id` {content?, title?}（自动保存；失败返回错误码，不静默成功）
- `POST /api/workbench/documents/:id/move` {parent_id}
- `DELETE /api/workbench/documents/:id`（软删，写 deleted_at）/ `POST /api/workbench/documents/:id/restore`
- `GET /api/workbench/documents/tree` → 本 org 文档树（无权节点不出现）
- `GET /api/workbench/documents/search?q=` → 命中列表（无权文档不出现）
- `GET /api/workbench/documents/:id/export?format=markdown` → 200 markdown | 404
- `PUT /api/workbench/documents/:id/visibility` {visibility: 'org'|'members'|'private', member_ids?}
- `POST /api/workbench/documents/:id/mention/resolve` {target_id} → 200 {title} | 404（无权/跨企业不泄标题）
- WS `/collab-ws?doc_id=<id>`：cookie 会话握手，成功建房后 Yjs update 二进制帧双向；握手失败/无权/多 org → 拒绝不建房（close code + 无在线/正文信号）

## 行为断言（[BEHAVIOR]，对应合同 A1–A10 本刀子集）

### A1 [BEHAVIOR] cross-tenant 六层隔离 + 变异
持 B 企业真实会话，对 文档/文件夹/正文/@提及/协作房/检索域 六层任一伪造 org_id 指向 A → 4xx 或空集，且 A 文档逐字未变；B 会话连 A 的 (org_id,doc_id) 协作房 → 拒绝且拿不到任何在线/正文信号。变异：把 org 改回读身份头 / 注掉 WS 握手鉴权 → 必转红。（本刀「检索域」层因无 S4 检索器，落为「B 会话对 A doc 的读/搜/导出/@提及 API 全 404」）

### A2 [BEHAVIOR] S1 写留 + XSS/SQL + 自动保存不静默丢
建档→写富文本（含内嵌图片引用 + @提及文档）→存→刷新仍在→本组织树可见→导出 Markdown 往返；正文注入 `<img onerror>` / `href=javascript:` → 渲染/入库后文本节点/协议被剥（content jsonb 不含该节点/协议）；标题 `"; DROP TABLE` → 参数化不触发（表仍在）；自动保存 500/弱网时端点返回错误码（非 200 静默），编辑器可见提示且本地草稿保留。

### A3-a [BEHAVIOR] S2 实时 CRDT 字符级合并 + 多人光标 + 断连 resync 零丢字（windows_cloud L3）
两个已鉴权会话（双 browser context）同时编辑同一文档不同段落 → 字符级自动合并、双方改动均在、非 409；改同一句无静默丢字；awareness 多人光标可见。**断连 resync 合并正确性（硬断言，非仅存在性）**：A 断网（context.setOffline(true)）→ A/B 各自离线输入**可辨识文本**（A 输入串 α、B 输入串 β）→ A 期间只读横幅可见 + 本地暂存 → A 重连（setOffline(false)）→ 等 resync → 断言 **A、B 两 context 最终 DOM 均含 α 与 β 两串离线文本、零丢字**（lifeline⑧ 无静默丢失是签署铁律，resync 合并正确性不得降级为"肉眼验横幅存在"）。

### A3-b [BEHAVIOR] WS 无会话握手拒绝 + 变异
无有效会话握手连 `/collab-ws` → 拒绝不建房（无在线/正文信号）。变异：注掉握手鉴权 / 注掉 doc 权校验 → 必转红。

### A3-c [BEHAVIOR] WS 多 org fail-closed 不取 rows[0] + 变异
多 org 成员（tenant_members 命中 rows.length>1）连 `/collab-ws` → 拒绝不建房（比照 HTTP 409 语义），拿不到任何在线/正文信号。变异：WS 握手改取 rows[0] 静默挑一个 org → 必转红。

### A3-d [BEHAVIOR] 单 org 端到端可用下限
单 org 成员从会话唯一推 org，建房→协同→落库全链可用；多 org 分支冻结在 fail-closed 下限待 active_org（不阻塞本刀关闭）。

### A3-e [BEHAVIOR] 会话失效不静默续命 + 变异
建 WS 连并在线 → 服务端使该会话失效（删 session 行）→ 下一 ping 周期或下一写操作时该连接被断开并要求重验。变异：去掉会话失效检查（长连不再校验 session 存活）→ 必转红。

### A4 [BEHAVIOR] S3 权限三档 + 六处过滤 + most-restrictive + member live 校验 + fail-closed
设文档「仅自己」→ 他人在 树/搜索/打开/导出/@提及/协作准入 六处（本刀不含 AI 检索）全部拿不到（统一 404 同文案同形状）；most-restrictive 继承：设父级「仅自己」后子档实际生效范围 ≤ 父级；从 tenant_members 删除某 member 后其对成员集合共享文档立即不可达（S3 live 校验，非只信静态 id 列表）；权限查询失败 → fail-closed 503 不降级为可见。变异：注掉 member live 校验（只信静态 id 列表）→ 必转红。

### A7 [BEHAVIOR] G2 备份恢复演练（L2）
从 pg_dump 备份还原到临时库，documents.content jsonb + crdt_state bytea + 关键字段（org_id/visibility/parent_id/deleted_at/ai_retrieval_opt_out）逐条比对一致；演练进 cron 非一次性。

### A9 [BEHAVIOR] 路① knowledge.ts CRUD 回归
引入 documents 到共享知识/检索基建后，路① 既有 CRUD 端点（knowledge.ts `POST /entries` / `GET /recent` / `GET /projection`）不回归——路① 既有 smoke 保持全绿（参照 PR#1676 教训）。

### A10 [BEHAVIOR] CRDT/WS 路径 XSS 服务端 CV 校验 + 变异（L3）
裸 WS 客户端（同 org 已鉴权，直连 `/collab-ws`）向 CRDT 文档注入 `href=javascript:` / `<img onerror>` / 非白名单节点的 Yjs update → 服务端 CV 在 apply 后落库前拒绝该 update（或剥离后再落），落库的 crdt_state 派生 doc 与 content jsonb 均不含该非白名单节点/协议，渲染后无脚本执行面。变异：注掉服务端 CV（CRDT update 不过 schema 白名单直接落库）→ 必转红。

## 产物断言（[ARTIFACT]）

- [ARTIFACT] DB migration 建 `zenithjoy.documents`（字段见 PRD）+ 可见成员集合表；`documents` 表存在且 org_id NOT NULL。
- [ARTIFACT] `apps/api/src/workbench/document-schema.ts` 单一白名单实现，被 HTTP 保存与 CRDT-CV 共同 import（源码可查复用点）。
- [ARTIFACT] `apps/api/src/services/collab-ws.ts` + `apps/api/src/index.ts` wire `attachCollabWS(server)`（路径 `/collab-ws`，独立于 `/agent-ws`）。
- [ARTIFACT] `apps/api/package.json` 新增 `yjs` + `y-prosemirror` 依赖（服务端 CRDT apply + CV 派生 doc 需要，与 staff-hub 用同一 major）。
- [ARTIFACT] `apps/staff-hub/package.json` 锁定 @tiptap/* 3.x + yjs + y-prosemirror 版本。
- [ARTIFACT] `apps/api/vitest.collab-notes.config.ts` 白名单含本 sprint `tests/` 目录 + `apps/api` 暴露 `test:collab-notes` 运行脚本（路③ vitest.workbench-*.config.ts 范式）。
- [ARTIFACT] 接线三件套：smoke 进 smoke-baseline.txt、spec 进 workflow 清单 + guard 文件名列表、聚合进 required check。

## 禁 mock 边

- 不 mock 会话解析：真 express app + 真 better-auth 会话 cookie（走 STAFF_* env + /api/staff/feishu-login，同路①③ 范式）。
- 不 mock tenant_members / documents 查询：真 Postgres（E2E_DATABASE_URL）。
- A10 不 mock CRDT 落库：真 Yjs update 编码 + 真 `/collab-ws` + 真 pg 回查 crdt_state/content。
- A3-a 不 mock 浏览器合并：windows_cloud 双 browser context 真编辑。
- 允许 mock：无（本刀无第三方上游；无 AI 故无 LLM mock）。

## 变异守卫清单（proven-to-fire，注掉守卫对应测试必转红）

1. WS 握手鉴权（A1/A3-b）→ 注掉 getSession → 转红
2. WS doc 权校验（A3-b）→ 注掉每连接 doc 编辑权检查 → 转红
3. WS 多 org 取 rows[0]（A3-c）→ 握手改取 rows[0] → 转红
4. WS 会话失效检查（A3-e）→ 去掉 ping/写操作 session 存活复核 → 转红
5. 身份读头回落（A1）→ org 改回读请求头 → 转红
6. member live 校验（A4）→ 只信静态 id 列表 → 转红
7. 服务端 CV（A10）→ CRDT update 不过 schema 白名单直接落库 → 转红

## 工程约束（历史踩坑，写进测试/实现）

- vitest 断言 suite 数用 `(.testResults|length)` 不用 `numTotalTestSuites`。
- 测试 seed 用 E2E_DATABASE_URL 的 pg Client，被测 app 走 connection.ts pool（DATABASE_HOST/PORT/NAME/USER）——**两者必须指向同一库**，否则 seed 一个库 app 读另一个。
- windows E2E：step 间端口交还；npm ci 二次撞 EPERM 用缓存/单次安装。
- 变异守卫必须 proven-to-fire，样本跨断裂点。
- @提及/无权 id 统一 404 不泄标题（反枚举，md5 全等钉同形状）。

## 真实调用方请求 shape

本刀无「设备/agent 调服务端」类外部调用方——协作房与文档端点的唯一调用方是**员工浏览器**：

- HTTP 文档端点：认证走 **cookie 会话**（better-auth sessionToken），org 归属服务端从 `zenithjoy.tenant_members` 真查；请求体里的 `org_id` 一律忽略（不读身份头，与路①③ `workbenchAuthGuard` 逐字同口径）。
- WS `/collab-ws`：握手复用**同一 cookie 会话**——`auth.api.getSession({ headers: fromNodeHeaders(upgradeReq.headers) })` → `tenant_members` 真查，`rows.length===1` 才建房；0→拒、`>1`→拒（绝不取 rows[0]）。**认证不走 query/body token**，与 HTTP 面零分叉（堵「DoD 用 body、生产走 header」双路径）。
- 协作协议帧：WS 建房后为 **Yjs binary update** 帧（`Y.encodeStateAsUpdate` 编码），非 JSON；awareness 光标走 y-protocols awareness 帧。

## 未覆盖真实链路清单

- **多 org 成员正常协同**：active_org 语义未定，本刀只保证 fail-closed 拒绝（A3-c/A1），**正常态多 org 协同不覆盖**——待 multiorg agent 定 active_org 后另起刀。（补位：multiorg 线程）
- **多人光标实时延迟 / resync 顺滑度（延迟阈值）**：best_effort，非硬延迟门（延迟阈值留后续刀）。**注意：resync 的「合并正确性/零丢字」不在此豁免内——它是 A3-a 硬断言（断连 α/β→重连两 context DOM 均含），豁免的仅是"多快合并完"的延迟阈值。**
- 本刀**无第三方 API mock**（无 LLM / 无支付 / 无平台）：`## 未覆盖真实链路清单` 仅上两条 scope 边界，非 mock 豁免。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR | 文档 CRUD+树+软删回收站+导出；Yjs 实时协同+多人光标；三档权限六处过滤 |
| NFR | TipTap 3.x + Yjs 版本锁；CRDT 延迟 best_effort；导出限流 P2 |
| Invariant | cross-tenant 六层隔离 / 三档权限六处过滤 / XSS-SQL 白名单 / WS 握手鉴权 / 备份可恢复 / 无静默丢失（见 prep-prd Invariant 段 6 条） |
| 判定点 | 见下方登记表 |
| 保质期 | cookie 会话 7 天（沿用 better-auth）；session 删除即失效（A3-e） |
| 死亡告警 | 自动保存失败/断连/多 org 拒绝/会话失效/CV 拒绝均须可见信号（前端提示或服务端 log），失败不静默 |
| 失败语义 | 权限查询失败 fail-closed 503（不降级可见）；自动保存失败返错误码+保留本地草稿；多 org fail-closed 拒绝 |
| 效果确认 | 建档→刷新 GET 仍在（留得住）；Yjs update→psql 回查 crdt_state 非空（落库确认）；CV→psql 回查不含非白名单节点 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ WS 建房成功 vs 拒绝 | A. 收 open 且无立即 close 帧; B. 只看 TCP 连上 | A（open + 无 close + 无在线/正文帧才算拒绝） | 只看 TCP 连上会把「连上即被 close」误判为建房，跨企业协作房隔离假绿 | 跨企业能进他企业协作房，误判后果=数据越权 |
| ⚠️ 多 org 成员归属 | A. rows.length>1 即拒; B. 取 created_at 第一条 | A（fail-closed 拒绝，绝不取 rows[0]） | 用时间戳偶然顺序决定归谁、错了无信号（路③ workbench-auth 原话） | 经营数据静默归错企业，最坏错误形态 |
| CRDT update 是否含非白名单节点 | A. 服务端 schema 白名单 CV 校验派生 doc; B. 只信前端已过滤 | A（apply 后落库前服务端 CV） | 裸 WS 客户端可绕前端直注（proven-to-fire 变异） | 存储型 XSS 落库，渲染即执行脚本 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 权限解析查询失败 | 503 LEDGER_UNREACHABLE，不返可见 | 是（无副作用读） | 客户端重试，绝不降级为可见 |
| 自动保存 500/弱网 | 端点返 4xx/5xx 错误码 | 是（同 content 覆盖幂等） | 编辑器可见提示 + 本地草稿保留 |
| 多 org 成员握手 | WS close 拒绝不建房 | N/A | 前端可读提示（体验项），不越权 |
| 会话失效 | 下一 ping/写操作断连 | N/A | 要求重验，不静默续命 |

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest 干净 VM，双 browser context 模拟两人同编验 CRDT L3；ZenithJoy 任何 UI E2E 死规则走此环境）

> 本段脚本 = evaluator 模式B final-e2e 载体，generator 落地为 `sprints/08221200-line11-path2-collab-notes/e2e-verify.ps1` + `apps/staff-hub/e2e/collab-notes-crdt.spec.ts`（真后端，禁 `page.route()` stub；变体C 死规则）。Playwright 开**两个 browser context** 模拟甲乙两人，spec **必含**四组硬 DOM 断言：①同编不同段落→字符级合并双方改动均在（非 409）；②对方 awareness 光标/选区元素可见；③**断连 resync 零丢字**：A `context.setOffline(true)` 断网、A/B 各自离线输入可辨识文本 α/β、A 只读横幅可见、A `setOffline(false)` 重连等 resync→断言 A、B 两 context 最终 DOM 均含 α 与 β（零丢字，不止验横幅存在）；④设「仅自己」后第三 context 打开该文档得 404。

```powershell
# final-e2e — 路② 协同笔记 CRDT 双人同编（windows-latest，真 apps/api + 真 collab-ws + 真 staff-hub）
# ⚠️ 变体C 死规则：禁 page.route()/stub，所有请求打真实后端；后端必须启动并就绪
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$VitePort = 5174; $ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. 依赖 + 浏览器
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci" -WorkingDirectory $repoRoot -Wait -NoNewWindow
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -NoNewWindow

# 2. 迁移（建 documents / document_members 表）
$env:DATABASE_URL = $env:E2E_DATABASE_URL
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run migrate --workspace apps/api" -WorkingDirectory $repoRoot -Wait -NoNewWindow

# 3. 启动真后端 API（含 attachCollabWS 的 http server），等就绪
$env:NODE_ENV = "test"
$apiProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$w=0; do { Start-Sleep 1; $w++; $c=Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue } while(-not $c.TcpTestSucceeded -and $w -lt 40)
if (-not $c.TcpTestSucceeded) { throw "FAIL: API 未就绪 port=$ApiPort" }

# 4. build + 起 staff-hub preview，等就绪
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -NoNewWindow -Environment @{ VITE_API_URL="http://localhost:$ApiPort" }
$viteProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
$w=0; do { Start-Sleep 1; $w++; $c=Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while(-not $c.TcpTestSucceeded -and $w -lt 40)
if (-not $c.TcpTestSucceeded) { throw "FAIL: staff-hub 未就绪 port=$VitePort" }

# 5. 跑双 context CRDT spec（禁 page.route）——断言字符级合并/多人光标/断连横幅/仅自己 404
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e\collab-notes-crdt.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow -Environment @{ E2E_BASE_URL="http://localhost:$VitePort" }
Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: CRDT 双人同编 E2E 失败 exit=$($e2e.ExitCode)" }
Write-Host "✅ windows_cloud 协同笔记 CRDT E2E 验证通过（真后端 + 真 collab-ws）"
exit 0
```

**PASS 标准**：`e2e.ExitCode -eq 0` + Playwright spec 全过（两 context 各自同编输入均在无丢字、对方光标元素可见、**断连 resync 后两 context DOM 均含 α 与 β 两串离线文本零丢字**、断连期间只读横幅可见、设「仅自己」后第三 context GET/打开均 404）+ API/collab-ws 已启动（无 stub）。
**FAIL 标准**：任一 step exit≠0 OR 后端未就绪 OR Playwright 失败 OR 出现 `page.route()`/stub。
**GHA workflow**：generator 新增 `e2e-knowledge-hub-path2.yml`（linux job 真 Postgres 跑 `test:collab-notes` vitest + 静态守卫；windows job **无 job 级 if 门** 真跑 `e2e-verify.ps1`，截图 upload）。secrets：`E2E_DATABASE_URL`。

- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后截图存入 `sprints/08221200-line11-path2-collab-notes/screenshots/`
  Screenshots:
    - 01-two-editors.png    期望：两个 context 并排打开同一文档，双方编辑器可见
    - 02-merged-cursors.png  期望：两人各自输入均在正文里、字符级合并无覆盖，对方光标/选区可见
    - 03-private-404.png     期望：设「仅自己」后第三 context 打开该文档得「不存在/无权」提示（404）
