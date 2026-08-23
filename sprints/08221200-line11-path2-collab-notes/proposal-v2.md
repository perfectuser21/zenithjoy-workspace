# 员工知识中枢 路② 协同笔记/文档 Golden Path v2

提案人：Cecelia（AI）。本提案是 R1 三镜头 GAN 收敛的 **v1→v2 定点修订**：P0=0，逐条核销 R1 合并 feedback 的 **5 条 P1**（全部核销，无 REFUTE）+ 5 条 P2 记账。骨干 5 步不变（feedback 未要求动骨干），本轮只补断言/判定点/Gate/挂片。实锤基准 `origin/main`（本 worktree 落后 58 commit，全部 `git show origin/main:<path>` 读，证据见 `.harness/explore-report.md`）。

**GP_ID**：`301bd18f-ba56-4e57-b99f-3d0a1e90fad5`（golden_paths，status=candidate，journey=da60cb26，capability_code=`collaborative_docs`）
**一句话**：员工要写一篇文档（会议纪要/SOP/方案/wiki）→ 在 Staff Hub 建文档、写富文本、组织成文档树、多人实时协同（CRDT）、按组织权限管住、AI 一等公民能读能写回且受同一权限约束不投毒、与经验打通，数据按组织隔离可导出、删错可恢复。

---

## 0. 相对 v1 的结构性变化（R1 feedback 逐条处置：5×P1 全核销 + 5×P2 记账）

> 处置类型：**核销**（改正文）/ **REFUTE**（带证据反驳）。本轮 5 条 P1 **全部核销，无 REFUTE**。

### P1（阻塞项）

- **P1-1（tech）CRDT/WS 通道绕过 XSS schema 白名单 → 核销**。承认 v1 的 G1/lifeline④ 白名单只覆盖 HTTP 编辑器 + AI 写回，`/collab-ws` 上的 Yjs 二进制 update 走裸 socket 不流经 HTTP schema 端点，同 org 已鉴权者用裸 WS 客户端可注入 `href=javascript:`/非白名单节点→进 `crdt_state`→派生入 `content jsonb`→存储型 XSS + 被抽进检索。**改法落地**：为 CRDT update 命名**服务端强制校验点 CV**——服务端在 Yjs update **apply 后、落库前**，对派生 ProseMirror doc 过**与 HTTP 编辑器/AI 写回同一条** schema 白名单（含 href/src 协议白名单），非白名单节点/协议**拒绝该 update 或剥离后再落**（拒绝优先，剥离仅对可安全净化的 mark），并向该连接回 reject 信号使其回滚本地状态。改到 **G1**（新增 CV 校验点行）+ **S2 挂片/判定点 J10**（新增）+ **lifeline④**（覆盖面扩到 CRDT/WS 路径）+ 新增断言 **A10**（裸 WS 客户端注入 + 变异守卫：注掉服务端 CRDT 校验必转红）。→ 回应 tech#P1-1
- **P1-2（tech+risk）AI 检索陈旧 ACL 窗口与 fail-closed 自相矛盾 → 核销，采纳推荐 (a)**。v1 lifeline② 把「AI 检索」列为 fail-closed 七处之一 + A4 断言权限收紧后 AI 检索**立即**拿不到（硬），却又用 best_effort⑨「索引 N 秒一致」承认存在陈旧 ACL 越权召回窗口——自相矛盾。**改法落地**：采纳 **(a) query-time 过滤器 live 重导 effective-visibility**——索引**仅作候选生成**，召回后按 **live ACL 复核**（比照 J5 读路径二次校验，查 `tenant_members` + live visibility），无权候选在返回 LLM 前**丢弃**。由此**正确性由 query-time live 复核保证**（真 fail-closed，零陈旧窗口），**索引新鲜度降级为纯性能项**（陈旧只影响「该不该出现在候选里」，不影响「无权内容会不会泄」）。改到 **J6**（检索形态改为 index=候选 + query-time live ACL 复核）+ **lifeline②**（AI 检索 fail-closed 由 query-time live 复核落实，不再依赖索引新鲜度）+ **best_effort⑨**（改为「索引新鲜度=纯性能项，正确性已由 query-time live 复核兜底」）+ **A4/A5**（AI 检索断言改为 live 复核语义：删 member 后即时不召回，不给 N 秒窗口）。→ 回应 tech#P1-2 / risk#P1-2
- **P1-3（product）AI 检索纳入默认策略无人负责 + fr 超承诺 → 核销**。v1 J6 依赖「显式标可被 AI 检索」才进，但标记触发点/归属/默认策略无步骤承接，且与 fr「就自己有权看到的文档答问」矛盾（默认下 AI 可能一篇读不到，或客户以为能读全部有权文档实际被静默收窄）。**改法落地**：J6 补默认策略——**「有权可见即默认纳入检索，权限前置过滤（P1-2 的 query-time live ACL）兜底投毒面，显式标记仅作 opt-out 退出」**（live ACL 前置 + 数据分隔 + pending 不进检索已把投毒面收窄，无需靠 opt-in）；opt-out 标记 **UI 归属挂到 S4「文档设置·排除 AI 检索」开关**（默认值=纳入，见 S4 挂片），并在 **S1** 文档设置面板同处回显当前是否纳入。**fr_summary 第 4 条**对齐为「就自己**有权可见且未 opt-out** 的文档答问」，同步改合同 `fr_summary` 与 `contract_attack` 命中处。→ 回应 product#P1-3
- **P1-4（risk）WS 手写握手缺「多 org fail-closed」变异守卫 → 核销**。v1 只把多 org 列为散文「验收下限」，变异守卫仅钉「注掉握手鉴权/doc 权校验」，未钉手写握手若取 `rows[0]` 即 `workbench-auth.ts` 注释明令禁止的「静默挑一个 org=把配置事故变成静默跨企业事故」最坏形态。**改法落地**：**A3 补硬断言 + 变异**——多 org 成员连 `/collab-ws`→**拒绝不建房**（比照 HTTP 409 语义，握手处**绝不取 `rows[0]`**）；变异=WS 握手改取 `rows[0]`→**必转红**。写进 **S2 判定点 J2**（握手多 org 处置显式）+ **lifeline⑤**（verification 增多 org 不取 rows[0]）+ **A3** 断言。→ 回应 risk#P1-4
- **P1-5（risk）「会话过期长连不静默续命」无验证断言 → 核销**。v1 G0b/S2 有此承诺但 A1–A9 无一条测、lifeline⑤ verification 也未含。**改法落地**：**补断言**——建 WS 连→服务端**使会话失效（删 session 行）**→**下一 ping 周期或下一写操作时连接被断开并要求重验**（长连不静默续命）。写进 **S2 分支**（会话过期即断连重验，明确触发时机=ping 周期/写操作）+ **lifeline⑤** verification + **A3** 断言（新增子项 A3-e）。→ 回应 risk#P1-5

### P2（记账，不阻塞，进正文/账本）

- **P2-1 核销进正文**：`openrouter.ts` 现状标注由 v1「唯一消费者是 Line04」更正为「**现有唯一消费者是 Line04（微信客服），路② 作 library 复用**」——见 §0 结构性修订沿用、S4 挂片、探索实锤引用处。→ 回应 tech#P2-1
- **P2-2 记账进正文**：多 org 409 用户可感知提示——S2 分支补「多 org 成员进协作/AI 读写时前端展示『**你属于多个组织，暂不支持协同/AI，请联系管理员**』可读提示，而非裸 409/破碎页」（best_effort⑬，实现期文案定稿）。→ 回应 product#P2-2
- **P2-3 记账进不做清单**：`@提及` 首刀仅「@文档」；**@人通知触发器**明确进 **P2 不做清单**（首刀不含，留后续刀）。→ 回应 product#P2-3
- **P2-4 记账进不做清单**：**模板建档 / 文档过期提醒**等触发器明确进 **P2 不做清单**。→ 回应 product#P2-4
- **P2-5 记账留实现期**：**CRDT update log 压缩 / 写放大**（长期 append update 的存储膨胀与写放大）留实现期定压缩/快照 checkpoint 策略，进 P2 账本。→ 回应 tech#P2-5

---

## 外部阻塞项（批准前须知，非本路可独立收口；较 v1 不变）

| 阻塞项 | 现状实锤 | 对本路的影响 | 处置 |
|---|---|---|---|
| **`active_org` 多组织模型未定** | 探索报告：`active_org/activeOrg/current_org` 全 origin/main 零命中；现状一员工命中多 org 即 409 fail-closed（`workbench-auth.ts:92`），无「当前组织」概念 | ① **WS 协作房 org 声明**最终形态未定：单 org 成员可从会话唯一推出 org；**多 org 成员当前 409，无法进任何协作房 / AI 读写**（P1-4 后此为**带硬断言 + 变异守卫**的显式 fail-closed，非散文下限）；② S4/S5 「复用 `req.workbenchIdentity`」中的 org 维度待 active_org 对齐 | **不阻塞 S1**。**S2/S4/S5 的多 org 分支冻结在「单 org 成员端到端可用 + 多 org 成员 fail-closed 409（A3 硬断言+变异守卫钉死不取 rows[0]）」下限**，待 active_org 定案后由 controller 补 org 声明形态；**禁在 active_org 未定时替 multiorg agent 猜测 active_org 语义** |

---

## Gate 前置段（前置门 · 碰生产 DB / 真实 LLM / 跨租户真墙 / windows_cloud 真机 E2E，任一不过整条路停）

> 本路碰四类真实世界接缝（探索报告 §② 逐条非空）：生产 DB 写入（文档正文=企业核心资产）、真实第三方 LLM（S4/S5 真 key 真调用）、跨企业多租户真墙（六层）、WS 长连真机 E2E。故 S2/S4/S5 验证等级承诺**必须 L3**，四道 Gate 全绿方进对应步骤。

| 门 | 内容 | 现状标注（探索实锤） | 断言（冻结） |
|---|---|---|---|
| **G0 组织底座衔接** | 路② 全部文档端点（含 WS 升级、AI 读/写端点）挂 `workbenchAuthGuard`：身份/org **只**来自服务端会话，禁读身份头、禁 `body.org_id` 生效、禁超管旁路、禁 selfHeal。A2 式静态守卫扫路② 路由/service/WS 身份头字面量 | **已有（非死代码）**：`apps/api/src/middleware/workbench-auth.ts` 真实挂载 `apps/api/src/routes/workbench.ts:67 router.use(workbenchAuthGuard)`；身份=`auth.api.getSession(fromNodeHeaders(req.headers))`→`tenant_members` 真查（L63/L79），四态齐全，多 org fail-closed 409（L92），反枚举 404 无 timestamp（`notFoundBody` L54）。**⚠️ 但它是纯 Express cookie-session 中间件，不能 drop-in 到 WS 握手**（见 G0b / J2） | 持 B 企业真实会话 + 伪造 `org_id` 指向 A → 4xx/空集且 A 文档逐字未变；变异=改回读身份头即报红 |
| **G0b WS 握手鉴权（本路最大接缝，净新增）** | WS upgrade **不过 Express 中间件链**（`agent-ws.ts` 自陈）；握手须**手写**复用 better-auth 会话解析：`auth.api.getSession({headers: fromNodeHeaders(upgradeReq.headers)})`→`tenant_members` 真查 → memberId+orgId；**多 org 成员命中 `rows.length>1`→拒绝不建房（比照 HTTP 409，绝不取 `rows[0]`，P1-4）**；协作房按 `(org_id, doc_id)` 强隔离，**每连接**校验请求者对该 doc 有编辑权（S3），**会话过期即断连重验（下一 ping 周期/写操作触发，长连不静默续命，P1-5）**。WS 连接须声明 org（形态待 active_org，见外部阻塞项） | **半成（模式可抄，鉴权净新增）**：`apps/api/src/services/agent-ws.ts` 有 `ws` 库 `WebSocketServer({noServer:true})` + `server.on('upgrade')` 手动升级 + 30s ping/pong，真实 wired `apps/api/src/index.ts:33 attachAgentWS(server)`。**但其鉴权是 agent 机器 token（license_key/ws_token）、路径 `/agent-ws`，非 cookie 会话**——挂载/升级/心跳**模式**可抄，cookie 会话握手 + 协作房 + 每连接 doc 权校验 + 多 org 拒绝 + 会话过期断连=净新增 | B 企业会话连 A 企业 doc 协作房 → 拒绝且拿不到任何在线/正文信号；无有效会话握手 → 拒绝不建房；**多 org 成员握手 → 拒绝不建房（不取 rows[0]）**；**建连后会话失效 → 下一 ping/写操作断连重验**；变异=注掉握手鉴权/注掉 doc 权校验/握手改取 rows[0]/去掉会话失效检查 必须转红 |
| **G1 富文本存储与 XSS 面（本轮补 CV 校验点，P1-1）** | 正文权威快照存 **ProseMirror JSON doc → `documents.content jsonb`**；CRDT 二进制 state 存 `documents.crdt_state bytea`（见 J3）。用户输入的标题/正文永远只做数据值走绑定参数，SQL 注入面物理为零；渲染 XSS 由 ProseMirror schema 白名单收窄——**含节点/mark 属性协议白名单**（link href 仅 http/https/mailto，image src 禁 `javascript:`/`data:`），禁 raw HTML。**三条入库路径过同一条服务端 schema 白名单校验**：① HTTP 编辑器保存；② AI 写回入库；③ **CV=CRDT/WS 路径——服务端在 Yjs update apply 后、落库前，对派生 ProseMirror doc 过同一白名单，非白名单节点/协议拒绝该 update（或剥离可净化 mark 后再落）并回 reject 使该连接回滚**（防裸 WS 客户端绕过写白名单外节点=存储型 XSS，J10） | **半成**：`@tiptap/react`/`starter-kit`/`extension-image`/`extension-link` ^3.19 在 `apps/dashboard/package.json`，**`apps/staff-hub/package.json` 无 tiptap/prosemirror**（有 @dnd-kit/core、ag-grid）；须像路③ AG Grid 一样**跨 app 移植**进 staff-hub + 加 schema 白名单。`documents` 表**缺失**（`git grep zenithjoy.documents` 空）。**CRDT 服务端派生 doc 的校验函数=净新增**（与 HTTP/AI 写回共用同一 schema 白名单实现，单一真相） | 正文注入 `<img onerror>`/`href=javascript:` → 渲染后文本节点/协议被剥；标题含 `"; DROP` → 参数化不触发；AI 构造非白名单节点入库 → 服务端拒；**裸 WS 客户端注入非白名单节点/协议 → CV 拒绝该 update，`crdt_state`/`content jsonb` 均不含该节点（A10）；变异=注掉 CV 服务端校验必转红** |
| **G2 备份底线** | 文档正文 + CRDT state = 企业核心资产，pg_dump 定时 + 异地 + **恢复演练断言**（复用路③ G2 范式） | **缺失（范式可照搬）**：软删/回收站/审计范式在 `workbench.service.ts` 已有，`documents` 备份 job 净新增 | 从备份还原到临时库，`content` JSONB + `crdt_state` + 关键字段逐条比对（L2）；演练进 cron 非一次性 |
| **G3 文档纳入 AI 检索域（路② 独有命门；本轮改 query-time live ACL，P1-2/P1-3）** | 路② 文档进 QA 检索域（**与路③ 排除相反**）。前置定死三条不变式：① **权限过滤=query-time live 复核**——索引仅作候选生成（携带 `org_id`），召回候选后**按 live ACL（查 `tenant_members` + live effective-visibility）复核**，无权候选在喂进 LLM **前丢弃**（正确性不依赖索引新鲜度，P1-2 采纳推荐 a）；② **未确认 AI 草稿块不进检索**（pending 标记，索引器跳过）；③ **正文一律当不可信数据**（分隔 + 来源标注，输出不自动执行/不自动落库）——这才是投毒真防线，人工确认闸不是。**纳入默认策略：有权可见即默认纳入，opt-out 标记（S4 开关）显式退出（P1-3）** | **净新增（检索器整体不存在）**：`apps/api/src/knowledge/retrieval-exclusions.ts` 只是给「路①问答检索（后续刀）」的前向锚，**检索器本身尚未建**；路① knowledge.ts 纯 CRUD 无检索。G3 不是「改排除清单」而是「从零建 index=候选生成 + query-time live ACL 复核 的检索器 + 默认纳入/opt-out 标记」 | 见 S4/S5 断言；变异=删任一不变式断言（尤其 query-time live ACL 复核）报红 |

---

## Golden Path 步骤（承诺式骨干，5 步不变）

> 步骤名 = 客户/老板可感知的承诺；工序细节下沉【挂片】【分支/判定点】。现状标注一律引用探索报告实锤。本轮改动集中在 S2（P1-1/P1-4/P1-5/P2-2）与 S4（P1-2/P1-3/P2-1）。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **S1 文档写得出、留得住**——员工在文档树某节点新建文档，写富文本正文（标题/段落/列表/勾选/代码块/内嵌图片/@提及其他文档），保存刷新还在，出现在本组织文档树；可移动/重命名/软删 + 30 天回收站；整篇可导出 Markdown 拿走 | **半成**：编辑器 TipTap 在 dashboard 有、staff-hub 无（跨 app 移植）；`documents` 表缺失；JSONB 软删/回收站/审计范式已有可照搬；staff-hub 已装 `@dnd-kit/core`（树拖拽可复用，`apps/staff-hub/package.json`） | **L2（服务端真验）** | 文档树 UI（folder/doc 层级 + 拖拽移动）／TipTap 跨 app 移植 + staff-hub 主题 + schema 白名单含属性协议／`documents` 表（id UUID、org_id NOT NULL、parent_id、title、owner_member_id、visibility、`content jsonb`、`crdt_state bytea`、`ai_retrieval_opt_out bool DEFAULT false`（P1-3）、deleted_at）／自动保存（防抖落库）／软删 + 回收站 + 删档二次确认（输入标题）／Markdown 单档导出（明写对图片/@提及的有损范围）／db_audit 审计行／**文档设置面板回显「是否纳入 AI 检索」当前值（opt-out 开关归属见 S4，P1-3）** | 分支：自动保存失败（弱网/500）必须编辑器可见并保留本地草稿，禁静默丢失（现状 `CustomerListPage` 全量重拉掩盖失败，不得继承）。分支：@提及目标校验同 org + 请求者有权可见（无权/跨企业 id → 统一 404 不泄标题）。判定点 J3：正文存储形态（ProseMirror JSON + CRDT state 双写）。判定点：内嵌图片禁 base64 入 JSONB，走对象存储只存引用（误判后果：撑爆行 + 放大整档写） |
| **S2 多人实时协同、字符级不打架**——多个员工同时编辑同一篇文档，看得到别人的光标在哪、正在改哪里，两人改不同段落**字符级自动合并互不覆盖**、改同一句也无静默丢字；断连降级只读 + 本地暂存并提示，重连自动 resync 合并 | **净新增（重）**：CRDT 引擎零（`git grep -i yjs\|automerge\|y-websocket\|socket.io` 零命中）；WS 基础设施半成（`agent-ws.ts` 模式可抄，cookie 会话握手/协作房/CRDT/**CV 服务端校验**全净新增）；乐观锁/version 列路③ 实测无、不复用 | **L3（真机真验）** | CRDT 引擎（**推荐 Yjs**，见 J1）／`y-prosemirror` 绑定接 TipTap／**awareness** 多人光标 + 在线协作者指示／WS 协作通道（`ws` 库 noServer + upgrade，抄 `agent-ws.ts:attachAgentWS` 模式，**路径 `/collab-ws`**）／握手 cookie 会话鉴权（G0b）／**多 org 成员握手拒绝不建房（不取 rows[0]，P1-4）**／**CV：CRDT update apply 后落库前过 schema 白名单校验（P1-1，J10）**／CRDT update 落库 + `content jsonb` 快照派生／断连只读降级横幅 + 本地暂存 + 重连 resync ／**会话失效→下一 ping/写操作断连重验（P1-5）**／版本历史最小档（回看上一版快照）／**多 org 成员前端『你属于多个组织，暂不支持协同/AI』可读提示（P2-2）** | 判定点 J1：CRDT 库选型（Yjs vs Automerge）。判定点 J2：WS 握手鉴权方案（手写 cookie 会话解析，**多 org 命中 rows.length>1 拒绝不取 rows[0]**）。判定点 J3：CRDT 持久化形态（update log/state bytea + ProseMirror JSON 快照双写）。**判定点 J10：CRDT update 服务端 schema 校验点（CV，apply 后落库前，与 HTTP/AI 写回共用白名单）**。分支：**会话过期即断连重验（触发时机=下一 ping 周期/下一写操作，长连不静默续命，P1-5）**。分支：**多 org 成员当前握手 409 fail-closed 不进协作房（外部阻塞 active_org，验收下限=单 org 成员端到端可用；A3 硬断言+变异守卫钉死不取 rows[0]）**。分支：协作房按 `(org_id, doc_id)` 强隔离，每连接校验 S3 编辑权（tech：可见≠可编辑=协作准入） |
| **S3 文档按权限管得住**——文档/文件夹设可见范围与可编辑范围（组织可见／指定成员集合／仅自己 三档），权限沿文档树继承、**取父子更严者（most-restrictive-wins）**；无权的人看不到标题、不在树、搜不到、打不开、导不走、进不了协作、AI 检索不到 | **半成**：员工目录只有 org+member 两层（`apps/api/src/staff-directory.ts:parseOrgGroups`，A30 fail-closed），**无部门/分组层**；cross-tenant 隔离底座已有（G0） | **L2（服务端真验）** | 权限设置 UI（每文档/文件夹选 visibility + 回显**实际生效范围**）／继承解析器（most-restrictive）／**七处过滤**（树·搜索·打开·导出·@提及·协作准入·AI 检索）／编辑权限校验（可见≠可编辑） | 判定点 J4：三层中间层来源（推荐 (b) 显式指定成员集合，不建部门表）。判定点 J5：成员集合生命周期——命中后**必须 live 校验该 member 仍属本 org（查 `tenant_members`）**，禁只信静态 id 列表（离职 + 未失效会话=越权读）；**此 live 复核即 AI 检索 query-time 复核的同一范式（P1-2）**。分支：继承 fail-safe——私密文档移进更宽父级不自动放宽，需二次确认 + 回显。分支：权限查询失败 → **fail-closed 503 不降级为可见**；反枚举无权与不存在统一 404 同文案同响应形状 |
| **S4 AI 读得到、答得准**——员工让 AI 就本组织**自己有权看到且未 opt-out 的**文档答问/摘要，答案**带出处**；AI 只在请求者本人已鉴权的同步请求内、复用其身份检索，绝不召回请求者无权/他企业/未确认草稿的内容 | **净新增**：路① 无 AI 层可复用（knowledge.ts 纯 CRUD）；`openrouter.ts` 可作 library（**现有唯一消费者=Line04 微信客服**，P2-1）；检索器/embedding/纯文本抽取全无 | **L3（真机真验）** | 文档进检索域索引（**index=候选生成 + query-time live ACL 复核**，形态见 J6，P1-2）／ProseMirror JSON → 纯文本抽取／带出处问答·摘要／line11 AI 助手横切层（**新建**，openrouter 作 library）／**query-time 权限 live 复核过滤器（召回后按 live ACL 复核，无权候选喂 LLM 前丢弃，P1-2）**／**文档设置「排除 AI 检索」opt-out 开关（默认纳入，UI 归属此处，P1-3）** | 判定点 J6：检索索引形态、纳入范围与默认策略（**默认纳入=有权可见即进，opt-out 显式退出；index 仅候选生成，正确性靠 query-time live ACL 复核，索引新鲜度=纯性能项；thin=关键词倒排，embedding 加厚需向量库支持 org_id 元数据；无论何种索引，召回后一律 query-time live ACL 复核**，P1-2/P1-3）。判定点 J8：AI 读身份——**只在请求者本人已鉴权同步 HTTP 请求内、作为服务端工具调用、复用 `req.workbenchIdentity`（org 维度待 active_org）**；禁任何需自带身份的异步/后台 AI 检索（误判后果：后台服务身份=越权召回全租户）。分支：**软删/权限收紧后由 query-time live ACL 复核即时 fail-closed，不给陈旧窗口（P1-2）；索引滞后仅影响候选完整性=性能项**。分支：投毒防护硬断言（结构性防护存在，L3 真检索栈 + 真 LLM）+ 软断言（注入不改答案走 eval + LLM judge，标软） |
| **S5 AI 写得回、受同一权限约束**——员工让 AI 把内容写回文档成**可见的「AI 草稿」块**，人工确认后才成正文；AI 写回**复用请求者身份 + 过 S3 权限校验**，只 additive 插入不整档覆盖，绝不以系统身份写他人私密文档 | **净新增**：真实写库面（生产 DB），越权写他企业/他人私密文档面新增 | **L3（真机真验）** | AI 写回草稿块（pending 标记，不进检索直到确认）／人工确认闸（确认动作进 db_audit）／additive 插入（禁整档 replace）／写回过 G1 服务端 schema 校验（**与 CV 同一白名单**） | 判定点 J8：AI 写回身份——同 S4，只在请求者已鉴权同步请求内复用 `req.workbenchIdentity` + 过 S3 编辑权，**禁后台服务身份写库**。判定点 J9：确认权归属——确认闸只保证「未确认不成正文」，**不是投毒防护**（真防线是 G3③ 数据分隔 + S4 未确认不进检索）；确认权**不能是投毒植入者自助确认**，确认进审计。分支：additive-only 禁整档 replace（链式覆盖丢内容）；跨企业/越权写 → 4xx 且目标文档逐字未变 |

### 切刀记录表（相邻边界 × T1–T4 × 结论；较 v1 不变）

| 相邻边界（片段A ｜ 片段B） | T1 可观察终态 | T2 失败可辨 | T3 独立 EV | T4 可停顿 | 结论 | 理由 |
|---|---|---|---|---|---|---|
| 员工登录/组织归属 ｜ 其余 | — | — | — | — | 前置件 | 共享前置上提为 Gate G0/G0b（复用路①③ 底座 + WS 握手净新增） |
| 建空文档 ｜ 写正文并保存 | ✘ | ✘ | ✘ | ✘ | 并入 S1 | 建空档无独立价值，一口气建+写+存 |
| S1 写留 ｜ S2 实时协同 | ✔ | ✔ | ✔ | ✔ | 切 | 单人存住 vs 多人字符级合并；写完可停几天再协作；失败面不同（丢字 vs 合并冲突/越权进房/裸 WS 注入） |
| S2 协同 ｜ S3 权限 | ✔ | ✔ | ✔ | ✔ | 切 | 协同合并 vs 越权可见，不同失败；权限可在无协作时独立验收 |
| S3 权限 ｜ S4 AI 读 | ✔ | ✔ | ✔ | ✔ | 切 | 权限管住 vs AI 召回投毒，不同失败；AI 读受 S3 约束但可独立验收 |
| **S4 AI 读 ｜ S5 AI 写回** | ✔ | ✔ | ✔ | ✔ | **切** | 两终态（屏出答案 vs 树增草稿块并持久化）；两失败（答错/无出处 vs 草稿越权写库）；只读 vs 真实写库风险面根本不同，合并会把两种风险挤一格。5 步在上限 |
| S5 ｜ 版本全量回滚/评论/内嵌 database/导入 | — | — | — | — | 后刀加厚 | 显式不做清单 |

---

## 验收断言（A1–A10，冻结后 AI 不可改；均可转 psql / WS 客户端 / windows_cloud 真浏览器 / L3 真检索栈验证）

- **A1（G0/G0b cross-tenant 六层）**：持 B 企业真实会话，对 文档/文件夹/正文/@提及/协作房/检索域 六层任一伪造 `org_id` 指向 A → 4xx 或空集，且 A 文档逐字未变；B 会话连 A 的 `(org_id,doc_id)` 协作房 → 拒绝且拿不到任何在线/正文信号。**变异**：把 org 改回读身份头 / 注掉 WS 握手鉴权 → 必须转红。
- **A2（S1 写留 + XSS/SQL）**：建档→写富文本（含内嵌图片引用 + @提及）→存→刷新仍在→本组织树可见→导出 Markdown 往返；正文注入 `<img onerror>`/`href=javascript:` → 渲染后文本节点/协议被剥；标题 `"; DROP TABLE` → 参数化不触发。自动保存失败时编辑器可见提示且本地草稿保留（非静默丢失）。
- **A3（S2 实时 CRDT + 握手安全，本轮补 c/d/e）**：
  - **a**：两个已鉴权会话同时编辑同一文档不同段落 → 字符级自动合并、双方改动均在、**非 409**；改同一句无静默丢字；awareness 多人光标可见；断连 → 只读横幅 + 本地暂存，重连 → 自动 resync 合并。
  - **b**：无有效会话握手连 `/collab-ws` → 拒绝不建房。**变异**：注掉握手鉴权 / 注掉 doc 权校验 → 必须转红。
  - **c（P1-4 多 org fail-closed）**：**多 org 成员**（`tenant_members` 命中 rows.length>1）连 `/collab-ws` → **拒绝不建房**（比照 HTTP 409 语义），拿不到任何在线/正文信号，前端展示「你属于多个组织，暂不支持」可读提示（P2-2）。**变异**：WS 握手改取 `rows[0]` 静默挑一个 org → **必须转红**。
  - **d（验收下限）**：单 org 成员端到端可用，多 org 分支冻结在 fail-closed 下限待 active_org。
  - **e（P1-5 会话过期不静默续命）**：建 WS 连并在线 → 服务端**使该会话失效（删 session 行）** → **下一 ping 周期或下一写操作时该连接被断开并要求重验**（不静默续命）。**变异**：去掉会话失效检查（长连不再校验 session 存活）→ **必须转红**。
- **A4（S3 权限三档 + 七处过滤，本轮 AI 检索改 live 复核）**：设文档「仅自己」→ 他人在 树/搜索/打开/导出/@提及/协作准入/AI 检索 七处全部拿不到（统一 404 同文案同形状）；most-restrictive 继承：设父级「仅自己」后所有子档实际生效范围 ≤ 父级；从 `tenant_members` 删除某 member 后其对成员集合共享文档**立即**不可达（S3 live 校验）；**AI 检索处的即时不可达由 query-time live ACL 复核保证（删 member 后同一同步请求即不召回，不给 N 秒窗口，P1-2）**；权限查询失败 → fail-closed 503 不降级为可见。
- **A5（S4 AI 读 + 投毒不召回，L3，本轮补 query-time live 复核变异）**：AI 答问带出处；构造跨企业 + intra-org 无权 + pending 未确认草稿 三类投毒文档（含「ignore previous」），在 **L3 真检索栈 + 真 LLM**（禁 mock 召回）下**绝不进 B 的问答上下文**；AI 读端点无 `req.workbenchIdentity` → 拒。**变异**：删投毒/权限前置过滤断言 / **注掉 query-time live ACL 复核（让召回只信索引态 ACL，P1-2）** / 注入「无会话回落服务身份」→ 必须转红。（软断言标软：注入不改变答案走 eval + LLM judge + 人工抽样。）默认纳入策略下（有权可见即进），opt-out 文档不出现在候选/答案里（P1-3）。
- **A6（S5 AI 写回 additive + 身份 + schema）**：AI 写回落 `pending` 草稿块、S4 检索**不召回未确认块**；人工确认后才成正文且确认进 db_audit；additive-only（psql 校验非整档 replace）；写回无请求者身份即拒，跨企业/越权写 → 4xx 且目标文档逐字未变；写回内容过 G1 schema 白名单（非白名单节点被拒）。**变异**：注入服务身份回落 / 删 additive 断言 → 必须转红。
- **A7（G2 备份恢复演练，L2）**：从 pg_dump 备份还原到临时库，`documents.content` JSONB + `crdt_state` bytea + 关键字段（org_id/visibility/parent_id/deleted_at/ai_retrieval_opt_out）逐条比对一致；演练进 cron 非一次性。
- **A8（路级 windows_cloud 真浏览器 E2E 全链，L3）**：建档→写富文本→存→刷新在→第二人**实时协同字符级合并 + 多人光标**→设「仅自己」→第三人打不开/搜不到/进不了协作→AI 问答带出处→AI 写回 pending 草稿→检索不召回未确认→人工确认。接线三件套：spec 进 workflow 清单 + guard 文件名列表、smoke 进 `smoke-baseline.txt`、聚合进 required check。
- **A9（回归）**：引入 `documents` 到共享知识/检索基建后，路① 既有 CRUD 端点（`knowledge.ts` `POST /entries`/`GET /recent`/`GET /projection`）不回归——路① 既有 smoke 保持全绿（参照 PR#1676「改端点漏查前端消费链致生产回归」教训）。**注**：定义 v1「路①既有经验问答不回归」措辞已按探索实锤更正——路① 现状无问答，回归面是 CRUD 端点与消费链，非问答。
- **A10（P1-1 CRDT/WS 路径 XSS 服务端 CV 校验，L3）**：**裸 WS 客户端**（同 org 已鉴权，直连 `/collab-ws`）向 CRDT 文档注入 `href=javascript:` / `<img onerror>` / 非白名单节点的 Yjs update → 服务端 CV 在 apply 后落库前**拒绝该 update（或剥离后再落）**，落库的 `crdt_state` 派生 doc 与 `content jsonb` 均**不含该非白名单节点/协议**，渲染后无脚本执行面，且抽进 AI 检索的纯文本亦不含该注入。**变异**：注掉服务端 CV（CRDT update 不过 schema 白名单直接落库）→ **必须转红**。

---

## 判定点登记表（J1–J10；REC=所选方法 + 备选 + 依据 + 误判后果）

- **J1 CRDT 库选型**：**REC=Yjs**。备选：Automerge。依据见「CRDT 库选型对比」。误判后果：选错则 TipTap 绑定/多人光标全部自研，工期翻倍且 merge 正确性风险。
- **J2 WS 握手鉴权方案**：REC=**手写** upgrade 握手，`auth.api.getSession({headers: fromNodeHeaders(upgradeReq.headers)})`→`tenant_members` 真查→memberId+orgId，**命中 `rows.length>1`（多 org）→拒绝不建房，绝不取 `rows[0]`（P1-4，比照 workbench-auth.ts:92 的 409 语义）**；抄 `agent-ws.ts` 的 `ws` 库 noServer+upgrade+ping 模式但路径 `/collab-ws` 独立、鉴权换 cookie 会话。备选：把 workbenchAuthGuard 硬塞 WS（**否决**——它是 Express 中间件，WS upgrade 不过中间件链，探索实锤）；握手取 rows[0] 静默挑 org（**否决**——把配置事故变静默跨企业事故）。误判后果：直接复用中间件→握手无鉴权→任意人进任意协作房；取 rows[0]→静默跨企业。
- **J3 CRDT 持久化形态**：REC=`crdt_state bytea`（Yjs update log / 编码后 state）为并发真相 + 派生 ProseMirror JSON 快照写 `documents.content jsonb`（供 S1 导出 / S4 检索抽取 / 权限路径，且 G1 schema 白名单为唯一入库校验、CV 在此点落地）。备选：只存 JSON 快照不存 CRDT state（**否决**——丢失合并历史无法 resync）。误判后果：只存一侧→要么无法实时合并、要么检索/导出拿不到纯文本。
- **J4 三层权限中间层来源**：REC=(b) 显式指定成员集合（不建部门表）。备选：(a) 先两档后刀 /(c) 新建部门表（重）。依据：员工目录只有 org+member 两层（`staff-directory.ts`），无部门层。误判后果：建部门表=重且与飞书组织结构耦合。
- **J5 成员集合生命周期**：REC=命中后 live 校验 member 仍属本 org（查 `tenant_members`），禁只信静态 id 列表。备选：静态列表（**否决**——离职+未失效会话=越权读）。误判后果：陈旧成员集合越权读。**注**：此 live 复核范式即 J6 AI 检索 query-time live ACL 复核的同一实现基座（P1-2）。
- **J6 检索索引形态、纳入范围与默认策略（本轮重写，P1-2/P1-3）**：REC=**① 默认纳入=「有权可见即默认进检索」，`ai_retrieval_opt_out` 标记（S4 UI 开关，默认 false）显式退出（P1-3）**；**② index 仅作候选生成（携带 org_id），召回后一律 query-time live ACL 复核（查 `tenant_members` + live effective-visibility，比照 J5），无权候选喂 LLM 前丢弃——正确性由 live 复核保证（真 fail-closed，零陈旧窗口），索引新鲜度降级为纯性能项（P1-2）**；③ thin=关键词倒排，embedding 加厚需向量库支持 org_id 元数据 pre-filter（但无论何种索引，query-time live 复核不可省）。备选：opt-in 才进（**否决**——默认 AI 一篇读不到，「一等公民」当场打折 + 无人负责触发点）；只信存储态 ACL 索引新鲜度（**否决**——陈旧 ACL 越权召回窗口违背 fail-closed）。误判后果：opt-in→AI 读不到或客户误以为能读全部；只信索引 ACL→陈旧窗口越权召回无权内容。
- **J7 org 声明形态（外部依赖，非本路裁决）**：**待 `active_org` 定案**。现状下限=单 org 成员从会话唯一推 org、多 org 成员 fail-closed 409（**握手不取 rows[0]，A3-c 硬断言+变异钉死，P1-4**）；WS 连接与 AI 读写的 org 维度形态待 multiorg agent 定案后由 controller 补。误判后果：本路替 multiorg agent 猜 active_org 语义→双方模型冲突。**本条不在本轮拍板，仅登记依赖。**
- **J8 AI 读/写身份来源**：REC=只在请求者本人已鉴权同步 HTTP 请求内、作为服务端工具调用复用 `req.workbenchIdentity`（org 维度待 J7）；禁任何需自带身份的异步/后台 AI 检索或写库。备选：后台 worker 自带服务身份（**否决**——越权召回/写全租户）。误判后果：AI 通道成越权后门。
- **J9 AI 写回确认权归属**：REC=确认权归对该 doc 有编辑权的人类，**不能是投毒植入者自助确认**，确认进 db_audit；确认闸只管「未确认不成正文」，投毒真防线是 G3③ 数据分隔 + S4 未确认不进检索。备选：AI 自确认（**否决**）。误判后果：把确认闸误当投毒防护→植入者自助确认绕过。
- **J10 CRDT update 服务端 schema 校验点 CV（本轮新增，P1-1）**：REC=**服务端在 Yjs update apply 到房间 Y.Doc 后、编码落 `crdt_state`/派生 `content jsonb` 前，对派生 ProseMirror doc 过与 HTTP 编辑器/AI 写回同一条 schema 白名单**（含 href/src 协议白名单）；非白名单节点/协议→**拒绝该 update 并向该连接回 reject 使其回滚本地状态**（拒绝优先；仅对可安全净化的 mark 采取剥离后落）。备选：只在 HTTP/AI 写回校验、信任 WS 客户端（**否决**——裸 WS 客户端可绕过写白名单外节点=存储型 XSS，feedback tech#P1-1 实锤 `server.on('upgrade')` 走裸 socket）；纯客户端 schema 校验（**否决**——客户端可被裸 WS 客户端替换）。误判后果：CRDT/WS 成为 XSS 绕过通道，注入进 crdt_state→渲染型/存储型 XSS + 污染 AI 检索。

---

## CRDT 库选型对比（J1 依据；较 v1 不变）

| 维度 | **Yjs（REC）** | Automerge |
|---|---|---|
| TipTap/ProseMirror 绑定 | **官方 `y-prosemirror` + TipTap 官方 `@tiptap/extension-collaboration`/`collaboration-cursor`**，字符级合并 + 多人光标近乎开箱；本仓 TipTap 3.x 已是 dashboard 依赖 | `@automerge/prosemirror` 存在但较新、glue 更多，TipTap 无一等扩展 |
| 多人光标/在线态 | **awareness 协议内置**（presence/cursor 开箱） | 需自行搭 presence 通道 |
| 传输/带宽 | 二进制增量 update，紧凑，天然适配 WS noServer 增量广播 | 历史上开销较大，Automerge 2/3 改善 |
| 服务端持久化 | Y.Doc 编码为 update（Uint8Array）→ `bytea`；可派生 ProseMirror JSON 快照（CV 在此派生点校验，J10） | JSON-like 文档，自带完整历史/time-travel，但存储更重 |
| 与现有 WS 模式契合 | `y-websocket` noServer 模式可挂 `agent-ws.ts` 同款 `ws` 库 upgrade | 传输层需另搭 |
| 成熟度/生态 | 大量协作编辑器实战（成熟） | 较新，Rust 核心 wasm，数据模型更「可检视」 |
| 何时反选 | — | 若首刀就要文档内建全量历史/时间旅行为一等需求，Automerge 更顺 |

---

## NFR 分类（详见合同 `lifelines_and_nfr`；此处列人读摘要，本轮改 ④⑤⑨）

**lifeline（违反即失败）×8**：① cross-tenant 六层隔离；② intra-org 权限七处前置过滤 fail-closed，**AI 检索处由 query-time live ACL 复核落实、零陈旧窗口（P1-2）**；③ AI 读/写只在同步请求复用 `req.workbenchIdentity`、禁后台服务身份；④ XSS/SQL（ProseMirror schema 属性协议白名单 + 参数化），**HTTP 编辑器/AI 写回/CRDT-WS 三路径共用同一服务端白名单，CV 覆盖 CRDT 路径（P1-1）**；⑤ WS 握手 cookie 会话鉴权 + 每连接 doc 权校验 + 无鉴权不建房 + **多 org 成员拒绝不取 rows[0]（P1-4）** + **会话失效即断连重验不静默续命（P1-5）**；⑥ 未确认 AI 草稿不进检索（投毒防线）；⑦ 备份 + 恢复演练；⑧ 无静默数据丢失（CRDT 合并零丢字 / 自动保存失败可见）。
**best_effort ×5**：⑨ **检索索引新鲜度=纯性能项**（正确性已由 ② 的 query-time live ACL 复核兜底，索引滞后仅影响候选完整性，P1-2）；⑩ CRDT 实时延迟/多人光标顺滑；⑪ AI 答案抓要点/出处对（软，eval+judge+抽样）；⑫ TipTap/Yjs 版本锁；⑬ **多 org 成员可读提示文案（P2-2，非命门体验项）**。

---

## P2 记账（不阻塞，进账本留给实现期）

- **P2-1（已核销进正文）**：`openrouter.ts` 现状标注更正为「现有唯一消费者是 Line04 微信客服，路② 作 library 复用」。
- **P2-2（已核销进正文）**：多 org 409 用户可感知提示「你属于多个组织，暂不支持协同/AI」（best_effort⑬，S2 挂片，实现期文案定稿）。
- **P2-5（实现期）**：CRDT update log 压缩 / 写放大——append update 长期膨胀，留实现期定压缩/快照 checkpoint 策略。
- 内嵌图片对象存储 + Markdown 导出对图片/@提及有损范围显式声明（tech P2-3-orig）。
- 版本全量回滚（最小档=回看上一版快照；AI 写回确认后撤销挂此加厚，不做清单）。
- 与路① 经验的桥（文档一键沉淀为经验 / 答案分标「经验/文档」来源，Q4，本刀不做）。
- 导出审计 + 限流（导出留 db_audit，防批量拖库）。
- 协作消息注入防护、并发洪峰限流（场景八格已列，实现期定阈值）。

### P2 不做清单（首刀显式不含，留后续刀）

- Notion/飞书批量导入迁移（主理人拍板 Q2，首刀不含）。
- **@人通知触发器（P2-3）**：`@提及` 首刀仅「@文档」，@人通知留后续刀。
- **模板建档 / 文档过期提醒等触发器（P2-4）**：首刀不含。
- 评论 / 内嵌 database / 版本全量回滚（后刀加厚）。
